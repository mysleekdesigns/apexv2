// Orchestrator for hook policy analysis.
// runHookPolicy(root, opts) → aggregates metrics, recommends, optionally writes.

import { aggregateMetrics } from "./metrics.js";
import { recommend } from "./recommender.js";
import { renderReport, writeReport } from "./writer.js";
import type { HookRecommendation } from "./recommender.js";

export type { HookRecommendation } from "./recommender.js";
export type { HookMetrics, MetricsResult } from "./metrics.js";

export interface HookPolicyOptions {
  /** Analysis window in days. Default: 14. */
  windowDays?: number;
  /** If true, do not write any files; return rendered markdown instead. */
  dryRun?: boolean;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

export interface HookPolicyReport {
  date: string;
  windowDays: number;
  episodesScanned: number;
  recommendations: HookRecommendation[];
  /** Path to the written file, or null if dry-run. */
  outputPath: string | null;
  /** Rendered markdown (always present — useful for dry-run). */
  markdown: string;
}

export async function runHookPolicy(
  root: string,
  opts: HookPolicyOptions = {},
): Promise<HookPolicyReport> {
  const now = opts.now ?? new Date();
  const windowDays = Math.max(1, opts.windowDays ?? 14);

  // 1. Aggregate
  const metricsResult = aggregateMetrics(root, { windowDays, now });

  // 2. Recommend
  const recommendations = recommend({
    metrics: metricsResult.metrics,
    episodesScanned: metricsResult.episodesScanned,
    windowDays: metricsResult.windowDays,
    episodeIds: metricsResult.episodeIds,
  });

  // 3. Render
  const date = now.toISOString().slice(0, 10);
  const writerInput = {
    date,
    windowDays,
    episodesScanned: metricsResult.episodesScanned,
    recommendations,
  };
  const markdown = renderReport(writerInput);

  // 4. Write (unless dry-run)
  let outputPath: string | null = null;
  if (!opts.dryRun) {
    outputPath = writeReport(root, writerInput);
  }

  return {
    date,
    windowDays,
    episodesScanned: metricsResult.episodesScanned,
    recommendations,
    outputPath,
    markdown,
  };
}
