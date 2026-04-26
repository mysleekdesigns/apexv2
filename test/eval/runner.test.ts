import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  computeKnowledgeHitRate,
  computeMedianTimeToFirstCorrectEdit,
  computeRepeatMistakeRate,
  computeRunMetrics,
  computeTimeToFirstCorrectEdit,
  computeUserCorrectionFrequency,
  evaluatePredicate,
  runTask,
} from "../../src/eval/runner.js";
import type {
  EvalTask,
  SuccessPredicate,
} from "../../src/eval/types.js";
import type { EpisodeArtifacts } from "../../src/eval/replay.js";
import type { EpisodeMeta } from "../../src/types/shared.js";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apex-eval-runner-"));
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

function emptyArtifacts(id = "ep1", meta: EpisodeMeta = baseMeta): EpisodeArtifacts {
  return {
    episodeId: id,
    meta,
    prompts: [],
    tools: [],
    failures: [],
    corrections: [],
    edits: [],
    retrievals: [],
  };
}

describe("evaluatePredicate", () => {
  let root: string;
  beforeEach(() => {
    root = tempRoot();
  });

  it("file_exists passes when file is present", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "export {};", "utf8");
    const r = await evaluatePredicate(
      { kind: "file_exists", ref: "a.ts" },
      { root },
    );
    expect(r.passed).toBe(true);
  });

  it("file_exists fails when file is missing", async () => {
    const r = await evaluatePredicate(
      { kind: "file_exists", ref: "missing.ts" },
      { root },
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toContain("missing.ts");
  });

  it("contains_string matches a substring", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "export const ok = true;", "utf8");
    const ok = await evaluatePredicate(
      { kind: "contains_string", ref: "a.ts", value: "ok = true" },
      { root },
    );
    expect(ok.passed).toBe(true);
    const miss = await evaluatePredicate(
      { kind: "contains_string", ref: "a.ts", value: "nope" },
      { root },
    );
    expect(miss.passed).toBe(false);
  });

  it("regex_match handles patterns", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "function add(a,b){return a + b;}", "utf8");
    const ok = await evaluatePredicate(
      { kind: "regex_match", ref: "a.ts", pattern: "return\\s+a\\s*\\+\\s*b" },
      { root },
    );
    expect(ok.passed).toBe(true);
    const miss = await evaluatePredicate(
      { kind: "regex_match", ref: "a.ts", pattern: "nope" },
      { root },
    );
    expect(miss.passed).toBe(false);
  });

  it("command_exits_zero respects custom runner exit codes", async () => {
    const fakeRunner = {
      run: () => ({ exitCode: 0, stdout: "", stderr: "" }),
    };
    const ok = await evaluatePredicate(
      { kind: "command_exits_zero", cmd: "true" },
      { root, runner: fakeRunner },
    );
    expect(ok.passed).toBe(true);
    const failRunner = {
      run: () => ({ exitCode: 2, stdout: "", stderr: "boom" }),
    };
    const fail = await evaluatePredicate(
      { kind: "command_exits_zero", cmd: "false" },
      { root, runner: failRunner },
    );
    expect(fail.passed).toBe(false);
    expect(fail.reason).toContain("2");
  });

  it("invalid regex fails gracefully", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "x", "utf8");
    const r = await evaluatePredicate(
      { kind: "regex_match", ref: "a.ts", pattern: "(" },
      { root },
    );
    expect(r.passed).toBe(false);
  });
});

describe("runTask", () => {
  let root: string;
  beforeEach(() => {
    root = tempRoot();
  });

  it("aggregates predicates into pass/fail", async () => {
    fs.writeFileSync(path.join(root, "a.ts"), "ok", "utf8");
    const task: EvalTask = {
      frontmatter: {
        id: "t1",
        stack: "node-typescript",
        kind: "synthetic",
        title: "x",
        prompts: ["do it"],
        success_predicates: [
          { kind: "file_exists", ref: "a.ts" },
          { kind: "contains_string", ref: "a.ts", value: "ok" },
        ],
      },
      body: "",
      path: "test",
    };
    const r = await runTask(task, { root });
    expect(r.passed).toBe(true);
    expect(r.predicates).toHaveLength(2);
    expect(r.signals.tools_used).toBe(0);
  });

  it("derives signals from artifacts on replay", async () => {
    const task: EvalTask = {
      frontmatter: {
        id: "replay-x",
        stack: "node-typescript",
        kind: "replay",
        title: "x",
        prompts: ["x"],
        success_predicates: [{ kind: "file_exists", ref: "." }],
      },
      body: "",
      path: "<replay:ep1>",
    };
    const arts: EpisodeArtifacts = {
      ...emptyArtifacts(),
      tools: [
        {
          schema_version: 1,
          ts: "t",
          turn: 0,
          tool_call_id: "tc1",
          tool_name: "Edit",
          exit_code: 0,
          files_touched: ["a.ts", "b.ts"],
        },
      ],
      retrievals: [
        {
          schema_version: 1,
          ts: "t",
          turn: 0,
          entry_id: "k-1",
          entry_type: "decision",
          rank: 1,
          score: 0.9,
          surfaced: true,
          referenced: true,
        },
      ],
    };
    const r = await runTask(task, { root, artifacts: arts, withApex: true });
    expect(r.signals.tools_used).toBe(1);
    expect(r.signals.files_touched).toBe(2);
    expect(r.signals.retrieval_hits).toBe(1);
    expect(r.signals.retrieval_used).toBe(1);
  });
});

describe("metrics", () => {
  it("repeat-mistake rate counts signatures across sessions", () => {
    const epA: EpisodeArtifacts = emptyArtifacts("ep-a");
    epA.failures = [
      {
        schema_version: 1,
        ts: "t",
        turn: 0,
        tool_call_id: "tc1",
        tool_name: "Bash",
        exit_code: 1,
        error: "type error: 42 cannot assign",
      },
    ];
    const epB: EpisodeArtifacts = emptyArtifacts("ep-b");
    epB.failures = [
      {
        schema_version: 1,
        ts: "t",
        turn: 0,
        tool_call_id: "tc2",
        tool_name: "Bash",
        exit_code: 1,
        error: "type error: 9000 cannot assign",
      },
    ];
    const epC: EpisodeArtifacts = emptyArtifacts("ep-c");
    epC.failures = [
      {
        schema_version: 1,
        ts: "t",
        turn: 0,
        tool_call_id: "tc3",
        tool_name: "Bash",
        exit_code: 1,
        error: "completely different error",
      },
    ];
    const r = computeRepeatMistakeRate([epA, epB, epC]);
    // 2 distinct signatures; 1 repeats; 1/2 = 0.5
    expect(r.value).toBeCloseTo(0.5, 5);
    expect(r.total).toBe(3);
  });

  it("repeat-mistake rate is 0 when no failures", () => {
    const r = computeRepeatMistakeRate([emptyArtifacts("a")]);
    expect(r.value).toBe(0);
    expect(r.total).toBe(0);
  });

  it("knowledge-hit rate counts referenced retrievals", () => {
    const ep1: EpisodeArtifacts = emptyArtifacts("e1");
    ep1.retrievals = [
      { schema_version: 1, ts: "t", turn: 0, entry_id: "k-1", entry_type: "decision", rank: 1, score: 1, surfaced: true, referenced: true },
    ];
    const ep2: EpisodeArtifacts = emptyArtifacts("e2");
    ep2.retrievals = [
      { schema_version: 1, ts: "t", turn: 0, entry_id: "k-2", entry_type: "decision", rank: 1, score: 1, surfaced: true, referenced: false },
    ];
    const ep3: EpisodeArtifacts = emptyArtifacts("e3");
    ep3.retrievals = [
      { schema_version: 1, ts: "t", turn: 0, entry_id: "k-3", entry_type: "decision", rank: 1, score: 1, surfaced: true, referenced: false },
    ];
    ep3.tools = [
      { schema_version: 1, ts: "t", turn: 0, tool_call_id: "tc1", tool_name: "Edit", exit_code: 0, input: { note: "applied k-3" } },
    ];
    const r = computeKnowledgeHitRate([ep1, ep2, ep3]);
    // ep1 (referenced) + ep3 (id mentioned in tool input) hit; ep2 misses.
    expect(r.value).toBeCloseTo(2 / 3, 5);
    expect(r.total).toBe(3);
  });

  it("knowledge-hit rate is 0 with no retrievals", () => {
    const r = computeKnowledgeHitRate([emptyArtifacts()]);
    expect(r.value).toBe(0);
    expect(r.total).toBe(0);
  });

  it("time-to-first-correct-edit takes the first non-rewritten edit", () => {
    const ep: EpisodeArtifacts = emptyArtifacts();
    ep.edits = [
      { schema_version: 1, ts: "2026-04-26T14:33:00Z", turn: 0, tool: "Edit", path: "a.ts", added: 1, removed: 0 },
      { schema_version: 1, ts: "2026-04-26T14:34:00Z", turn: 1, tool: "Edit", path: "a.ts", added: 1, removed: 0 },
      { schema_version: 1, ts: "2026-04-26T14:35:00Z", turn: 2, tool: "Edit", path: "b.ts", added: 1, removed: 0 },
    ];
    const v = computeTimeToFirstCorrectEdit(ep);
    expect(v).not.toBeNull();
    // start was 14:32:00; first non-rewritten edit is the 14:34 edit on a.ts? Actually the
    // logic finds the first edit with no later edit on same path. b.ts at 14:35 has no later edit.
    // a.ts at 14:34 has no later edit either, and comes first chronologically among edits with
    // no later same-path edit. 14:33 a.ts is rewritten by 14:34.
    // So first such is 14:34 — 14:32 = 120000 ms.
    expect(v).toBe(120000);
  });

  it("time-to-first-correct-edit returns null without edits", () => {
    expect(computeTimeToFirstCorrectEdit(emptyArtifacts())).toBeNull();
  });

  it("median across episodes", () => {
    const ep1: EpisodeArtifacts = emptyArtifacts("e1");
    ep1.edits = [
      { schema_version: 1, ts: "2026-04-26T14:33:00Z", turn: 0, tool: "Edit", path: "a.ts", added: 1, removed: 0 },
    ];
    const ep2: EpisodeArtifacts = emptyArtifacts("e2");
    ep2.edits = [
      { schema_version: 1, ts: "2026-04-26T14:34:00Z", turn: 0, tool: "Edit", path: "b.ts", added: 1, removed: 0 },
    ];
    const m = computeMedianTimeToFirstCorrectEdit([ep1, ep2]);
    // ep1: 60000 ms; ep2: 120000 ms — even count, average = 90000
    expect(m).toBe(90000);
  });

  it("user-correction frequency reports per-100", () => {
    const ep: EpisodeArtifacts = emptyArtifacts();
    ep.prompts = [
      { schema_version: 1, ts: "t", turn: 0, prompt: "p1" },
      { schema_version: 1, ts: "t", turn: 1, prompt: "p2" },
      { schema_version: 1, ts: "t", turn: 2, prompt: "p3" },
      { schema_version: 1, ts: "t", turn: 3, prompt: "p4" },
    ];
    ep.corrections = [
      { schema_version: 1, ts: "t", turn: 1, kind: "correction", evidence_ref: "p#L2" },
      { schema_version: 1, ts: "t", turn: 2, kind: "confirmation", evidence_ref: "p#L3" },
    ];
    const r = computeUserCorrectionFrequency([ep]);
    expect(r.value).toBe(25);
    expect(r.corrections).toBe(1);
    expect(r.prompts).toBe(4);
  });

  it("aggregates run metrics", () => {
    const m = computeRunMetrics([emptyArtifacts("only")]);
    expect(m.repeat_mistake_rate).toBe(0);
    expect(m.knowledge_hit_rate).toBe(0);
    expect(m.user_correction_frequency).toBe(0);
    expect(m.time_to_first_correct_edit_ms).toBeNull();
  });
});
