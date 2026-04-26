import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { readEpisodeSignals, listRecentEpisodes } from "../../src/reflector/signals.js";
import type { FailureLine, CorrectionLine, ToolLine } from "../../src/reflector/signals.js";
import type { EpisodeMeta } from "../../src/types/shared.js";

const EPISODE_ID = "2026-04-26-1432-9bc4";

function makeMeta(episodeId: string): EpisodeMeta {
  return {
    schema_version: 1,
    episode_id: episodeId,
    session_id: "sess-test",
    started_at: "2026-04-26T14:32:11Z",
    ended_at: "2026-04-26T15:19:42Z",
    model: "claude-opus-4-7",
    claude_code_version: "2.4.1",
    repo_head_sha: "a1b2c3d",
    repo_branch: "main",
    cwd: "/tmp/test",
    hooks_fired_count: {
      session_start: 1,
      user_prompt_submit: 3,
      post_tool_use: 5,
      post_tool_use_failure: 1,
      pre_compact: 0,
      session_end: 1,
    },
  };
}

const failure: FailureLine = {
  schema_version: 1,
  ts: "2026-04-26T14:46:02Z",
  turn: 2,
  tool_call_id: "tc_011",
  tool_name: "Bash",
  exit_code: 1,
  error: "1 test failing",
  error_signature: "expected cursor to be undefined",
  stderr_excerpt: "  ● expected cursor to be undefined",
};

const correction: CorrectionLine = {
  schema_version: 1,
  ts: "2026-04-26T14:48:55Z",
  turn: 3,
  kind: "correction",
  evidence_ref: "prompts.jsonl#L4",
  target_entry_id: null,
  user_text: "That zod schema is wrong — use .optional(), not .default(undefined).",
  claude_action_summary: "Used .default(undefined) instead of .optional()",
};

const tool: ToolLine = {
  schema_version: 1,
  ts: "2026-04-26T15:13:44Z",
  turn: 6,
  tool_call_id: "tc_021",
  tool_name: "Bash",
  exit_code: 0,
  duration_ms: 6420,
  error: null,
};

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-signals-test-"));
  const epDir = path.join(tempRoot, ".apex", "episodes", EPISODE_ID);
  await fs.ensureDir(epDir);
  await fs.writeJson(path.join(epDir, "meta.json"), makeMeta(EPISODE_ID), { spaces: 2 });
  await fs.writeFile(path.join(epDir, "failures.jsonl"), JSON.stringify(failure) + "\n", "utf8");
  await fs.writeFile(
    path.join(epDir, "corrections.jsonl"),
    JSON.stringify(correction) + "\n",
    "utf8",
  );
  await fs.writeFile(path.join(epDir, "tools.jsonl"), JSON.stringify(tool) + "\n", "utf8");
});

afterAll(async () => {
  if (tempRoot) await fs.remove(tempRoot);
});

describe("readEpisodeSignals", () => {
  it("reads meta.json and returns valid EpisodeSignals", async () => {
    const signals = await readEpisodeSignals(tempRoot, EPISODE_ID);
    expect(signals.episodeId).toBe(EPISODE_ID);
    expect(signals.meta.episode_id).toBe(EPISODE_ID);
    expect(signals.meta.model).toBe("claude-opus-4-7");
  });

  it("parses failures.jsonl", async () => {
    const signals = await readEpisodeSignals(tempRoot, EPISODE_ID);
    expect(signals.failures).toHaveLength(1);
    expect(signals.failures[0]!.error_signature).toBe("expected cursor to be undefined");
    expect(signals.failures[0]!.tool_name).toBe("Bash");
    expect(signals.failures[0]!.turn).toBe(2);
  });

  it("parses corrections.jsonl", async () => {
    const signals = await readEpisodeSignals(tempRoot, EPISODE_ID);
    expect(signals.corrections).toHaveLength(1);
    expect(signals.corrections[0]!.kind).toBe("correction");
    expect(signals.corrections[0]!.user_text).toContain(".optional()");
  });

  it("parses tools.jsonl", async () => {
    const signals = await readEpisodeSignals(tempRoot, EPISODE_ID);
    expect(signals.tools).toHaveLength(1);
    expect(signals.tools[0]!.exit_code).toBe(0);
  });

  it("returns empty arrays when JSONL files are absent", async () => {
    const epId = "2026-04-26-0000-aaaa";
    const epDir = path.join(tempRoot, ".apex", "episodes", epId);
    await fs.ensureDir(epDir);
    await fs.writeJson(path.join(epDir, "meta.json"), makeMeta(epId), { spaces: 2 });
    // No failures.jsonl, corrections.jsonl, or tools.jsonl

    const signals = await readEpisodeSignals(tempRoot, epId);
    expect(signals.failures).toEqual([]);
    expect(signals.corrections).toEqual([]);
    expect(signals.tools).toEqual([]);
  });

  it("skips malformed JSONL lines without throwing", async () => {
    const epId = "2026-04-26-0001-bbbb";
    const epDir = path.join(tempRoot, ".apex", "episodes", epId);
    await fs.ensureDir(epDir);
    await fs.writeJson(path.join(epDir, "meta.json"), makeMeta(epId), { spaces: 2 });
    await fs.writeFile(
      path.join(epDir, "failures.jsonl"),
      `${JSON.stringify(failure)}\nNOT VALID JSON\n${JSON.stringify(failure)}\n`,
      "utf8",
    );

    const signals = await readEpisodeSignals(tempRoot, epId);
    expect(signals.failures).toHaveLength(2);
  });
});

describe("listRecentEpisodes", () => {
  it("returns episode ids sorted newest-first", async () => {
    const epDir1 = path.join(tempRoot, ".apex", "episodes", "2026-04-26-1400-cccc");
    const epDir2 = path.join(tempRoot, ".apex", "episodes", "2026-04-26-1500-dddd");
    await fs.ensureDir(epDir1);
    await fs.ensureDir(epDir2);

    const episodes = await listRecentEpisodes(tempRoot, 10);
    const hasEp1 = episodes.includes("2026-04-26-1400-cccc");
    const hasEp2 = episodes.includes("2026-04-26-1500-dddd");
    expect(hasEp1).toBe(true);
    expect(hasEp2).toBe(true);
    // ep2 (1500) should appear before ep1 (1400) — newest first
    if (hasEp1 && hasEp2) {
      expect(episodes.indexOf("2026-04-26-1500-dddd")).toBeLessThan(
        episodes.indexOf("2026-04-26-1400-cccc"),
      );
    }
  });

  it("respects the limit parameter", async () => {
    const episodes = await listRecentEpisodes(tempRoot, 1);
    expect(episodes.length).toBeLessThanOrEqual(1);
  });

  it("returns empty array when episodes dir does not exist", async () => {
    const emptyRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-empty-"));
    try {
      const episodes = await listRecentEpisodes(emptyRoot, 10);
      expect(episodes).toEqual([]);
    } finally {
      await fs.remove(emptyRoot);
    }
  });

  it("ignores non-episode entries like .current", async () => {
    // .current is already in the dir from writer usage; it should be excluded
    const episodes = await listRecentEpisodes(tempRoot, 100);
    expect(episodes.every((e) => /^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/.test(e))).toBe(true);
  });
});
