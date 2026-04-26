// Integration tests for runHookPolicy
//
// Builds a complete tmpdir with real episode data and asserts:
//  - Markdown file written under .apex/proposed/
//  - File contains expected sections
//  - Recommendations reflect the actual signal in the episodes
//  - Dry-run mode does not write any files

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runHookPolicy } from "../../src/hookpolicy/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-hookpolicy-int-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const NOW = new Date("2026-04-26T12:00:00Z");
const WINDOW_DAYS = 14;
const RECENT_TS = new Date(NOW.getTime() - 3 * 86_400_000).toISOString();

// ---------- helpers -----------------------------------------------------------

function episodeDir(root: string, id: string): string {
  const dir = path.join(root, ".apex", "episodes", id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeMeta(dir: string, opts: { reflectionStatus?: string; sessionEndFired?: number } = {}): void {
  const meta = {
    schema_version: 1,
    episode_id: path.basename(dir),
    session_id: "s1",
    started_at: RECENT_TS,
    ended_at: null,
    model: "claude-opus-4-7",
    claude_code_version: "2.4.1",
    repo_head_sha: "abc1234",
    hooks_fired_count: {
      session_start: 1,
      user_prompt_submit: 3,
      post_tool_use: 5,
      post_tool_use_failure: 0,
      pre_compact: 0,
      session_end: opts.sessionEndFired ?? 1,
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

function buildRichEpisodes(root: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const id = `2026-04-24-100${i}-${String(i).padStart(4, "0")}`;
    const dir = episodeDir(root, id);
    writeMeta(dir, { reflectionStatus: "complete" });

    // Add corrections signal
    const corrFile = path.join(dir, "corrections.jsonl");
    appendLine(corrFile, { schema_version: 1, ts: RECENT_TS, turn: 0, kind: "correction", evidence_ref: "p#0" });

    // Add Bash tool entries
    const toolFile = path.join(dir, "tools.jsonl");
    appendLine(toolFile, { schema_version: 1, ts: RECENT_TS, turn: 0, tool_call_id: `tc${i}a`, tool_name: "Bash", exit_code: 0 });

    // Add failure entries
    const failFile = path.join(dir, "failures.jsonl");
    appendLine(failFile, { schema_version: 1, ts: RECENT_TS, turn: 0, tool_call_id: `tc${i}b`, tool_name: "Bash", error: "oops" });
  }
}

// ---------- tests -------------------------------------------------------------

describe("runHookPolicy — file output", () => {
  it("writes _hook-policy-<date>.md under .apex/proposed/", async () => {
    buildRichEpisodes(tmpDir, 6);

    const report = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });

    expect(report.outputPath).not.toBeNull();
    expect(path.basename(report.outputPath!)).toBe(`_hook-policy-${NOW.toISOString().slice(0, 10)}.md`);
    expect(fs.existsSync(report.outputPath!)).toBe(true);

    // Path is under .apex/proposed/
    const expectedDir = path.join(tmpDir, ".apex", "proposed");
    expect(report.outputPath!.startsWith(expectedDir)).toBe(true);
  });

  it("file contains all required sections", async () => {
    buildRichEpisodes(tmpDir, 5);

    const report = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const content = fs.readFileSync(report.outputPath!, "utf8");

    expect(content).toContain("<!-- PROPOSED");
    expect(content).toContain("# Hook policy report");
    expect(content).toContain("## Recommendations");
    expect(content).toContain("## Evidence");
    expect(content).toContain("## How to apply");
    expect(content).toContain(".claude/settings.json");
    expect(content).toContain("APEX never edits this file automatically");
  });

  it("file mentions each hook name", async () => {
    buildRichEpisodes(tmpDir, 5);

    const report = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const content = fs.readFileSync(report.outputPath!, "utf8");

    expect(content).toContain("SessionStart");
    expect(content).toContain("UserPromptSubmit");
    expect(content).toContain("PostToolUse(Bash)");
    expect(content).toContain("PostToolUseFailure");
    expect(content).toContain("PreCompact");
    expect(content).toContain("SessionEnd");
  });

  it("shows window days and episode count in report", async () => {
    buildRichEpisodes(tmpDir, 5);

    const report = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const content = fs.readFileSync(report.outputPath!, "utf8");

    expect(content).toContain(`${WINDOW_DAYS} days`);
    expect(content).toContain("5 episode(s) scanned");
  });
});

describe("runHookPolicy — recommendation accuracy", () => {
  it("marks hooks with signal as keep and hooks without as disable (≥5 episodes)", async () => {
    // 6 episodes with corrections and failures, but no PreCompact snapshots
    buildRichEpisodes(tmpDir, 6);

    const report = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });

    const byHook = Object.fromEntries(
      report.recommendations.map((r) => [r.hook, r.recommendation]),
    );
    expect(byHook["SessionStart"]).toBe("keep");
    expect(byHook["UserPromptSubmit"]).toBe("keep");
    expect(byHook["PostToolUse(Bash)"]).toBe("keep");
    expect(byHook["PostToolUseFailure"]).toBe("keep");
    expect(byHook["PreCompact"]).toBe("disable"); // no snapshots written
    expect(byHook["SessionEnd"]).toBe("keep");
  });

  it("marks all hooks as insufficient-data when fewer than 5 episodes", async () => {
    buildRichEpisodes(tmpDir, 3);

    const report = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });

    for (const r of report.recommendations) {
      expect(r.recommendation).toBe("insufficient-data");
    }
  });

  it("marks all hooks as insufficient-data when no episodes exist", async () => {
    const report = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });

    for (const r of report.recommendations) {
      expect(r.recommendation).toBe("insufficient-data");
    }
  });
});

describe("runHookPolicy — dry-run mode", () => {
  it("does not write any files in dry-run mode", async () => {
    buildRichEpisodes(tmpDir, 6);

    const report = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW, dryRun: true });

    expect(report.outputPath).toBeNull();

    const proposedDir = path.join(tmpDir, ".apex", "proposed");
    const fileExists =
      fs.existsSync(proposedDir) &&
      fs.readdirSync(proposedDir).some((f) => f.startsWith("_hook-policy-"));
    expect(fileExists).toBe(false);
  });

  it("still returns rendered markdown in dry-run mode", async () => {
    buildRichEpisodes(tmpDir, 5);

    const report = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW, dryRun: true });

    expect(report.markdown).toContain("# Hook policy report");
    expect(report.markdown).toContain("## Recommendations");
  });

  it("recommendations are identical whether or not dryRun is set", async () => {
    buildRichEpisodes(tmpDir, 6);

    const r1 = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW, dryRun: true });
    const r2 = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW, dryRun: false });

    expect(r1.recommendations.map((r) => r.recommendation)).toEqual(
      r2.recommendations.map((r) => r.recommendation),
    );
  });
});

describe("runHookPolicy — re-run overwrites", () => {
  it("overwrites the same-day report on re-run", async () => {
    buildRichEpisodes(tmpDir, 5);

    const r1 = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const content1 = fs.readFileSync(r1.outputPath!, "utf8");

    // Add a snapshot to one episode (changes PreCompact signal)
    const dir = path.join(tmpDir, ".apex", "episodes", "2026-04-24-1000-0001");
    if (fs.existsSync(dir)) {
      const snapDir = path.join(dir, "snapshots");
      fs.mkdirSync(snapDir, { recursive: true });
      fs.writeFileSync(path.join(snapDir, "pre-compact-0.json"), "{}", "utf8");
    }

    const r2 = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    expect(r1.outputPath).toBe(r2.outputPath);

    const content2 = fs.readFileSync(r2.outputPath!, "utf8");
    // Content may differ now that PreCompact has a signal
    expect(r2.outputPath).toBeTruthy();
    expect(content2).toContain("# Hook policy report");
    // Both files end in the same date
    expect(path.basename(r1.outputPath!)).toBe(path.basename(r2.outputPath!));
  });
});

describe("runHookPolicy — disable section in output", () => {
  it("lists disabled hooks in 'How to apply' section", async () => {
    // Create 5 episodes with NO PreCompact signals (snapshots will be absent)
    for (let i = 0; i < 5; i++) {
      const id = `2026-04-24-110${i}-${String(i).padStart(4, "0")}`;
      const dir = episodeDir(tmpDir, id);
      writeMeta(dir, { reflectionStatus: "pending" });
    }

    const report = await runHookPolicy(tmpDir, { windowDays: WINDOW_DAYS, now: NOW });
    const content = fs.readFileSync(report.outputPath!, "utf8");

    // PreCompact should be in the disable section
    expect(content).toContain("Hooks recommended for removal");
    expect(content).toContain("`PreCompact`");
  });
});
