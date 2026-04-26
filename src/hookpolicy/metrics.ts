// Aggregates per-hook signal counts across episodes within a time window.
//
// Hooks evaluated:
//   SessionStart         — episode start + dashboard injection
//   UserPromptSubmit     — prompt + correction/confirmation/thumbs capture
//   PostToolUse(Bash)    — tool log
//   PostToolUseFailure   — failure capture
//   PreCompact           — snapshot
//   SessionEnd           — close + reflection enqueue

import fs from "node:fs";
import path from "node:path";
import { projectPaths } from "../util/paths.js";

export const HOOK_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "PostToolUse(Bash)",
  "PostToolUseFailure",
  "PreCompact",
  "SessionEnd",
] as const;

export type HookName = (typeof HOOK_NAMES)[number];

export interface HookSignal {
  /** Total count of the primary signal for this hook across all scanned episodes. */
  totalSignal: number;
  /** Number of episodes in which this hook produced ≥1 signal. */
  episodesWithSignal: number;
  /** Human-readable breakdown of what contributes to totalSignal. */
  breakdown: Record<string, number>;
}

export interface HookMetrics {
  hook: HookName;
  signal: HookSignal;
}

export interface MetricsResult {
  episodesScanned: number;
  windowDays: number;
  metrics: HookMetrics[];
  /** Episode ids that fell within the window (for evidence references). */
  episodeIds: string[];
}

export interface MetricsOptions {
  windowDays?: number;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

// ---------- helpers -----------------------------------------------------------

function isEpisodeDir(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/.test(name);
}

function readJsonlLines<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      // tolerate malformed lines
    }
  }
  return out;
}

interface MetaJson {
  started_at?: string;
  ended_at?: string | null;
  hooks_fired_count?: {
    session_start?: number;
    user_prompt_submit?: number;
    post_tool_use?: number;
    post_tool_use_failure?: number;
    pre_compact?: number;
    session_end?: number;
  };
  reflection?: {
    status?: string;
    completed_at?: string | null;
  };
}

interface ToolRow {
  tool_name?: string;
  exit_code?: number;
}

interface FailureRow {
  tool_call_id?: string;
}

interface CorrectionRow {
  kind?: string;
}

interface PromptRow {
  turn?: number;
}

function readMeta(dir: string): MetaJson | null {
  const file = path.join(dir, "meta.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as MetaJson;
  } catch {
    return null;
  }
}

function countSnapshotFiles(dir: string): number {
  const snapDir = path.join(dir, "snapshots");
  if (!fs.existsSync(snapDir)) return 0;
  try {
    return fs
      .readdirSync(snapDir)
      .filter((f) => f.startsWith("pre-compact-") && f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

// ---------- main export -------------------------------------------------------

export function aggregateMetrics(
  root: string,
  opts: MetricsOptions = {},
): MetricsResult {
  const windowDays = Math.max(1, opts.windowDays ?? 14);
  const now = opts.now ?? new Date();
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const paths = projectPaths(root);

  // Accumulators per hook.
  const acc: Record<HookName, { totalSignal: number; episodesWithSignal: number; breakdown: Record<string, number> }> = {
    "SessionStart": { totalSignal: 0, episodesWithSignal: 0, breakdown: { sessions_started: 0 } },
    "UserPromptSubmit": { totalSignal: 0, episodesWithSignal: 0, breakdown: { corrections: 0, confirmations: 0, thumbs_up: 0, thumbs_down: 0, prompts_total: 0 } },
    "PostToolUse(Bash)": { totalSignal: 0, episodesWithSignal: 0, breakdown: { bash_tool_entries: 0 } },
    "PostToolUseFailure": { totalSignal: 0, episodesWithSignal: 0, breakdown: { failures_captured: 0 } },
    "PreCompact": { totalSignal: 0, episodesWithSignal: 0, breakdown: { snapshots_written: 0 } },
    "SessionEnd": { totalSignal: 0, episodesWithSignal: 0, breakdown: { reflections_queued: 0, reflections_complete: 0 } },
  };

  let episodesScanned = 0;
  const episodeIds: string[] = [];

  if (!fs.existsSync(paths.episodesDir)) {
    return finish(acc, episodesScanned, windowDays, episodeIds);
  }

  const entries = fs.readdirSync(paths.episodesDir);
  for (const name of entries) {
    if (!isEpisodeDir(name)) continue;
    const dir = path.join(paths.episodesDir, name);
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) continue;

    const meta = readMeta(dir);
    const startedMs = meta?.started_at
      ? Date.parse(meta.started_at)
      : stat.mtimeMs;
    if (!Number.isFinite(startedMs) || startedMs < cutoff) continue;

    episodesScanned += 1;
    episodeIds.push(name);

    // ---- SessionStart --------------------------------------------------------
    // Every episode that exists was started; count = 1 per episode.
    acc["SessionStart"].totalSignal += 1;
    acc["SessionStart"].episodesWithSignal += 1;
    acc["SessionStart"].breakdown["sessions_started"] =
      (acc["SessionStart"].breakdown["sessions_started"] ?? 0) + 1;

    // ---- UserPromptSubmit ----------------------------------------------------
    const prompts = readJsonlLines<PromptRow>(path.join(dir, "prompts.jsonl"));
    const corrections = readJsonlLines<CorrectionRow>(path.join(dir, "corrections.jsonl"));

    acc["UserPromptSubmit"].breakdown["prompts_total"] =
      (acc["UserPromptSubmit"].breakdown["prompts_total"] ?? 0) + prompts.length;

    let sessionCorrSignal = 0;
    for (const c of corrections) {
      const kind = c.kind ?? "";
      if (kind === "correction") {
        acc["UserPromptSubmit"].breakdown["corrections"] =
          (acc["UserPromptSubmit"].breakdown["corrections"] ?? 0) + 1;
        sessionCorrSignal += 1;
      } else if (kind === "confirmation") {
        acc["UserPromptSubmit"].breakdown["confirmations"] =
          (acc["UserPromptSubmit"].breakdown["confirmations"] ?? 0) + 1;
        sessionCorrSignal += 1;
      } else if (kind === "thumbs_up") {
        acc["UserPromptSubmit"].breakdown["thumbs_up"] =
          (acc["UserPromptSubmit"].breakdown["thumbs_up"] ?? 0) + 1;
        sessionCorrSignal += 1;
      } else if (kind === "thumbs_down") {
        acc["UserPromptSubmit"].breakdown["thumbs_down"] =
          (acc["UserPromptSubmit"].breakdown["thumbs_down"] ?? 0) + 1;
        sessionCorrSignal += 1;
      }
    }
    acc["UserPromptSubmit"].totalSignal += sessionCorrSignal;
    if (sessionCorrSignal > 0) acc["UserPromptSubmit"].episodesWithSignal += 1;

    // ---- PostToolUse(Bash) ---------------------------------------------------
    const tools = readJsonlLines<ToolRow>(path.join(dir, "tools.jsonl"));
    const bashTools = tools.filter((t) => t.tool_name === "Bash");
    acc["PostToolUse(Bash)"].totalSignal += bashTools.length;
    acc["PostToolUse(Bash)"].breakdown["bash_tool_entries"] =
      (acc["PostToolUse(Bash)"].breakdown["bash_tool_entries"] ?? 0) + bashTools.length;
    if (bashTools.length > 0) acc["PostToolUse(Bash)"].episodesWithSignal += 1;

    // ---- PostToolUseFailure --------------------------------------------------
    const failures = readJsonlLines<FailureRow>(path.join(dir, "failures.jsonl"));
    // Dedupe by tool_call_id per spec (PostToolUseFailure + PostToolUse can both write the same row).
    const uniqueFailures = new Set(
      failures.map((f) => f.tool_call_id ?? "").filter(Boolean),
    );
    const failCount = uniqueFailures.size || failures.length;
    acc["PostToolUseFailure"].totalSignal += failCount;
    acc["PostToolUseFailure"].breakdown["failures_captured"] =
      (acc["PostToolUseFailure"].breakdown["failures_captured"] ?? 0) + failCount;
    if (failCount > 0) acc["PostToolUseFailure"].episodesWithSignal += 1;

    // ---- PreCompact ----------------------------------------------------------
    const snapshots = countSnapshotFiles(dir);
    acc["PreCompact"].totalSignal += snapshots;
    acc["PreCompact"].breakdown["snapshots_written"] =
      (acc["PreCompact"].breakdown["snapshots_written"] ?? 0) + snapshots;
    if (snapshots > 0) acc["PreCompact"].episodesWithSignal += 1;

    // ---- SessionEnd ----------------------------------------------------------
    // Signal: reflection was queued or completed.
    const reflectionStatus = meta?.reflection?.status;
    if (reflectionStatus) {
      acc["SessionEnd"].breakdown["reflections_queued"] =
        (acc["SessionEnd"].breakdown["reflections_queued"] ?? 0) + 1;
      acc["SessionEnd"].totalSignal += 1;
      if (reflectionStatus === "complete") {
        acc["SessionEnd"].breakdown["reflections_complete"] =
          (acc["SessionEnd"].breakdown["reflections_complete"] ?? 0) + 1;
      }
    }
    // Also count via hooks_fired_count if reflection is absent but session_end fired.
    const sessionEndFired = meta?.hooks_fired_count?.session_end ?? 0;
    if (sessionEndFired > 0 && !reflectionStatus) {
      acc["SessionEnd"].totalSignal += 1;
      acc["SessionEnd"].breakdown["reflections_queued"] =
        (acc["SessionEnd"].breakdown["reflections_queued"] ?? 0) + 1;
    }
    if (sessionEndFired > 0 || reflectionStatus) {
      acc["SessionEnd"].episodesWithSignal += 1;
    }
  }

  return finish(acc, episodesScanned, windowDays, episodeIds);
}

function finish(
  acc: Record<HookName, { totalSignal: number; episodesWithSignal: number; breakdown: Record<string, number> }>,
  episodesScanned: number,
  windowDays: number,
  episodeIds: string[],
): MetricsResult {
  const metrics: HookMetrics[] = HOOK_NAMES.map((hook) => ({
    hook,
    signal: acc[hook],
  }));
  return { episodesScanned, windowDays, metrics, episodeIds };
}
