// Episode-writer round-trip tests. Validates against zod schemas hand-rolled
// from specs/episode-schema.md (the JSON Schemas in that doc are the source
// of truth; we transcribe their required fields here).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import {
  appendCorrection,
  appendEdit,
  appendFailure,
  appendPrompt,
  appendRetrieval,
  appendTool,
  endEpisode,
  startEpisode,
  writeSnapshot,
} from "../../src/episode/writer.js";
import { newEpisodeId, isEpisodeId } from "../../src/episode/id.js";
import type { EpisodeMeta } from "../../src/types/shared.js";

// ---------- schemas (transcribed from specs/episode-schema.md) ---------------

const ISO_DATETIME = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "must be ISO 8601",
});

const MetaSchema = z.object({
  schema_version: z.literal(1),
  episode_id: z.string().regex(/^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/),
  session_id: z.string(),
  started_at: ISO_DATETIME,
  ended_at: z.union([ISO_DATETIME, z.null()]),
  model: z.string(),
  claude_code_version: z.string(),
  repo_head_sha: z.string().regex(/^[0-9a-f]{7,40}$/),
  repo_branch: z.union([z.string(), z.null()]),
  cwd: z.string(),
  hooks_fired_count: z.object({
    session_start: z.number().int().nonnegative(),
    user_prompt_submit: z.number().int().nonnegative(),
    post_tool_use: z.number().int().nonnegative(),
    post_tool_use_failure: z.number().int().nonnegative(),
    pre_compact: z.number().int().nonnegative(),
    session_end: z.number().int().nonnegative(),
  }),
  reflection: z
    .object({
      status: z.enum(["pending", "in_progress", "complete", "failed"]),
      completed_at: z.union([ISO_DATETIME, z.null()]),
      proposed_entries: z.array(z.string()),
    })
    .optional(),
});

const PromptSchema = z.object({
  schema_version: z.literal(1),
  ts: ISO_DATETIME,
  turn: z.number().int().nonnegative(),
  prompt: z.string(),
  prompt_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  attached_files: z.array(z.string()).optional(),
  injected_knowledge_ids: z.array(z.string()).optional(),
});

const ToolSchema = z.object({
  schema_version: z.literal(1),
  ts: ISO_DATETIME,
  turn: z.number().int().nonnegative(),
  tool_call_id: z.string(),
  tool_name: z.string(),
  input: z.record(z.unknown()).optional(),
  input_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  output_excerpt: z.string().optional(),
  output_size_bytes: z.number().int().nonnegative().optional(),
  exit_code: z.number().int(),
  duration_ms: z.number().int().nonnegative().optional(),
  error: z.union([z.string(), z.null()]).optional(),
  files_touched: z.array(z.string()).optional(),
});

const FailureSchema = z.object({
  schema_version: z.literal(1),
  ts: ISO_DATETIME,
  turn: z.number().int().nonnegative(),
  tool_call_id: z.string(),
  tool_name: z.string(),
  exit_code: z.number().int().optional(),
  error: z.string(),
  error_signature: z.union([z.string(), z.null()]).optional(),
  stderr_excerpt: z.union([z.string(), z.null()]).optional(),
});

const CorrectionSchema = z.object({
  schema_version: z.literal(1),
  ts: ISO_DATETIME,
  turn: z.number().int().nonnegative(),
  kind: z.enum(["correction", "confirmation", "thumbs_up", "thumbs_down"]),
  evidence_ref: z.string(),
  target_entry_id: z.union([z.string(), z.null()]).optional(),
  user_text: z.string().optional(),
  claude_action_summary: z.string().optional(),
});

const EditSchema = z.object({
  schema_version: z.literal(1),
  ts: ISO_DATETIME,
  turn: z.number().int().nonnegative(),
  tool_call_id: z.string().optional(),
  tool: z.enum(["Edit", "Write", "NotebookEdit"]),
  path: z.string(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  is_new_file: z.boolean().optional(),
});

const RetrievalSchema = z.object({
  schema_version: z.literal(1),
  ts: ISO_DATETIME,
  turn: z.number().int().nonnegative(),
  query: z.string().optional(),
  entry_id: z.string(),
  entry_type: z.enum(["decision", "pattern", "gotcha", "convention"]),
  rank: z.number().int().min(1),
  score: z.number(),
  tier: z.enum(["fts", "vector", "hybrid", "graph"]).optional(),
  surfaced: z.boolean(),
  referenced: z.union([z.boolean(), z.null()]).optional(),
});

const SnapshotSchema = z.object({
  schema_version: z.literal(1),
  ts: ISO_DATETIME,
  turn_at_snapshot: z.number().int().nonnegative(),
  todos: z
    .array(
      z.object({
        content: z.string(),
        status: z.enum(["pending", "in_progress", "completed"]),
      }),
    )
    .optional(),
  open_files: z.array(z.string()).optional(),
  recent_decisions: z.array(z.string()).optional(),
});

// ---------- fixtures ---------------------------------------------------------

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apex-episode-test-"));
}

function makeMeta(episodeId: string): EpisodeMeta {
  return {
    schema_version: 1,
    episode_id: episodeId,
    session_id: "ccs_test_01",
    started_at: "2026-04-26T14:32:11Z",
    ended_at: null,
    model: "claude-opus-4-7",
    claude_code_version: "2.4.1",
    repo_head_sha: "a1b2c3d",
    repo_branch: "main",
    cwd: "/tmp/proj",
    hooks_fired_count: {
      session_start: 1,
      user_prompt_submit: 0,
      post_tool_use: 0,
      post_tool_use_failure: 0,
      pre_compact: 0,
      session_end: 0,
    },
  };
}

function readJsonl(file: string): unknown[] {
  const txt = fs.readFileSync(file, "utf8");
  return txt
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

// ---------- tests ------------------------------------------------------------

describe("episode writer — lifecycle", () => {
  let root: string;
  let id: string;

  beforeEach(() => {
    root = tempRoot();
    id = newEpisodeId(new Date());
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("startEpisode creates the directory and writes meta.json", () => {
    const meta = makeMeta(id);
    startEpisode(root, meta);
    const metaPath = path.join(root, ".apex", "episodes", id, "meta.json");
    expect(fs.existsSync(metaPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown;
    expect(MetaSchema.parse(parsed)).toEqual(meta);
    expect(isEpisodeId((parsed as EpisodeMeta).episode_id)).toBe(true);
  });

  it("appendPrompt produces a valid JSONL line", () => {
    startEpisode(root, makeMeta(id));
    appendPrompt(root, id, {
      schema_version: 1,
      ts: "2026-04-26T14:32:14Z",
      turn: 0,
      prompt: "Add a paginated /api/projects route.",
      prompt_hash: "a".repeat(64),
      attached_files: [],
    });
    const file = path.join(root, ".apex", "episodes", id, "prompts.jsonl");
    const rows = readJsonl(file);
    expect(rows).toHaveLength(1);
    expect(PromptSchema.parse(rows[0])).toBeTruthy();
  });

  it("appendTool + appendFailure + appendEdit produce valid JSONL", () => {
    startEpisode(root, makeMeta(id));
    appendTool(root, id, {
      schema_version: 1,
      ts: "2026-04-26T14:33:02Z",
      turn: 0,
      tool_call_id: "tc_001",
      tool_name: "Bash",
      input: { command: "pnpm test" },
      input_hash: "b".repeat(64),
      exit_code: 0,
      duration_ms: 12,
      error: null,
    });
    appendFailure(root, id, {
      schema_version: 1,
      ts: "2026-04-26T14:35:02Z",
      turn: 1,
      tool_call_id: "tc_002",
      tool_name: "Bash",
      exit_code: 1,
      error: "test failed",
      error_signature: "expected 1 received 2",
      stderr_excerpt: "...",
    });
    appendEdit(root, id, {
      schema_version: 1,
      ts: "2026-04-26T14:36:02Z",
      turn: 1,
      tool_call_id: "tc_003",
      tool: "Edit",
      path: "src/x.ts",
      added: 2,
      removed: 1,
      is_new_file: false,
    });

    const dir = path.join(root, ".apex", "episodes", id);
    const tools = readJsonl(path.join(dir, "tools.jsonl"));
    const fails = readJsonl(path.join(dir, "failures.jsonl"));
    const edits = readJsonl(path.join(dir, "edits.jsonl"));

    expect(ToolSchema.parse(tools[0])).toBeTruthy();
    expect(FailureSchema.parse(fails[0])).toBeTruthy();
    expect(EditSchema.parse(edits[0])).toBeTruthy();
  });

  it("appendCorrection + appendRetrieval produce valid JSONL", () => {
    startEpisode(root, makeMeta(id));
    appendCorrection(root, id, {
      schema_version: 1,
      ts: "2026-04-26T14:48:55Z",
      turn: 3,
      kind: "correction",
      evidence_ref: "prompts.jsonl#L4",
      target_entry_id: null,
      user_text: "no, use .optional() instead",
      claude_action_summary: "wrote .default(undefined)",
    });
    appendRetrieval(root, id, {
      schema_version: 1,
      ts: "2026-04-26T14:33:00Z",
      turn: 0,
      query: "auth flow",
      entry_id: "decisions/api-pagination-cursor",
      entry_type: "decision",
      rank: 1,
      score: 0.87,
      tier: "fts",
      surfaced: true,
      referenced: null,
    });
    const dir = path.join(root, ".apex", "episodes", id);
    const corr = readJsonl(path.join(dir, "corrections.jsonl"));
    const retr = readJsonl(path.join(dir, "retrievals.jsonl"));
    expect(CorrectionSchema.parse(corr[0])).toBeTruthy();
    expect(RetrievalSchema.parse(retr[0])).toBeTruthy();
  });

  it("writeSnapshot creates pre-compact-<n>.json with monotonic n", () => {
    startEpisode(root, makeMeta(id));
    const a = writeSnapshot(root, id, {
      schema_version: 1,
      ts: "2026-04-26T15:00:00Z",
      turn_at_snapshot: 5,
      todos: [{ content: "x", status: "pending" }],
      open_files: ["src/a.ts"],
    });
    const b = writeSnapshot(root, id, {
      schema_version: 1,
      ts: "2026-04-26T15:10:00Z",
      turn_at_snapshot: 7,
    });
    expect(a.endsWith("pre-compact-1.json")).toBe(true);
    expect(b.endsWith("pre-compact-2.json")).toBe(true);
    const parsedA = JSON.parse(fs.readFileSync(a, "utf8")) as unknown;
    const parsedB = JSON.parse(fs.readFileSync(b, "utf8")) as unknown;
    expect(SnapshotSchema.parse(parsedA)).toBeTruthy();
    expect(SnapshotSchema.parse(parsedB)).toBeTruthy();
  });

  it("endEpisode rewrites meta.json with ended_at", () => {
    startEpisode(root, makeMeta(id));
    const finalMeta: EpisodeMeta = {
      ...makeMeta(id),
      ended_at: "2026-04-26T15:19:42Z",
      hooks_fired_count: {
        session_start: 1,
        user_prompt_submit: 8,
        post_tool_use: 23,
        post_tool_use_failure: 2,
        pre_compact: 0,
        session_end: 1,
      },
    };
    endEpisode(root, id, finalMeta);
    const metaPath = path.join(root, ".apex", "episodes", id, "meta.json");
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf8")) as unknown;
    const v = MetaSchema.parse(parsed);
    expect(v.ended_at).toBe("2026-04-26T15:19:42Z");
    expect(v.hooks_fired_count.user_prompt_submit).toBe(8);
  });

  it("redacts secrets in JSONL writes", () => {
    startEpisode(root, makeMeta(id));
    appendPrompt(root, id, {
      schema_version: 1,
      ts: "2026-04-26T14:32:14Z",
      turn: 0,
      prompt: "use AKIA1234567890ABCDEF for the call",
    });
    const rows = readJsonl(
      path.join(root, ".apex", "episodes", id, "prompts.jsonl"),
    );
    expect(JSON.stringify(rows[0])).toContain("[REDACTED:aws-access-key]");
    expect(JSON.stringify(rows[0])).not.toContain("AKIA1234567890ABCDEF");
  });

  it("redacts secrets in meta.json", () => {
    const meta = makeMeta(id);
    meta.cwd = "/Users/x/AKIA1234567890ABCDEF";
    startEpisode(root, meta);
    const txt = fs.readFileSync(
      path.join(root, ".apex", "episodes", id, "meta.json"),
      "utf8",
    );
    expect(txt).toContain("[REDACTED:aws-access-key]");
    expect(txt).not.toContain("AKIA1234567890ABCDEF");
  });

  it("rejects invalid episode ids", () => {
    expect(() =>
      startEpisode(root, { ...makeMeta(id), episode_id: "bogus" }),
    ).toThrow();
  });
});
