// Curator orchestrator — entry point for `apex curate`.
//
// Report-only by default: writes the curation summary and merge proposals only.
// With `markVerified: true`, also writes `verified: false` + `drift_report:`
// frontmatter back to flagged knowledge entries (Phase 4.3 opt-in).

import path from "node:path";
import fs from "fs-extra";
import { loadKnowledgeWithWarnings } from "../recall/loader.js";
import { projectPaths } from "../util/paths.js";
import { findDuplicates } from "./dedupe.js";
import { findStaleEntries } from "./stale.js";
import {
  findDriftEntries,
  findAllDrift,
  severityBreakdown,
  type DriftHit,
  type DriftSeverityCounts,
} from "./drift.js";
import { writeMergeProposals } from "./proposals.js";
import { renderSummary } from "./summary.js";
import { applyDriftFlags, type VerifyResult } from "./verify.js";
import { CodeIndex } from "../codeindex/index.js";
import type { DedupedCluster } from "./dedupe.js";
import type { StaleEntry } from "./stale.js";
import type { DriftEntry } from "./drift.js";

export interface CurationReport {
  duplicateClusters: DedupedCluster[];
  staleEntries: StaleEntry[];
  driftEntries: DriftEntry[];
  driftHits: DriftHit[];
  driftSeverity: DriftSeverityCounts;
  summaryPath: string;
  mergeProposals: string[];
  verifyResult: VerifyResult | null;
}

export interface CuratorOpts {
  dryRun?: boolean;
  staleDays?: number;
  /** Override "today" for deterministic tests. */
  now?: Date;
  /** Skip dedupe + stale; run only drift detection. */
  driftOnly?: boolean;
  /** Write `verified: false` + `drift_report:` to flagged knowledge entries. */
  markVerified?: boolean;
}

export async function runCurator(
  root: string,
  opts: CuratorOpts = {},
): Promise<CurationReport> {
  const staleDays = opts.staleDays ?? 30;
  const now = opts.now ?? new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const paths = projectPaths(root);

  const warnings: string[] = [];
  const { entries } = await loadKnowledgeWithWarnings(root, {
    onWarn: (m) => warnings.push(m),
  });

  // Dedupe + stale skipped under --drift-only.
  const duplicateClusters = opts.driftOnly ? [] : findDuplicates(entries);
  const staleEntries = opts.driftOnly
    ? []
    : findStaleEntries(entries, paths.episodesDir, now, staleDays);

  // Phase 2 (gotcha-only) drift list — kept for backwards-compat in the report.
  const driftEntries = findDriftEntries(entries, root);

  // Extended (Phase 4.3) drift detection across all four kinds.
  const codeIndexPath = path.join(paths.indexDir, "symbols.sqlite");
  let codeIndex: CodeIndex | null = null;
  if (fs.existsSync(codeIndexPath)) {
    try {
      codeIndex = new CodeIndex(root);
    } catch {
      codeIndex = null;
    }
  }
  let extended;
  try {
    extended = await findAllDrift(entries, root, {
      codeIndex,
      useGrepFallback: codeIndex === null,
    });
  } finally {
    codeIndex?.close();
  }

  const driftHits = extended.hits;
  const driftSeverity = severityBreakdown(driftHits);

  // Merge proposals (skipped in drift-only mode since dedupe is skipped).
  const proposalResult = await writeMergeProposals(root, duplicateClusters, {
    dryRun: opts.dryRun,
  });
  const mergeProposals = proposalResult.written;

  // Optional: write verified:false + drift_report frontmatter back.
  let verifyResult: VerifyResult | null = null;
  if (opts.markVerified) {
    verifyResult = await applyDriftFlags(root, entries, extended.byEntry, {
      today: dateStr,
      dryRun: opts.dryRun,
    });
  }

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
      driftSeverity,
    });
    await fs.writeFile(summaryPath, summaryContent, "utf8");
  }

  return {
    duplicateClusters,
    staleEntries,
    driftEntries,
    driftHits,
    driftSeverity,
    summaryPath,
    mergeProposals,
    verifyResult,
  };
}
