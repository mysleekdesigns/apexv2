// Curator orchestrator — entry point for `apex curate`.
//
// Report-only: writes only the curation summary and merge proposals.
// NEVER mutates .apex/knowledge/ entries directly.

import path from "node:path";
import fs from "fs-extra";
import { loadKnowledgeWithWarnings } from "../recall/loader.js";
import { projectPaths } from "../util/paths.js";
import { findDuplicates } from "./dedupe.js";
import { findStaleEntries } from "./stale.js";
import { findDriftEntries } from "./drift.js";
import { writeMergeProposals } from "./proposals.js";
import { renderSummary } from "./summary.js";
import type { DedupedCluster } from "./dedupe.js";
import type { StaleEntry } from "./stale.js";
import type { DriftEntry } from "./drift.js";

export interface CurationReport {
  duplicateClusters: DedupedCluster[];
  staleEntries: StaleEntry[];
  driftEntries: DriftEntry[];
  summaryPath: string;
  mergeProposals: string[];
}

export interface CuratorOpts {
  dryRun?: boolean;
  staleDays?: number;
  /** Override "today" for deterministic tests. */
  now?: Date;
}

export async function runCurator(
  root: string,
  opts: CuratorOpts = {},
): Promise<CurationReport> {
  const staleDays = opts.staleDays ?? 30;
  const now = opts.now ?? new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const paths = projectPaths(root);

  // Load knowledge entries — tolerates missing knowledge dir gracefully.
  const warnings: string[] = [];
  const { entries } = await loadKnowledgeWithWarnings(root, {
    onWarn: (m) => warnings.push(m),
  });

  // Run all three detectors.
  const duplicateClusters = findDuplicates(entries);
  const staleEntries = findStaleEntries(entries, paths.episodesDir, now, staleDays);
  const driftEntries = findDriftEntries(entries, root);

  // Write merge proposals for clusters where proposeMerge is true.
  const proposalResult = await writeMergeProposals(root, duplicateClusters, {
    dryRun: opts.dryRun,
  });
  const mergeProposals = proposalResult.written;

  // Write curation summary.
  const summaryDir = path.join(paths.apexDir, "curation");
  const summaryPath = path.join(summaryDir, `${dateStr}.md`);

  if (!opts.dryRun) {
    await fs.ensureDir(summaryDir);
    const summaryContent = renderSummary({
      date: dateStr,
      duplicateClusters,
      staleEntries,
      driftEntries,
      mergeProposals,
    });
    await fs.writeFile(summaryPath, summaryContent, "utf8");
  }

  return {
    duplicateClusters,
    staleEntries,
    driftEntries,
    summaryPath,
    mergeProposals,
  };
}
