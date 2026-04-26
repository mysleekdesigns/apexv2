// Integration tests for the feedback-capture additions in handlePromptSubmit.
//
// Setup/teardown mirrors test/integration/hooks.test.ts — temp dir per test,
// CLAUDE_PROJECT_DIR env var, chdir, and full cleanup in afterEach.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHookForTest } from "../../src/cli/commands/hook.js";
import { readCurrentEpisode } from "../../src/episode/writer.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apex-feedback-test-"));
}

function readJsonl(file: string): unknown[] {
  const txt = fs.readFileSync(file, "utf8");
  return txt
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown);
}

describe("handlePromptSubmit — feedback capture", () => {
  let root: string;
  let prevDir: string;
  let prevEpisode: string | undefined;
  let episodeId: string;

  beforeEach(async () => {
    root = tempRoot();
    prevDir = process.cwd();
    process.chdir(root);
    prevEpisode = process.env["APEX_EPISODE_ID"];
    delete process.env["APEX_EPISODE_ID"];
    process.env["CLAUDE_PROJECT_DIR"] = root;

    // Start an episode so all subsequent prompt-submit calls have a valid id.
    await runHookForTest(
      "session-start",
      JSON.stringify({ cwd: root, repo_head_sha: "abc1234" }),
    );
    episodeId = readCurrentEpisode(root)!;
  });

  afterEach(() => {
    process.chdir(prevDir);
    delete process.env["CLAUDE_PROJECT_DIR"];
    if (prevEpisode === undefined) delete process.env["APEX_EPISODE_ID"];
    else process.env["APEX_EPISODE_ID"] = prevEpisode;
    fs.rmSync(root, { recursive: true, force: true });
  });

  // ---- helper paths ----------------------------------------------------------

  function corrPath(): string {
    return path.join(root, ".apex", "episodes", episodeId, "corrections.jsonl");
  }

  function promptPath(): string {
    return path.join(root, ".apex", "episodes", episodeId, "prompts.jsonl");
  }

  // ---- correction (existing behaviour must not regress) ----------------------

  it("writes a correction row for a correction prompt", async () => {
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({ turn: 1, prompt: "no, use pnpm instead of npm" }),
    );
    expect(fs.existsSync(promptPath())).toBe(true);
    const rows = readJsonl(corrPath()) as Array<{ kind: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("correction");
  });

  // ---- confirmation ----------------------------------------------------------

  it("writes a confirmation row for an affirmation prompt", async () => {
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({ turn: 2, prompt: "lgtm" }),
    );
    expect(fs.existsSync(promptPath())).toBe(true);
    const rows = readJsonl(corrPath()) as Array<{ kind: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("confirmation");
  });

  it("confirmation row has null target_entry_id", async () => {
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({ turn: 3, prompt: "looks good" }),
    );
    const rows = readJsonl(corrPath()) as Array<{
      kind: string;
      target_entry_id: unknown;
    }>;
    expect(rows[0]!.target_entry_id).toBeNull();
  });

  // ---- thumbs_up -------------------------------------------------------------

  it("writes a thumbs_up row for /apex-thumbs-up <id>", async () => {
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({
        turn: 4,
        prompt: "/apex-thumbs-up gh-pnpm-not-npm",
      }),
    );
    const rows = readJsonl(corrPath()) as Array<{
      kind: string;
      target_entry_id: unknown;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("thumbs_up");
    expect(rows[0]!.target_entry_id).toBe("gh-pnpm-not-npm");
  });

  // ---- thumbs_down -----------------------------------------------------------

  it("writes a thumbs_down row for /apex-thumbs-down <id>", async () => {
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({
        turn: 5,
        prompt: "/apex-thumbs-down use-zod-for-validation",
      }),
    );
    const rows = readJsonl(corrPath()) as Array<{
      kind: string;
      target_entry_id: unknown;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe("thumbs_down");
    expect(rows[0]!.target_entry_id).toBe("use-zod-for-validation");
  });

  // ---- plain prompt — no correction row --------------------------------------

  it("does NOT write to corrections.jsonl for a plain prompt", async () => {
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({ turn: 6, prompt: "Add a paginated /api/projects route." }),
    );
    expect(fs.existsSync(promptPath())).toBe(true);
    expect(fs.existsSync(corrPath())).toBe(false);
  });

  // ---- prompt still written first regardless of kind -------------------------

  it("always writes a prompt row before the correction row", async () => {
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({ turn: 7, prompt: "yes, go ahead" }),
    );
    // Both files must exist and prompt must be non-empty.
    const prompts = readJsonl(promptPath()) as Array<{ prompt: string }>;
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.prompt).toBe("yes, go ahead");
    const corrections = readJsonl(corrPath()) as Array<{ kind: string }>;
    expect(corrections).toHaveLength(1);
    expect(corrections[0]!.kind).toBe("confirmation");
  });

  // ---- exactly one row per prompt (no double-fire) ---------------------------

  it("writes exactly one correction row even if prompt could match multiple signals", async () => {
    // A correction prompt that starts with an affirmation-like word doesn't
    // exist naturally, but we verify the priority guard with a thumbs command
    // that could also be read as a "slash correction".
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({ turn: 8, prompt: "/apex-thumbs-up some-entry" }),
    );
    const rows = readJsonl(corrPath());
    expect(rows).toHaveLength(1);
  });

  // ---- evidence_ref format ---------------------------------------------------

  it("sets evidence_ref to prompts.jsonl#turn=<n>", async () => {
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({ turn: 9, prompt: "yep" }),
    );
    const rows = readJsonl(corrPath()) as Array<{ evidence_ref: string }>;
    expect(rows[0]!.evidence_ref).toBe("prompts.jsonl#turn=9");
  });

  // ---- user_text and claude_action_summary -----------------------------------

  it("stores the original user_text and an empty claude_action_summary", async () => {
    await runHookForTest(
      "prompt-submit",
      JSON.stringify({ turn: 10, prompt: "perfect" }),
    );
    const rows = readJsonl(corrPath()) as Array<{
      user_text: string;
      claude_action_summary: string;
    }>;
    expect(rows[0]!.user_text).toBe("perfect");
    expect(rows[0]!.claude_action_summary).toBe("");
  });
});
