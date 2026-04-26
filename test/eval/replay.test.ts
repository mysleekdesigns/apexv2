import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  discoverEpisodes,
  episodeToTask,
  hashErrorSignature,
  matchEpisodeGlob,
  readEpisode,
  stripApexContext,
} from "../../src/eval/replay.js";
import type { EpisodeMeta } from "../../src/types/shared.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apex-eval-replay-"));
}

function writeEpisode(
  root: string,
  episodeId: string,
  files: Record<string, string>,
): string {
  const dir = path.join(root, ".apex", "episodes", episodeId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, "utf8");
  }
  return dir;
}

const baseMeta: EpisodeMeta = {
  schema_version: 1,
  episode_id: "2026-04-26-1432-9bc4",
  session_id: "sess_test",
  started_at: "2026-04-26T14:32:00Z",
  ended_at: "2026-04-26T14:50:00Z",
  model: "claude-opus-4-7",
  claude_code_version: "2.4.1",
  repo_head_sha: "abc1234",
  repo_branch: "main",
  cwd: "/tmp/p",
  hooks_fired_count: {
    session_start: 1,
    user_prompt_submit: 0,
    post_tool_use: 0,
    post_tool_use_failure: 0,
    pre_compact: 0,
    session_end: 1,
  },
};

describe("matchEpisodeGlob", () => {
  it("matches exact episode ids", () => {
    expect(matchEpisodeGlob("2026-04-26-1432-9bc4", "2026-04-26-1432-9bc4")).toBe(true);
  });
  it("supports wildcards", () => {
    expect(matchEpisodeGlob("2026-04-26-1432-9bc4", "2026-04-26-*")).toBe(true);
    expect(matchEpisodeGlob("2026-04-25-1432-9bc4", "2026-04-26-*")).toBe(false);
  });
  it("supports ?", () => {
    expect(matchEpisodeGlob("2026-04-26-1432-9bc4", "2026-04-26-1432-9bc?")).toBe(true);
  });
});

describe("discoverEpisodes", () => {
  let root: string;
  beforeEach(() => {
    root = tempRoot();
  });

  it("returns absolute episode dirs in sorted order", async () => {
    writeEpisode(root, "2026-04-26-1432-9bc4", { "meta.json": "{}" });
    writeEpisode(root, "2026-04-25-0900-aaaa", { "meta.json": "{}" });
    const dirs = await discoverEpisodes(root);
    expect(dirs.length).toBe(2);
    expect(path.basename(dirs[0]!)).toBe("2026-04-25-0900-aaaa");
    expect(path.basename(dirs[1]!)).toBe("2026-04-26-1432-9bc4");
  });

  it("filters by glob", async () => {
    writeEpisode(root, "2026-04-26-1432-9bc4", { "meta.json": "{}" });
    writeEpisode(root, "2026-04-25-0900-aaaa", { "meta.json": "{}" });
    const dirs = await discoverEpisodes(root, "2026-04-26-*");
    expect(dirs.length).toBe(1);
  });

  it("ignores non-episode-id directories", async () => {
    fs.mkdirSync(path.join(root, ".apex", "episodes", "junk"), { recursive: true });
    writeEpisode(root, "2026-04-26-1432-9bc4", { "meta.json": "{}" });
    const dirs = await discoverEpisodes(root);
    expect(dirs.length).toBe(1);
  });

  it("returns empty when episodes dir is missing", async () => {
    const dirs = await discoverEpisodes(tempRoot());
    expect(dirs).toEqual([]);
  });
});

describe("readEpisode", () => {
  let root: string;
  beforeEach(() => {
    root = tempRoot();
  });

  it("loads all jsonl artifacts", async () => {
    const dir = writeEpisode(root, "2026-04-26-1432-9bc4", {
      "meta.json": JSON.stringify(baseMeta),
      "prompts.jsonl":
        JSON.stringify({ schema_version: 1, ts: "2026-04-26T14:32:01Z", turn: 0, prompt: "hi" }) + "\n",
      "tools.jsonl":
        JSON.stringify({
          schema_version: 1,
          ts: "2026-04-26T14:32:02Z",
          turn: 0,
          tool_call_id: "tc1",
          tool_name: "Read",
          exit_code: 0,
        }) + "\n",
      "failures.jsonl": "",
      "edits.jsonl":
        JSON.stringify({
          schema_version: 1,
          ts: "2026-04-26T14:33:00Z",
          turn: 0,
          tool: "Edit",
          path: "src/a.ts",
          added: 5,
          removed: 0,
        }) + "\n",
    });
    const arts = await readEpisode(dir);
    expect(arts.episodeId).toBe("2026-04-26-1432-9bc4");
    expect(arts.meta?.session_id).toBe("sess_test");
    expect(arts.prompts).toHaveLength(1);
    expect(arts.tools).toHaveLength(1);
    expect(arts.edits).toHaveLength(1);
    expect(arts.failures).toEqual([]);
  });

  it("tolerates malformed jsonl lines", async () => {
    const dir = writeEpisode(root, "2026-04-26-1432-9bc4", {
      "meta.json": JSON.stringify(baseMeta),
      "prompts.jsonl":
        JSON.stringify({ schema_version: 1, ts: "2026-04-26T14:32:01Z", turn: 0, prompt: "hi" }) +
        "\n{ this is not json }\n",
    });
    const arts = await readEpisode(dir);
    expect(arts.prompts).toHaveLength(1);
  });
});

describe("episodeToTask + stripApexContext", () => {
  it("derives a stack and predicates from episode tools", () => {
    const arts = {
      episodeId: "2026-04-26-1432-9bc4",
      meta: baseMeta,
      prompts: [
        { schema_version: 1 as const, ts: "t", turn: 0, prompt: "do it" },
      ],
      tools: [
        {
          schema_version: 1 as const,
          ts: "t",
          turn: 0,
          tool_call_id: "tc1",
          tool_name: "Edit",
          exit_code: 0,
          input: { file_path: "src/foo.ts" },
          files_touched: ["src/foo.ts"],
        },
      ],
      failures: [],
      corrections: [],
      edits: [],
      retrievals: [],
    };
    const task = episodeToTask(arts);
    expect(task.frontmatter.kind).toBe("replay");
    expect(task.frontmatter.stack).toBe("node-typescript");
    expect(task.frontmatter.success_predicates.length).toBeGreaterThan(0);
    expect(task.frontmatter.id.startsWith("replay-")).toBe(true);
  });

  it("strips retrievals and injected ids on ablation", () => {
    const arts = {
      episodeId: "ep1",
      meta: baseMeta,
      prompts: [
        {
          schema_version: 1 as const,
          ts: "t",
          turn: 0,
          prompt: "x",
          injected_knowledge_ids: ["k-1", "k-2"],
        },
      ],
      tools: [],
      failures: [],
      corrections: [],
      edits: [],
      retrievals: [
        {
          schema_version: 1 as const,
          ts: "t",
          turn: 0,
          entry_id: "k-1",
          entry_type: "decision" as const,
          rank: 1,
          score: 0.5,
          surfaced: true,
        },
      ],
    };
    const stripped = stripApexContext(arts);
    expect(stripped.retrievals).toEqual([]);
    expect(stripped.prompts[0]?.injected_knowledge_ids).toEqual([]);
    // Original is unchanged.
    expect(arts.retrievals).toHaveLength(1);
  });
});

describe("hashErrorSignature", () => {
  it("normalises numbers and paths", () => {
    const a = hashErrorSignature({
      schema_version: 1,
      ts: "t",
      turn: 0,
      tool_call_id: "tc1",
      tool_name: "Bash",
      exit_code: 1,
      error: "Error at /tmp/foo.ts:42",
    });
    const b = hashErrorSignature({
      schema_version: 1,
      ts: "t",
      turn: 1,
      tool_call_id: "tc2",
      tool_name: "Bash",
      exit_code: 1,
      error: "Error at /opt/bar.ts:9000",
    });
    expect(a).toBe(b);
  });

  it("differentiates by tool_name", () => {
    const a = hashErrorSignature({
      schema_version: 1,
      ts: "t",
      turn: 0,
      tool_call_id: "tc1",
      tool_name: "Bash",
      exit_code: 1,
      error: "boom",
    });
    const b = hashErrorSignature({
      schema_version: 1,
      ts: "t",
      turn: 0,
      tool_call_id: "tc2",
      tool_name: "Edit",
      exit_code: 1,
      error: "boom",
    });
    expect(a).not.toBe(b);
  });
});
