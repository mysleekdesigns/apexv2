// Writes merge proposals into .apex/proposed/_merge-<discardId>-into-<keepId>.md
//
// Uses the same `<!-- PROPOSED -->` header convention as src/archaeologist/writer.ts.

import path from "node:path";
import fs from "fs-extra";
import type { DedupedCluster } from "./dedupe.js";
import { projectPaths } from "../util/paths.js";

export const PROPOSED_HEADER =
  "<!-- PROPOSED — review before moving to .apex/knowledge/ -->";

function renderMergeProposal(cluster: DedupedCluster): string {
  const { keepId, discardId, pair } = cluster;
  const score = (pair.score * 100).toFixed(1);
  const lines: string[] = [];
  lines.push(PROPOSED_HEADER);
  lines.push("");
  lines.push(`# Merge proposal: \`${discardId}\` → \`${keepId}\``);
  lines.push("");
  lines.push("**Action:** Review and merge the lower-confidence entry into the higher.");
  lines.push("");
  lines.push("## Details");
  lines.push("");
  lines.push(`| Field | Keep (\`${keepId}\`) | Discard (\`${discardId}\`) |`);
  lines.push(`|---|---|---|`);
  lines.push(
    `| title | ${pair.a.frontmatter.id === keepId ? pair.a.frontmatter.title : pair.b.frontmatter.title} | ` +
      `${pair.a.frontmatter.id === discardId ? pair.a.frontmatter.title : pair.b.frontmatter.title} |`,
  );
  const keepEntry = pair.a.frontmatter.id === keepId ? pair.a : pair.b;
  const discardEntry = pair.a.frontmatter.id === discardId ? pair.a : pair.b;
  lines.push(`| confidence | ${keepEntry.frontmatter.confidence} | ${discardEntry.frontmatter.confidence} |`);
  lines.push(`| applies_to | ${keepEntry.frontmatter.applies_to} | ${discardEntry.frontmatter.applies_to} |`);
  lines.push(`| path | \`${keepEntry.path}\` | \`${discardEntry.path}\` |`);
  lines.push("");
  lines.push(
    `Similarity: **${score}%** via ${pair.via} (Jaccard on ${pair.via === "title" ? "normalised title" : "first 200 chars of body"}).`,
  );
  lines.push("");
  lines.push("## Suggested action");
  lines.push("");
  lines.push(
    `1. Keep \`${keepId}\` as the canonical entry in \`.apex/knowledge/\`.`,
  );
  lines.push(
    `2. Merge any unique content from \`${discardId}\` into the body of \`${keepId}\`.`,
  );
  lines.push(
    `3. Delete \`${discardEntry.path}\` (or move to \`.apex/proposed/\` for archival).`,
  );
  lines.push(
    `4. Add \`${discardId}\` to the \`supersedes\` list of \`${keepId}\`.`,
  );
  lines.push("");
  return lines.join("\n");
}

export interface ProposalResult {
  written: string[];
  skipped: Array<{ path: string; reason: string }>;
}

/**
 * Write merge proposal files for all clusters where `proposeMerge === true`.
 * Returns the list of file paths written (absolute).
 */
export async function writeMergeProposals(
  root: string,
  clusters: DedupedCluster[],
  opts: { dryRun?: boolean } = {},
): Promise<ProposalResult> {
  const paths = projectPaths(root);
  const result: ProposalResult = { written: [], skipped: [] };

  const toPropose = clusters.filter((c) => c.proposeMerge);
  if (toPropose.length === 0) return result;

  if (!opts.dryRun) {
    await fs.ensureDir(paths.proposedDir);
  }

  for (const cluster of toPropose) {
    const filename = `_merge-${cluster.discardId}-into-${cluster.keepId}.md`;
    const target = path.join(paths.proposedDir, filename);

    if (opts.dryRun) {
      result.written.push(target);
      continue;
    }

    // Overwrite on re-run (unlike archaeologist proposals, merges are
    // deterministic given the same knowledge state).
    const content = renderMergeProposal(cluster);
    await fs.writeFile(target, content, "utf8");
    result.written.push(target);
  }

  return result;
}
