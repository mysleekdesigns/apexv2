import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { planRun, runEval } from "../../src/eval/index.js";

const TEMPLATE_DIR = path.resolve("templates/.apex/eval");

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apex-eval-int-"));
}

function writeEpisode(root: string, id: string, files: Record<string, string>): void {
  const dir = path.join(root, ".apex", "episodes", id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [k, v] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, k), v, "utf8");
  }
}

describe("eval integration", () => {
  it("plans synthetic + replay tasks", async () => {
    const root = tempRoot();
    writeEpisode(root, "2026-04-26-1432-9bc4", {
      "meta.json": JSON.stringify({
        schema_version: 1,
        episode_id: "2026-04-26-1432-9bc4",
        session_id: "s",
        started_at: "2026-04-26T14:32:00Z",
        ended_at: "2026-04-26T14:50:00Z",
        model: "claude-opus-4-7",
        claude_code_version: "2.4.1",
        repo_head_sha: "abc1234",
        repo_branch: null,
        cwd: "/tmp/p",
        hooks_fired_count: {
          session_start: 1,
          user_prompt_submit: 1,
          post_tool_use: 1,
          post_tool_use_failure: 0,
          pre_compact: 0,
          session_end: 1,
        },
      }),
      "prompts.jsonl":
        JSON.stringify({ schema_version: 1, ts: "2026-04-26T14:32:01Z", turn: 0, prompt: "hi" }) + "\n",
      "tools.jsonl":
        JSON.stringify({
          schema_version: 1,
          ts: "2026-04-26T14:32:02Z",
          turn: 0,
          tool_call_id: "tc1",
          tool_name: "Edit",
          exit_code: 0,
          input: { file_path: "src/a.ts" },
          files_touched: ["src/a.ts"],
        }) + "\n",
    });
    const plan = await planRun({
      root,
      withApex: true,
      stack: "node-typescript",
      tasksDir: TEMPLATE_DIR,
    });
    expect(plan.syntheticTasks.length).toBeGreaterThan(0);
    expect(plan.replayTasks.length).toBe(1);
    expect(plan.replayTasks[0]?.task.frontmatter.kind).toBe("replay");
  });

  it("runs end-to-end, writes a report, computes metrics", async () => {
    const root = tempRoot();
    // Two episodes with identical error signature on tool_name=Bash to ensure
    // repeat-mistake-rate has a meaningful denominator.
    for (const id of ["2026-04-25-1000-aaaa", "2026-04-26-1000-bbbb"]) {
      writeEpisode(root, id, {
        "meta.json": JSON.stringify({
          schema_version: 1,
          episode_id: id,
          session_id: id,
          started_at: id.startsWith("2026-04-25") ? "2026-04-25T10:00:00Z" : "2026-04-26T10:00:00Z",
          ended_at: null,
          model: "claude-opus-4-7",
          claude_code_version: "2.4.1",
          repo_head_sha: "abc1234",
          repo_branch: null,
          cwd: "/tmp/p",
          hooks_fired_count: {
            session_start: 1,
            user_prompt_submit: 1,
            post_tool_use: 1,
            post_tool_use_failure: 1,
            pre_compact: 0,
            session_end: 1,
          },
        }),
        "prompts.jsonl":
          JSON.stringify({ schema_version: 1, ts: "t", turn: 0, prompt: "p" }) + "\n",
        "failures.jsonl":
          JSON.stringify({
            schema_version: 1,
            ts: "t",
            turn: 0,
            tool_call_id: "tc",
            tool_name: "Bash",
            exit_code: 1,
            error: "type error: cannot assign",
          }) + "\n",
        "tools.jsonl": "",
      });
    }
    // Write a fixture file the synthetic task ts-add-route looks for so a
    // synthetic task has a chance of passing too.
    fs.mkdirSync(path.join(root, "src", "routes"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "routes", "health.ts"), "export const ok = true;\n", "utf8");

    const summary = await runEval({
      root,
      withApex: true,
      stack: "node-typescript",
      tasksDir: TEMPLATE_DIR,
      now: () => new Date("2026-04-26T18:30:00Z"),
    });
    // synthetic + 2 replays
    expect(summary.replay_count).toBe(2);
    expect(summary.synthetic_count).toBeGreaterThan(0);
    // Repeat-mistake rate = 1 (one signature, occurring across 2 sessions).
    expect(summary.metrics.repeat_mistake_rate).toBeCloseTo(1, 5);
    const report = path.join(root, ".apex", "metrics", "eval-2026-04-26-1830.md");
    expect(fs.existsSync(report)).toBe(true);
    const text = fs.readFileSync(report, "utf8");
    expect(text).toMatch(/^# APEX Eval Report/);
  });

  it("dry-run does not write a report", async () => {
    const root = tempRoot();
    const summary = await runEval({
      root,
      withApex: true,
      stack: "node-typescript",
      tasksDir: TEMPLATE_DIR,
      dryRun: true,
      now: () => new Date("2026-04-26T18:30:00Z"),
    });
    expect(summary.synthetic_count).toBeGreaterThan(0);
    const report = path.join(root, ".apex", "metrics", "eval-2026-04-26-1830.md");
    expect(fs.existsSync(report)).toBe(false);
  });

  it("--without-apex strips retrieval signals", async () => {
    const root = tempRoot();
    writeEpisode(root, "2026-04-26-1432-9bc4", {
      "meta.json": JSON.stringify({
        schema_version: 1,
        episode_id: "2026-04-26-1432-9bc4",
        session_id: "s",
        started_at: "2026-04-26T14:32:00Z",
        ended_at: null,
        model: "claude-opus-4-7",
        claude_code_version: "2.4.1",
        repo_head_sha: "abc1234",
        repo_branch: null,
        cwd: "/tmp/p",
        hooks_fired_count: {
          session_start: 1,
          user_prompt_submit: 1,
          post_tool_use: 0,
          post_tool_use_failure: 0,
          pre_compact: 0,
          session_end: 1,
        },
      }),
      "prompts.jsonl":
        JSON.stringify({ schema_version: 1, ts: "t", turn: 0, prompt: "hi", injected_knowledge_ids: ["k-1"] }) + "\n",
      "retrievals.jsonl":
        JSON.stringify({
          schema_version: 1,
          ts: "t",
          turn: 0,
          entry_id: "k-1",
          entry_type: "decision",
          rank: 1,
          score: 1,
          surfaced: true,
          referenced: true,
        }) + "\n",
      "tools.jsonl": "",
    });
    const summary = await runEval({
      root,
      withApex: false,
      stack: "node-typescript",
      tasksDir: TEMPLATE_DIR,
      dryRun: true,
      now: () => new Date("2026-04-26T18:30:00Z"),
    });
    expect(summary.metrics.knowledge_hit_rate).toBe(0);
    expect(summary.with_apex).toBe(false);
  });
});
