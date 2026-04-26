// Pure recommender: given aggregated metrics, emit recommendations per hook.
//
// Rules (from PRD):
//   ≥1 useful signal in last window → "keep"
//   0 signals across ≥5 episodes    → "disable"
//   <5 episodes total                → "insufficient-data"

import type { HookMetrics, HookName } from "./metrics.js";

export type RecommendationLabel = "keep" | "disable" | "insufficient-data";

export interface HookRecommendation {
  hook: HookName;
  recommendation: RecommendationLabel;
  reason: string;
  evidence: string[];
}

export interface RecommendationInput {
  metrics: HookMetrics[];
  episodesScanned: number;
  windowDays: number;
  episodeIds: string[];
}

const MIN_EPISODES_FOR_SIGNAL = 5;

export function recommend(input: RecommendationInput): HookRecommendation[] {
  return input.metrics.map((m) => toRecommendation(m, input));
}

function toRecommendation(
  m: HookMetrics,
  input: RecommendationInput,
): HookRecommendation {
  const { hook, signal } = m;
  const { episodesScanned, windowDays, episodeIds } = input;

  // Insufficient data: fewer than MIN_EPISODES for any conclusion.
  if (episodesScanned < MIN_EPISODES_FOR_SIGNAL) {
    return {
      hook,
      recommendation: "insufficient-data",
      reason: `Only ${episodesScanned} episode(s) in the last ${windowDays} days — need ≥${MIN_EPISODES_FOR_SIGNAL} to make a recommendation.`,
      evidence: evidenceList(signal.breakdown, episodeIds, signal.episodesWithSignal),
    };
  }

  // SessionStart is always-keep unless explicitly opted out; it fires every session.
  if (hook === "SessionStart") {
    return {
      hook,
      recommendation: "keep",
      reason: `Fires every session (${signal.totalSignal} session(s) started). Always-keep unless you want to disable APEX episode tracking entirely.`,
      evidence: evidenceList(signal.breakdown, episodeIds, signal.episodesWithSignal),
    };
  }

  // Keep: at least 1 signal was observed.
  if (signal.totalSignal > 0) {
    const reason = buildKeepReason(hook, signal.breakdown, signal.episodesWithSignal, episodesScanned);
    return {
      hook,
      recommendation: "keep",
      reason,
      evidence: evidenceList(signal.breakdown, episodeIds, signal.episodesWithSignal),
    };
  }

  // Disable: no signal across ≥5 episodes.
  const reason = buildDisableReason(hook, episodesScanned, windowDays);
  return {
    hook,
    recommendation: "disable",
    reason,
    evidence: evidenceList(signal.breakdown, episodeIds, signal.episodesWithSignal),
  };
}

function buildKeepReason(
  hook: HookName,
  breakdown: Record<string, number>,
  episodesWithSignal: number,
  episodesScanned: number,
): string {
  switch (hook) {
    case "UserPromptSubmit": {
      const corr = breakdown["corrections"] ?? 0;
      const conf = breakdown["confirmations"] ?? 0;
      const up = breakdown["thumbs_up"] ?? 0;
      const down = breakdown["thumbs_down"] ?? 0;
      const total = breakdown["prompts_total"] ?? 0;
      const signals = corr + conf + up + down;
      const pct = total > 0 ? ((signals / total) * 100).toFixed(1) : "0";
      return (
        `${signals} signal row(s) captured across ${episodesWithSignal}/${episodesScanned} episode(s)` +
        ` (${corr} correction(s), ${conf} confirmation(s), ${up} thumbs-up, ${down} thumbs-down)` +
        ` — ${pct}% of ${total} prompt(s).`
      );
    }
    case "PostToolUse(Bash)": {
      const entries = breakdown["bash_tool_entries"] ?? 0;
      return `${entries} Bash tool row(s) logged across ${episodesWithSignal}/${episodesScanned} episode(s). Tool log fuels gotcha and correction detection.`;
    }
    case "PostToolUseFailure": {
      const fails = breakdown["failures_captured"] ?? 0;
      return `${fails} failure(s) captured across ${episodesWithSignal}/${episodesScanned} episode(s). Failures feed the gotcha detector and repeat-failure analysis.`;
    }
    case "PreCompact": {
      const snaps = breakdown["snapshots_written"] ?? 0;
      return `${snaps} snapshot(s) written across ${episodesWithSignal}/${episodesScanned} episode(s). Snapshots preserve context across compactions.`;
    }
    case "SessionEnd": {
      const queued = breakdown["reflections_queued"] ?? 0;
      const complete = breakdown["reflections_complete"] ?? 0;
      return `${queued} reflection(s) queued, ${complete} completed across ${episodesWithSignal}/${episodesScanned} episode(s). SessionEnd is required for reflection and knowledge promotion.`;
    }
    default:
      return `${episodesWithSignal}/${episodesScanned} episode(s) with signal.`;
  }
}

function buildDisableReason(
  hook: HookName,
  episodesScanned: number,
  windowDays: number,
): string {
  const caveat =
    "Low signal in this project — your usage may differ. Disabling removes overhead but also removes capture capability for that event.";
  switch (hook) {
    case "UserPromptSubmit":
      return `0 corrections, confirmations, or thumbs signals captured across ${episodesScanned} episode(s) in the last ${windowDays} days. ${caveat}`;
    case "PostToolUse(Bash)":
      return `0 Bash tool entries logged across ${episodesScanned} episode(s) in the last ${windowDays} days. ${caveat}`;
    case "PostToolUseFailure":
      return `0 failures captured across ${episodesScanned} episode(s) in the last ${windowDays} days. ${caveat}`;
    case "PreCompact":
      return `0 snapshots written across ${episodesScanned} episode(s) in the last ${windowDays} days (no compaction events triggered). ${caveat}`;
    case "SessionEnd":
      return `0 reflections queued across ${episodesScanned} episode(s) in the last ${windowDays} days. ${caveat}`;
    default:
      return `0 signals across ${episodesScanned} episode(s). ${caveat}`;
  }
}

function evidenceList(
  breakdown: Record<string, number>,
  episodeIds: string[],
  episodesWithSignal: number,
): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(breakdown)) {
    if (v > 0) {
      lines.push(`${k}: ${v}`);
    }
  }
  if (episodesWithSignal > 0 && episodeIds.length > 0) {
    // List up to 5 episode ids that had signal, for traceability.
    const sample = episodeIds.slice(0, 5);
    lines.push(`episode sample: ${sample.join(", ")}${episodeIds.length > 5 ? ` (+${episodeIds.length - 5} more)` : ""}`);
  }
  return lines;
}
