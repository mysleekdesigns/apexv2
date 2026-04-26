// index.ts — orchestrator for PR mining.
//
// Calls git.ts to read commits, extractor.ts to classify signals, proposer.ts
// to build DraftEntry objects, then writes them to .apex/proposed/ following
// the same contract as the reflector/archaeologist.

import path from "node:path";
import fs from "fs-extra";
import yaml from "yaml";
import { projectPaths } from "../util/paths.js";
import { readCommits, readMergedPrs } from "./git.js";
import { extractCandidates } from "./extractor.js";
import { proposeCandidates } from "./proposer.js";
import type { RunGitFn } from "./git.js";
import type { DraftEntry } from "./proposer.js";

export const PROPOSED_HEADER =
  "<!-- PROPOSED — review before moving to .apex/knowledge/ -->";

export interface PrMiningOpts {
  /** Git ref to start from (e.g. `HEAD~50` or a commit SHA). Default: HEAD~50 */
  since?: string;
  /** Maximum number of commits to examine. Default: 50 */
  limit?: number;
  /** If true, also fetch PR review comments via `gh` CLI. Default: false */
  includeReviews?: boolean;
  /** If true, do not write files — just report what would be written. */
  dryRun?: boolean;
  /** Seam for unit-testing: replace the real execFile-based git runner. */
  runGit?: RunGitFn;
}

export interface PrMiningReport {
  commitsScanned: number;
  candidatesFound: number;
  proposalsWritten: string[];
  proposalsSkipped: Array<{ path: string; reason: string }>;
  prsScanned: number;
}

function serialize(draft: DraftEntry): string {
  const fmYaml = yaml
    .stringify(draft.frontmatter, {
      lineWidth: 0,
      defaultStringType: "QUOTE_DOUBLE",
      defaultKeyType: "PLAIN",
    })
    .trimEnd();
  return `${PROPOSED_HEADER}\n---\n${fmYaml}\n---\n\n${draft.body.trim()}\n`;
}

export async function runPrMining(
  root: string,
  opts: PrMiningOpts = {},
): Promise<PrMiningReport> {
  const paths = projectPaths(root);
  const report: PrMiningReport = {
    commitsScanned: 0,
    candidatesFound: 0,
    proposalsWritten: [],
    proposalsSkipped: [],
    prsScanned: 0,
  };

  // 1. Read commits
  const gitResult = await readCommits(root, {
    since: opts.since,
    limit: opts.limit,
    runGit: opts.runGit,
  });

  if (!gitResult.available) {
    // Nothing to do — not a git repo or git failed
    return report;
  }

  report.commitsScanned = gitResult.commits.length;

  // 2. Optionally read merged PRs via gh CLI
  let prs: Awaited<ReturnType<typeof readMergedPrs>> = [];
  if (opts.includeReviews) {
    prs = await readMergedPrs(root, { limit: opts.limit });
  }
  report.prsScanned = prs.length;

  // 3. Extract candidates
  const candidates = extractCandidates(gitResult.commits, prs, {
    includePrBodies: opts.includeReviews,
  });
  report.candidatesFound = candidates.length;

  if (candidates.length === 0) return report;

  // 4. Convert to DraftEntry proposals
  const drafts = proposeCandidates(candidates);

  // 5. Write to .apex/proposed/
  if (!opts.dryRun) {
    await fs.ensureDir(paths.proposedDir);
  }

  for (const draft of drafts) {
    const target = path.join(paths.proposedDir, `${draft.frontmatter.id}.md`);
    if (opts.dryRun) {
      report.proposalsWritten.push(target);
      continue;
    }
    if (await fs.pathExists(target)) {
      report.proposalsSkipped.push({ path: target, reason: "exists" });
      continue;
    }
    await fs.writeFile(target, serialize(draft), "utf8");
    report.proposalsWritten.push(target);
  }

  return report;
}
