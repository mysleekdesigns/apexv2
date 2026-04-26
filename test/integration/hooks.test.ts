// Integration tests for `apex hook <event>`.
//
// Bash hook execution is not exercised here — vitest can't reliably spawn the
// shell scripts on every CI matrix and the bash layer is intentionally
// minimal. We exercise the TypeScript routing directly via runHookForTest,
// which is the same code path the hook scripts trigger via `node dist/cli/index.js hook <event>`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CORRECTION_REGEX,
  isCorrection,
  runHookForTest,
} from "../../src/cli/commands/hook.js";
import { readCurrentEpisode } from "../../src/episode/writer.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apex-hooks-test-"));
}

function readJsonl(file: string): unknown[] {
  const txt = fs.readFileSync(file, "utf8");
  return txt
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe("hook command — integration", () => {
  let root: string;
  let prevDir: string;
  let prevEpisode: string | undefined;

  beforeEach(() => {
    root = tempRoot();
    prevDir = process.cwd();
    process.chdir(root);
    prevEpisode = process.env["APEX_EPISODE_ID"];
    delete process.env["APEX_EPISODE_ID"];
    process.env["CLAUDE_PROJECT_DIR"] = root;
  });

  afterEach(() => {
    process.chdir(prevDir);
    delete process.env["CLAUDE_PROJECT_DIR"];
    if (prevEpisode === undefined) delete process.env["APEX_EPISODE_ID"];
    else process.env["APEX_EPISODE_ID"] = prevEpisode;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("session-start creates an episode and writes .current pointer", async () => {
    const payload = {
      session_id: "ccs_abc",
      started_at: "2026-04-26T14:32:11Z",
      model: "claude-opus-4-7",
      claude_code_version: "2.4.1",
      repo_head_sha: "a1b2c3d",
      cwd: root,
    };
    await runHookForTest("session-start", JSON.stringify(payload));
    const current = readCurrentEpisode(root);
    expect(current).not.toBeNull();
    const dir = path.join(root, ".apex", "episodes", current!);
    expect(fs.existsSync(path.join(dir, "meta.json"))).toBe(true);
  });

  it("post-tool appends a row to tools.jsonl", async () => {
    await runHookForTest(
      "session-start",
      JSON.stringify({
        session_id: "ccs_abc",
        cwd: root,
        repo_head_sha: "a1b2c3d",
      }),
    );
    const episodeId = readCurrentEpisode(root)!;
    const payload = {
      session_id: "ccs_abc",
      ts: "2026-04-26T14:33:02Z",
      turn: 0,
      tool_call_id: "tc_001",
      tool_name: "Bash",
      input: { command: "pnpm test" },
      output: "ok",
      exit_code: 0,
      duration_ms: 12,
    };
    await runHookForTest("post-tool", JSON.stringify(payload));
    const file = path.join(root, ".apex", "episodes", episodeId, "tools.jsonl");
    const rows = readJsonl(file);
    expect(rows).toHaveLength(1);
    const r = rows[0] as { tool_name: string; exit_code: number };
    expect(r.tool_name).toBe("Bash");
    expect(r.exit_code).toBe(0);
  });

  it("post-tool with non-zero exit also writes failures.jsonl", async () => {
    await runHookForTest(
      "session-start",
      JSON.stringify({ cwd: root, repo_head_sha: "abc1234" }),
    );
    const episodeId = readCurrentEpisode(root)!;
    await runHookForTest(
      "post-tool",
      JSON.stringify({
        ts: "2026-04-26T14:35:02Z",
        turn: 1,
        tool_call_id: "tc_002",
        tool_name: "Bash",
        input: { command: "pnpm test" },
        exit_code: 1,
        error: "tests failed",
      }),
    );
    const failures = readJsonl(
      path.join(root, ".apex", "episodes", episodeId, "failures.jsonl"),
    );
    expect(failures).toHaveLength(1);
  });

  it("post-tool for an Edit/Write also writes edits.jsonl", async () => {
    await runHookForTest(
      "session-start",
      JSON.stringify({ cwd: root, repo_head_sha: "abc1234" }),
    );
    const episodeId = readCurrentEpisode(root)!;
    await runHookForTest(
      "post-tool",
      JSON.stringify({
        turn: 1,
        tool_call_id: "tc_003",
        tool_name: "Edit",
        input: { file_path: "src/x.ts" },
        exit_code: 0,
      }),
    );
    const edits = readJsonl(
      path.join(root, ".apex", "episodes", episodeId, "edits.jsonl"),
    );
    expect(edits).toHaveLength(1);
    const e = edits[0] as { tool: string; path: string };
    expect(e.tool).toBe("Edit");
    expect(e.path).toBe("src/x.ts");
  });

  it("prompt-submit appends a prompt and detects a correction", async () => {
    await runHookForTest(
      "session-start",
      JSON.stringify({ cwd: root, repo_head_sha: "abc1234" }),
    );
    const episodeId = readCurrentEpisode(root)!;
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({
        ts: "2026-04-26T14:48:55Z",
        turn: 3,
        prompt: "no, use .optional() instead",
      }),
    );
    const dir = path.join(root, ".apex", "episodes", episodeId);
    expect(readJsonl(path.join(dir, "prompts.jsonl"))).toHaveLength(1);
    expect(readJsonl(path.join(dir, "corrections.jsonl"))).toHaveLength(1);
  });

  it("prompt-submit on a non-correction does NOT write to corrections.jsonl", async () => {
    await runHookForTest(
      "session-start",
      JSON.stringify({ cwd: root, repo_head_sha: "abc1234" }),
    );
    const episodeId = readCurrentEpisode(root)!;
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({ turn: 0, prompt: "Add a route." }),
    );
    const corrPath = path.join(
      root,
      ".apex",
      "episodes",
      episodeId,
      "corrections.jsonl",
    );
    expect(fs.existsSync(corrPath)).toBe(false);
  });

  it("pre-compact writes a snapshot file", async () => {
    await runHookForTest(
      "session-start",
      JSON.stringify({ cwd: root, repo_head_sha: "abc1234" }),
    );
    const episodeId = readCurrentEpisode(root)!;
    await runHookForTest(
      "pre-compact",
      JSON.stringify({
        ts: "2026-04-26T15:00:00Z",
        turn: 5,
        todos: [{ content: "x", status: "pending" }],
        open_files: ["src/a.ts"],
      }),
    );
    const file = path.join(
      root,
      ".apex",
      "episodes",
      episodeId,
      "snapshots",
      "pre-compact-1.json",
    );
    expect(fs.existsSync(file)).toBe(true);
  });

  it("session-end updates meta.json with ended_at", async () => {
    await runHookForTest(
      "session-start",
      JSON.stringify({
        session_id: "ccs_abc",
        cwd: root,
        repo_head_sha: "abc1234",
      }),
    );
    const episodeId = readCurrentEpisode(root)!;
    await runHookForTest(
      "session-end",
      JSON.stringify({
        session_id: "ccs_abc",
        ended_at: "2026-04-26T15:19:42Z",
        hooks_fired_count: {
          user_prompt_submit: 8,
          post_tool_use: 23,
          post_tool_use_failure: 2,
        },
      }),
    );
    const metaPath = path.join(
      root,
      ".apex",
      "episodes",
      episodeId,
      "meta.json",
    );
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      ended_at: string | null;
      hooks_fired_count: { session_end: number };
    };
    expect(meta.ended_at).toBe("2026-04-26T15:19:42Z");
    expect(meta.hooks_fired_count.session_end).toBeGreaterThanOrEqual(1);
  });

  it("hook redacts secrets in incoming payloads", async () => {
    await runHookForTest(
      "session-start",
      JSON.stringify({ cwd: root, repo_head_sha: "abc1234" }),
    );
    const episodeId = readCurrentEpisode(root)!;
    await runHookForTest(
      "post-tool",
      JSON.stringify({
        turn: 0,
        tool_call_id: "tc_redact",
        tool_name: "Bash",
        input: { command: "echo AKIA1234567890ABCDEF" },
        output: "AKIA1234567890ABCDEF",
        exit_code: 0,
      }),
    );
    const file = path.join(
      root,
      ".apex",
      "episodes",
      episodeId,
      "tools.jsonl",
    );
    const txt = fs.readFileSync(file, "utf8");
    expect(txt).toContain("[REDACTED:aws-access-key]");
    expect(txt).not.toContain("AKIA1234567890ABCDEF");
  });
});

describe("correction detection regex", () => {
  it("matches the spec's example forms", () => {
    expect(CORRECTION_REGEX.test("no, use .optional() instead")).toBe(true);
    expect(isCorrection("Nope, that's wrong")).toBe(true);
    expect(isCorrection("don't do that")).toBe(true);
    expect(isCorrection("Stop, that's not right")).toBe(true);
    expect(isCorrection("actually, use Map<>")).toBe(true);
    expect(isCorrection("use pnpm instead of npm")).toBe(true);
  });

  it("does not match neutral prompts", () => {
    expect(isCorrection("Add a paginated /api/projects route.")).toBe(false);
    expect(isCorrection("Run the tests.")).toBe(false);
    expect(isCorrection("Looks good, commit.")).toBe(false);
  });
});
