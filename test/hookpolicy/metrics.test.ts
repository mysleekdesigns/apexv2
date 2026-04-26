// Unit tests for src/hookpolicy/metrics.ts
//
// Builds synthetic episode trees in a tmpdir and asserts per-hook counts.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { aggregateMetrics } from "../../src/hookpolicy/metrics.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-hookmetrics-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Fixed "now" so window calculations are deterministic.
const NOW = new Date("2026-04-26T12:00:00Z");
const WINDOW_DAYS = 14;
const RECENT_MS = 3 * 86_400_000; // 3 days ago

// ---------- helpers -----------------------------------------------------------

function episodeDir(root: string, id: string): string {
  const dir = path.join(root, ".apex", "episodes", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMeta(
  dir: string,
  opts: {
    startedAt: string;
    hooksFired?: Partial<{
      session_start: number;
      user_prompt_submit: number;
      post_tool_use: number;
      post_tool_use_failure: number;
      pre_compact: number;
      session_end: number;
    }>;
    reflectionStatus?: string;
  },
): void {
  const meta = {
    schema_version: 1,
    episode_id: path.basename(dir),
    session_id: "s1",
    started_at: opts.startedAt,
    ended_at: null,
    model: "claude-opus-4-7",
    claude_code_version: "2.4.1",
    repo_head_sha: "abc1234",
    hooks_fired_count: {
      session_start: 1,
      user_prompt_submit: 0,
      post_tool_use: 0,
      post_tool_use_failure: 0,
      pre_compact: 0,
      session_end: 0,
      ...(opts.hooksFired ?? {}),
    },
    ...(opts.reflectionStatus
      ? { reflection: { status: opts.reflectionStatus, completed_at: null, proposed_entries: [] } }
      : {}),
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta), "utf8");
}

function appendLine(file: string, obj: unknown): void {
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

function recentTs(): string {
  return new Date(NOW.getTime() - RECENT_MS).toISOString();
}

// ---------- tests -------------------------------------------------------------

describe("aggregateMetrics — empty episodes dir", () => {
  it("returns zero counts when no episodes directory exists", () => {
    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    expect(result.episodesScanned).toBe(0);
    expect(result.metrics).toHaveLength(6);
    for (const m of result.metrics) {
      expect(m.signal.totalSignal).toBe(0);
    }
  });

  it("returns zero counts when episodes dir exists but is empty", () => {
    fs.mkdirSync(path.join(tmpDir, ".apex", "episodes"), { recursive: true });
    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    expect(result.episodesScanned).toBe(0);
  });
});

describe("aggregateMetrics — window filtering", () => {
  it("excludes episodes older than the window", () => {
    const oldMs = 20 * 86_400_000; // 20 days ago — outside 14-day window
    const oldTs = new Date(NOW.getTime() - oldMs).toISOString();
    const dir = episodeDir(tmpDir, "2026-04-06-1000-aaaa");
    writeMeta(dir, { startedAt: oldTs, reflectionStatus: "complete" });

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    expect(result.episodesScanned).toBe(0);
  });

  it("includes episodes within the window", () => {
    const dir = episodeDir(tmpDir, "2026-04-23-1000-bbbb");
    writeMeta(dir, { startedAt: recentTs(), reflectionStatus: "complete" });

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    expect(result.episodesScanned).toBe(1);
  });
});

describe("aggregateMetrics — SessionStart", () => {
  it("counts one signal per episode (every episode starts a session)", () => {
    for (let i = 0; i < 3; i++) {
      const id = `2026-04-24-100${i}-aaaa`;
      const dir = episodeDir(tmpDir, id);
      writeMeta(dir, { startedAt: recentTs() });
    }
    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const ss = result.metrics.find((m) => m.hook === "SessionStart")!;
    expect(ss.signal.totalSignal).toBe(3);
    expect(ss.signal.episodesWithSignal).toBe(3);
    expect(ss.signal.breakdown["sessions_started"]).toBe(3);
  });
});

describe("aggregateMetrics — UserPromptSubmit", () => {
  it("counts corrections, confirmations, thumbs from corrections.jsonl", () => {
    const dir = episodeDir(tmpDir, "2026-04-24-1200-cccc");
    writeMeta(dir, { startedAt: recentTs() });

    const corrFile = path.join(dir, "corrections.jsonl");
    appendLine(corrFile, { schema_version: 1, ts: recentTs(), turn: 0, kind: "correction", evidence_ref: "p#0" });
    appendLine(corrFile, { schema_version: 1, ts: recentTs(), turn: 1, kind: "confirmation", evidence_ref: "p#1" });
    appendLine(corrFile, { schema_version: 1, ts: recentTs(), turn: 2, kind: "thumbs_up", evidence_ref: "p#2" });
    appendLine(corrFile, { schema_version: 1, ts: recentTs(), turn: 3, kind: "thumbs_down", evidence_ref: "p#3" });

    const promptFile = path.join(dir, "prompts.jsonl");
    for (let i = 0; i < 5; i++) {
      appendLine(promptFile, { schema_version: 1, ts: recentTs(), turn: i, prompt: "x" });
    }

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const ups = result.metrics.find((m) => m.hook === "UserPromptSubmit")!;
    expect(ups.signal.totalSignal).toBe(4);
    expect(ups.signal.episodesWithSignal).toBe(1);
    expect(ups.signal.breakdown["corrections"]).toBe(1);
    expect(ups.signal.breakdown["confirmations"]).toBe(1);
    expect(ups.signal.breakdown["thumbs_up"]).toBe(1);
    expect(ups.signal.breakdown["thumbs_down"]).toBe(1);
    expect(ups.signal.breakdown["prompts_total"]).toBe(5);
  });

  it("yields zero signal when no corrections file exists", () => {
    const dir = episodeDir(tmpDir, "2026-04-24-1300-dddd");
    writeMeta(dir, { startedAt: recentTs() });

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const ups = result.metrics.find((m) => m.hook === "UserPromptSubmit")!;
    expect(ups.signal.totalSignal).toBe(0);
    expect(ups.signal.episodesWithSignal).toBe(0);
  });
});

describe("aggregateMetrics — PostToolUse(Bash)", () => {
  it("counts only Bash entries in tools.jsonl", () => {
    const dir = episodeDir(tmpDir, "2026-04-24-1400-eeee");
    writeMeta(dir, { startedAt: recentTs() });

    const toolFile = path.join(dir, "tools.jsonl");
    appendLine(toolFile, { schema_version: 1, ts: recentTs(), turn: 0, tool_call_id: "t1", tool_name: "Bash", exit_code: 0 });
    appendLine(toolFile, { schema_version: 1, ts: recentTs(), turn: 0, tool_call_id: "t2", tool_name: "Read", exit_code: 0 });
    appendLine(toolFile, { schema_version: 1, ts: recentTs(), turn: 1, tool_call_id: "t3", tool_name: "Bash", exit_code: 1 });

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const ptub = result.metrics.find((m) => m.hook === "PostToolUse(Bash)")!;
    expect(ptub.signal.totalSignal).toBe(2);
    expect(ptub.signal.breakdown["bash_tool_entries"]).toBe(2);
    expect(ptub.signal.episodesWithSignal).toBe(1);
  });
});

describe("aggregateMetrics — PostToolUseFailure", () => {
  it("deduplicates failures by tool_call_id", () => {
    const dir = episodeDir(tmpDir, "2026-04-24-1500-ffff");
    writeMeta(dir, { startedAt: recentTs() });

    const failFile = path.join(dir, "failures.jsonl");
    // Same tool_call_id twice (PostToolUse + PostToolUseFailure double-fire)
    appendLine(failFile, { schema_version: 1, ts: recentTs(), turn: 0, tool_call_id: "tc_001", tool_name: "Bash", error: "fail" });
    appendLine(failFile, { schema_version: 1, ts: recentTs(), turn: 0, tool_call_id: "tc_001", tool_name: "Bash", error: "fail" });
    appendLine(failFile, { schema_version: 1, ts: recentTs(), turn: 1, tool_call_id: "tc_002", tool_name: "Bash", error: "fail2" });

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const ptuf = result.metrics.find((m) => m.hook === "PostToolUseFailure")!;
    // 2 unique ids
    expect(ptuf.signal.totalSignal).toBe(2);
    expect(ptuf.signal.breakdown["failures_captured"]).toBe(2);
    expect(ptuf.signal.episodesWithSignal).toBe(1);
  });
});

describe("aggregateMetrics — PreCompact", () => {
  it("counts snapshot files in snapshots/ directory", () => {
    const dir = episodeDir(tmpDir, "2026-04-24-1600-a1b2");
    writeMeta(dir, { startedAt: recentTs() });

    const snapDir = path.join(dir, "snapshots");
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, "pre-compact-0.json"), "{}", "utf8");
    fs.writeFileSync(path.join(snapDir, "pre-compact-1.json"), "{}", "utf8");

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const pc = result.metrics.find((m) => m.hook === "PreCompact")!;
    expect(pc.signal.totalSignal).toBe(2);
    expect(pc.signal.breakdown["snapshots_written"]).toBe(2);
    expect(pc.signal.episodesWithSignal).toBe(1);
  });

  it("yields zero when no snapshots directory exists", () => {
    const dir = episodeDir(tmpDir, "2026-04-24-1700-c3d4");
    writeMeta(dir, { startedAt: recentTs() });

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const pc = result.metrics.find((m) => m.hook === "PreCompact")!;
    expect(pc.signal.totalSignal).toBe(0);
  });
});

describe("aggregateMetrics — SessionEnd", () => {
  it("counts reflections from meta.json reflection.status", () => {
    const dir1 = episodeDir(tmpDir, "2026-04-24-1800-e5f6");
    writeMeta(dir1, { startedAt: recentTs(), reflectionStatus: "complete" });

    const dir2 = episodeDir(tmpDir, "2026-04-24-1801-a7b8");
    writeMeta(dir2, { startedAt: recentTs(), reflectionStatus: "pending" });

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const se = result.metrics.find((m) => m.hook === "SessionEnd")!;
    expect(se.signal.totalSignal).toBe(2);
    expect(se.signal.breakdown["reflections_queued"]).toBe(2);
    expect(se.signal.breakdown["reflections_complete"]).toBe(1);
    expect(se.signal.episodesWithSignal).toBe(2);
  });

  it("falls back to hooks_fired_count.session_end when reflection is absent", () => {
    const dir = episodeDir(tmpDir, "2026-04-24-1900-c9d0");
    writeMeta(dir, {
      startedAt: recentTs(),
      hooksFired: { session_end: 1 },
    });

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const se = result.metrics.find((m) => m.hook === "SessionEnd")!;
    expect(se.signal.totalSignal).toBe(1);
    expect(se.signal.episodesWithSignal).toBe(1);
  });
});

describe("aggregateMetrics — three episodes with varying signal", () => {
  it("correctly aggregates across 3 mixed episodes", () => {
    // Episode 1: lots of signal
    {
      const dir = episodeDir(tmpDir, "2026-04-24-0900-1111");
      writeMeta(dir, { startedAt: recentTs(), reflectionStatus: "complete" });
      const corrFile = path.join(dir, "corrections.jsonl");
      appendLine(corrFile, { schema_version: 1, ts: recentTs(), turn: 0, kind: "correction", evidence_ref: "p#0" });
      const toolFile = path.join(dir, "tools.jsonl");
      appendLine(toolFile, { schema_version: 1, ts: recentTs(), turn: 0, tool_call_id: "t1", tool_name: "Bash", exit_code: 1 });
      const failFile = path.join(dir, "failures.jsonl");
      appendLine(failFile, { schema_version: 1, ts: recentTs(), turn: 0, tool_call_id: "t1", tool_name: "Bash", error: "oops" });
    }

    // Episode 2: only prompts, no signal corrections
    {
      const dir = episodeDir(tmpDir, "2026-04-24-1000-2222");
      writeMeta(dir, { startedAt: recentTs(), reflectionStatus: "pending" });
      const promptFile = path.join(dir, "prompts.jsonl");
      appendLine(promptFile, { schema_version: 1, ts: recentTs(), turn: 0, prompt: "hello" });
    }

    // Episode 3: no signal at all
    {
      const dir = episodeDir(tmpDir, "2026-04-24-1100-3333");
      writeMeta(dir, { startedAt: recentTs() });
    }

    const result = aggregateMetrics(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    expect(result.episodesScanned).toBe(3);

    const ss = result.metrics.find((m) => m.hook === "SessionStart")!;
    expect(ss.signal.totalSignal).toBe(3);

    const ups = result.metrics.find((m) => m.hook === "UserPromptSubmit")!;
    expect(ups.signal.totalSignal).toBe(1); // only ep1 had correction signal
    expect(ups.signal.breakdown["corrections"]).toBe(1);
    expect(ups.signal.breakdown["prompts_total"]).toBe(1); // ep2 had 1 prompt

    const ptub = result.metrics.find((m) => m.hook === "PostToolUse(Bash)")!;
    expect(ptub.signal.totalSignal).toBe(1);

    const ptuf = result.metrics.find((m) => m.hook === "PostToolUseFailure")!;
    expect(ptuf.signal.totalSignal).toBe(1);

    const se = result.metrics.find((m) => m.hook === "SessionEnd")!;
    expect(se.signal.totalSignal).toBe(2); // complete + pending
  });
});
