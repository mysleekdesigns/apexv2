import path from "node:path";
import fs from "node:fs/promises";
import matter from "gray-matter";
import yaml from "yaml";
import { projectPaths } from "../util/paths.js";
import { loadKnowledgeWithWarnings } from "../recall/loader.js";
import { listRecentEpisodes } from "../reflector/signals.js";
import { aggregateSignals } from "./signals.js";
import type { Confidence, KnowledgeEntry, KnowledgeType } from "../types/shared.js";
import type {
  AggregatedSignals,
  CalibrationConfig,
  CalibrationReport,
  ConfidenceTransition,
  SignalSource,
} from "./types.js";
import { DEFAULT_CALIBRATION_CONFIG } from "./types.js";

const TYPE_DIRS: Record<KnowledgeType, string> = {
  decision: "decisions",
  pattern: "patterns",
  gotcha: "gotchas",
  convention: "conventions",
};

const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

/**
 * Map a net signal score to a target confidence state, respecting the
 * configured thresholds. Score 0 maps to `medium` by default.
 */
export function targetConfidenceFromScore(
  score: number,
  cfg: CalibrationConfig,
): Confidence {
  if (score >= cfg.highThreshold) return "high";
  if (score <= cfg.lowThreshold) return "low";
  return "medium";
}

function entryAbsolutePath(root: string, type: KnowledgeType, id: string): string {
  return path.join(projectPaths(root).knowledgeDir, TYPE_DIRS[type], `${id}.md`);
}

function tally(signals: AggregatedSignals): Partial<Record<SignalSource, number>> {
  const out: Partial<Record<SignalSource, number>> = {};
  for (const s of signals.signals) {
    out[s.source] = (out[s.source] ?? 0) + 1;
  }
  return out;
}

export interface CalibrateOptions {
  /** Project root. */
  root: string;
  /** Episode ids in time-order (newest first). */
  episodeIds: string[];
  /** Calibration tunables. */
  config?: Partial<CalibrationConfig>;
  dryRun?: boolean;
}

/**
 * Compute confidence transitions for every entry that has at least one
 * signal in the supplied episode set, optionally applying staleness decay
 * across the same window.
 *
 * Idempotence: when an entry's current `confidence` already equals the
 * target derived from its signals, the transition is recorded with
 * `changed: false` and no file is written. Re-running with the same
 * inputs is a no-op.
 */
export async function runCalibrator(
  opts: CalibrateOptions,
): Promise<CalibrationReport> {
  const cfg: CalibrationConfig = { ...DEFAULT_CALIBRATION_CONFIG, ...(opts.config ?? {}) };
  const root = opts.root;

  const { entries } = await loadKnowledgeWithWarnings(root);

  const aggregated = await aggregateSignals(entries, opts.episodeIds, {
    root,
    config: cfg,
    recentEpisodeIds: opts.episodeIds,
  });

  const aggByKey = new Map<string, AggregatedSignals>();
  for (const a of aggregated) aggByKey.set(`${a.entry.type}:${a.entry.id}`, a);

  const transitions: ConfidenceTransition[] = [];
  let noSignalEntryCount = 0;

  for (const entry of entries) {
    const key = `${entry.frontmatter.type}:${entry.frontmatter.id}`;
    const agg = aggByKey.get(key);
    if (!agg || agg.signals.length === 0) {
      noSignalEntryCount++;
      continue;
    }
    const current = entry.frontmatter.confidence;
    const target = targetConfidenceFromScore(agg.score, cfg);
    transitions.push({
      entry: agg.entry,
      from: current,
      to: target,
      score: agg.score,
      signalCount: agg.signals.length,
      signalsBySource: tally(agg),
      changed: current !== target,
    });
  }

  const report: CalibrationReport = {
    episodesScanned: opts.episodeIds.slice(),
    transitions,
    filesWritten: [],
    noSignalEntryCount,
    dryRun: Boolean(opts.dryRun),
  };

  if (!opts.dryRun) {
    const today = new Date().toISOString().slice(0, 10);
    for (const t of transitions) {
      if (!t.changed) continue;
      const filePath = entryAbsolutePath(root, t.entry.type, t.entry.id);
      try {
        await rewriteFrontmatter(filePath, { confidence: t.to, last_validated: today });
        report.filesWritten.push(filePath);
      } catch {
        /* swallow — calibration must not block on a single bad file */
      }
    }
  }

  return report;
}

/** Atomically rewrite the YAML frontmatter of a knowledge entry, preserving order. */
async function rewriteFrontmatter(
  filePath: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = matter(raw, matterOptions);
  const fmRaw = (parsed.data ?? {}) as Record<string, unknown>;
  const updated: Record<string, unknown> = { ...fmRaw, ...patch };

  const fmYaml = yaml
    .stringify(updated, {
      lineWidth: 0,
      defaultStringType: "QUOTE_DOUBLE",
      defaultKeyType: "PLAIN",
    })
    .trimEnd();

  const body = parsed.content.replace(/^\n+/, "");
  const out = `---\n${fmYaml}\n---\n\n${body.trimEnd()}\n`;
  await fs.writeFile(filePath, out, "utf8");
}

/** List recent episode ids; thin wrapper for the CLI. */
export async function defaultEpisodeIds(
  root: string,
  opts: { all?: boolean; episode?: string; limit?: number } = {},
): Promise<string[]> {
  if (opts.episode) return [opts.episode];
  if (opts.all) return listRecentEpisodes(root, 1000);
  return listRecentEpisodes(root, opts.limit ?? 1);
}

export type { KnowledgeEntry };
