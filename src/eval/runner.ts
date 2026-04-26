import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  type EpisodeArtifacts,
  episodeToTask,
  hashErrorSignature,
  stripApexContext,
} from "./replay.js";
import type {
  EvalTask,
  PredicateResult,
  RunMetrics,
  SuccessPredicate,
  TaskResult,
  TaskSignals,
} from "./types.js";

interface CommandRunner {
  run(cmd: string, opts: { cwd: string; timeoutMs: number }): { exitCode: number; stdout: string; stderr: string };
}

const defaultRunner: CommandRunner = {
  run(cmd, { cwd, timeoutMs }) {
    const r = spawnSync("/bin/sh", ["-c", cmd], {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      env: { ...process.env, APEX_EVAL: "1" },
    });
    return {
      exitCode: typeof r.status === "number" ? r.status : 1,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
    };
  },
};

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readMaybe(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

export async function evaluatePredicate(
  pred: SuccessPredicate,
  ctx: { root: string; runner?: CommandRunner },
): Promise<PredicateResult> {
  const runner = ctx.runner ?? defaultRunner;
  switch (pred.kind) {
    case "file_exists": {
      const abs = path.resolve(ctx.root, pred.ref);
      const ok = await fileExists(abs);
      return {
        kind: pred.kind,
        passed: ok,
        reason: ok ? `${pred.ref} exists` : `file_exists predicate failed for ${pred.ref}`,
      };
    }
    case "contains_string": {
      const abs = path.resolve(ctx.root, pred.ref);
      const text = await readMaybe(abs);
      if (text === null) {
        return { kind: pred.kind, passed: false, reason: `cannot read ${pred.ref}` };
      }
      const ok = text.includes(pred.value);
      return {
        kind: pred.kind,
        passed: ok,
        reason: ok
          ? `${pred.ref} contains expected substring`
          : `${pred.ref} missing substring "${pred.value}"`,
      };
    }
    case "regex_match": {
      const abs = path.resolve(ctx.root, pred.ref);
      const text = await readMaybe(abs);
      if (text === null) {
        return { kind: pred.kind, passed: false, reason: `cannot read ${pred.ref}` };
      }
      let re: RegExp;
      try {
        re = new RegExp(pred.pattern, pred.flags ?? "");
      } catch (err) {
        return {
          kind: pred.kind,
          passed: false,
          reason: `invalid regex: ${(err as Error).message}`,
        };
      }
      const ok = re.test(text);
      return {
        kind: pred.kind,
        passed: ok,
        reason: ok ? `regex matched in ${pred.ref}` : `regex did not match in ${pred.ref}`,
      };
    }
    case "command_exits_zero":
    case "custom_predicate": {
      const cwd = pred.cwd ? path.resolve(ctx.root, pred.cwd) : ctx.root;
      const timeoutMs = pred.timeout_ms ?? 30_000;
      const res = runner.run(pred.cmd, { cwd, timeoutMs });
      const ok = res.exitCode === 0;
      return {
        kind: pred.kind,
        passed: ok,
        reason: ok
          ? `command exited 0`
          : `command exited ${res.exitCode}: ${res.stderr.split("\n")[0] ?? ""}`,
      };
    }
  }
}

function deriveSignalsFromArtifacts(art: EpisodeArtifacts): TaskSignals {
  const tools_used = art.tools.length;
  const filesTouched = new Set<string>();
  for (const t of art.tools) {
    for (const f of t.files_touched ?? []) filesTouched.add(f);
  }
  // Errors recovered: count of unique signatures that appear in failures
  // followed by a successful tool of the same name later in the session.
  const failures = art.failures;
  const tools = art.tools;
  let errors_recovered = 0;
  for (const f of failures) {
    const after = tools.find(
      (t) =>
        t.turn > f.turn &&
        t.tool_name === f.tool_name &&
        t.exit_code === 0,
    );
    if (after) errors_recovered++;
  }
  const retrieval_hits = art.retrievals.length;
  const retrieval_used = art.retrievals.filter((r) => r.referenced === true).length;
  return {
    tools_used,
    files_touched: filesTouched.size,
    errors_recovered,
    retrieval_hits,
    retrieval_used,
  };
}

function syntheticSignals(): TaskSignals {
  return {
    tools_used: 0,
    files_touched: 0,
    errors_recovered: 0,
    retrieval_hits: 0,
    retrieval_used: 0,
  };
}

export interface RunTaskOptions {
  root: string;
  withApex?: boolean;
  /** If task is replay, the loaded episode artifacts. */
  artifacts?: EpisodeArtifacts;
  runner?: CommandRunner;
  now?: () => number;
}

export async function runTask(task: EvalTask, opts: RunTaskOptions): Promise<TaskResult> {
  const now = opts.now ?? (() => Date.now());
  const start = now();
  const predResults: PredicateResult[] = [];
  for (const pred of task.frontmatter.success_predicates) {
    const ctx: { root: string; runner?: CommandRunner } = { root: opts.root };
    if (opts.runner) ctx.runner = opts.runner;
    const r = await evaluatePredicate(pred, ctx);
    predResults.push(r);
  }
  const passed = predResults.every((p) => p.passed);
  const duration_ms = Math.max(0, now() - start);
  let signals: TaskSignals;
  if (task.frontmatter.kind === "replay" && opts.artifacts) {
    const arts = opts.withApex === false ? stripApexContext(opts.artifacts) : opts.artifacts;
    signals = deriveSignalsFromArtifacts(arts);
  } else {
    signals = syntheticSignals();
  }
  const result: TaskResult = {
    task_id: task.frontmatter.id,
    stack: task.frontmatter.stack,
    kind: task.frontmatter.kind,
    passed,
    duration_ms,
    predicates: predResults,
    signals,
  };
  return result;
}

// ----- Metrics ---------------------------------------------------------------

export function computeRepeatMistakeRate(episodes: EpisodeArtifacts[]): { value: number; total: number } {
  const sigToSessions = new Map<string, Set<string>>();
  let totalErrors = 0;
  for (const ep of episodes) {
    for (const f of ep.failures) {
      totalErrors++;
      const sig = hashErrorSignature(f);
      const sessions = sigToSessions.get(sig) ?? new Set<string>();
      sessions.add(ep.episodeId);
      sigToSessions.set(sig, sessions);
    }
  }
  if (sigToSessions.size === 0) return { value: 0, total: totalErrors };
  let repeat = 0;
  for (const sessions of sigToSessions.values()) {
    if (sessions.size >= 2) repeat++;
  }
  return { value: repeat / sigToSessions.size, total: totalErrors };
}

export function computeKnowledgeHitRate(
  episodes: EpisodeArtifacts[],
): { value: number; total: number } {
  let withRetrieval = 0;
  let referenced = 0;
  for (const ep of episodes) {
    if (ep.retrievals.length === 0) continue;
    withRetrieval++;
    const ids = new Set(ep.retrievals.map((r) => r.entry_id));
    let hit = false;
    if (ep.retrievals.some((r) => r.referenced === true)) hit = true;
    if (!hit) {
      for (const t of ep.tools) {
        const text = JSON.stringify(t.input ?? {});
        for (const id of ids) {
          if (text.includes(id)) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
    }
    if (!hit) {
      for (const p of ep.prompts) {
        for (const id of (p.injected_knowledge_ids ?? [])) {
          if (ids.has(id)) {
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
    }
    if (hit) referenced++;
  }
  if (withRetrieval === 0) return { value: 0, total: 0 };
  return { value: referenced / withRetrieval, total: withRetrieval };
}

export function computeTimeToFirstCorrectEdit(
  episode: EpisodeArtifacts,
): number | null {
  if (!episode.meta) return null;
  const sessionStart = Date.parse(episode.meta.started_at);
  if (Number.isNaN(sessionStart)) return null;
  const edits = [...episode.edits].sort((a, b) =>
    Date.parse(a.ts) - Date.parse(b.ts),
  );
  for (const e of edits) {
    const later = edits.find(
      (other) =>
        other !== e &&
        other.path === e.path &&
        Date.parse(other.ts) > Date.parse(e.ts),
    );
    if (!later) {
      const t = Date.parse(e.ts);
      if (!Number.isNaN(t)) return Math.max(0, t - sessionStart);
      return null;
    }
  }
  return null;
}

export function computeMedianTimeToFirstCorrectEdit(
  episodes: EpisodeArtifacts[],
): number | null {
  const values: number[] = [];
  for (const ep of episodes) {
    const v = computeTimeToFirstCorrectEdit(ep);
    if (v !== null) values.push(v);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[mid] ?? null;
  const a = values[mid - 1];
  const b = values[mid];
  if (a === undefined || b === undefined) return null;
  return Math.round((a + b) / 2);
}

export function computeUserCorrectionFrequency(
  episodes: EpisodeArtifacts[],
): { value: number; corrections: number; prompts: number } {
  let corrections = 0;
  let prompts = 0;
  for (const ep of episodes) {
    prompts += ep.prompts.length;
    for (const c of ep.corrections) {
      if (c.kind === "correction") corrections++;
    }
  }
  if (prompts === 0) return { value: 0, corrections, prompts };
  return { value: (corrections / prompts) * 100, corrections, prompts };
}

export function computeRunMetrics(episodes: EpisodeArtifacts[]): RunMetrics {
  const repeat = computeRepeatMistakeRate(episodes);
  const hit = computeKnowledgeHitRate(episodes);
  const ttfce = computeMedianTimeToFirstCorrectEdit(episodes);
  const corr = computeUserCorrectionFrequency(episodes);
  return {
    repeat_mistake_rate: repeat.value,
    knowledge_hit_rate: hit.value,
    time_to_first_correct_edit_ms: ttfce,
    user_correction_frequency: corr.value,
    total_errors: repeat.total,
    total_prompts: corr.prompts,
    total_sessions: hit.total,
  };
}
