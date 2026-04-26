import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import yaml from "yaml";
import { projectPaths } from "../util/paths.js";
import { validateFrontmatter, stripProposedHeader } from "./validate.js";
import type { ApexConfig } from "../config/index.js";
import type { Confidence, KnowledgeType } from "../types/shared.js";

const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

const TYPE_DIRS: Record<KnowledgeType, string> = {
  decision: "decisions",
  pattern: "patterns",
  gotcha: "gotchas",
  convention: "conventions",
};

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export interface EligibleProposal {
  /** Absolute path to the proposal file. */
  proposalPath: string;
  /** Parsed frontmatter — available when eligible. */
  frontmatter: Record<string, unknown>;
  /** true = eligible for auto-promotion. */
  eligible: boolean;
  /** Why it was queued (eligible === false). */
  reason?: string;
}

/**
 * Scan .apex/proposed/ and evaluate each proposal against auto-merge rules.
 *
 * Rules (all must pass for eligible === true):
 * 1. Valid frontmatter.
 * 2. Confidence >= config.auto_merge.min_confidence.
 * 3. No conflict in .apex/knowledge/:
 *    a. No file at .apex/knowledge/<type-dir>/<id>.md, AND
 *    b. No existing entry whose `supersedes` array contains this id.
 * 4. sources[].length >= config.auto_merge.threshold.
 */
export async function findEligible(
  root: string,
  config: ApexConfig,
): Promise<EligibleProposal[]> {
  const paths = projectPaths(root);
  const results: EligibleProposal[] = [];

  let files: string[];
  try {
    files = await fs.readdir(paths.proposedDir);
  } catch {
    // No proposed dir — nothing to do.
    return [];
  }

  // Build conflict index from knowledge/ up front so we don't re-scan per proposal.
  const conflictIndex = await buildConflictIndex(paths.knowledgeDir);

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    // Skip files starting with underscore (e.g. _pending-stack.md).
    if (file.startsWith("_")) continue;

    const proposalPath = path.join(paths.proposedDir, file);
    let raw: string;
    try {
      raw = await fs.readFile(proposalPath, "utf8");
    } catch {
      results.push({
        proposalPath,
        frontmatter: {},
        eligible: false,
        reason: "could not read file",
      });
      continue;
    }

    const stripped = stripProposedHeader(raw);
    const validation = validateFrontmatter(stripped, proposalPath);

    if (!validation.valid) {
      results.push({
        proposalPath,
        frontmatter: {},
        eligible: false,
        reason: `invalid frontmatter: ${(validation.errors ?? []).join("; ")}`,
      });
      continue;
    }

    const fm = validation.frontmatter!;
    const id = fm["id"] as string;
    const type = fm["type"] as KnowledgeType;
    const confidence = fm["confidence"] as Confidence;
    const sources = (fm["sources"] as unknown[]) ?? [];

    // Rule 2: confidence check.
    const minRank = CONFIDENCE_RANK[config.auto_merge.min_confidence];
    if (CONFIDENCE_RANK[confidence] < minRank) {
      results.push({
        proposalPath,
        frontmatter: fm,
        eligible: false,
        reason: `confidence '${confidence}' is below min_confidence '${config.auto_merge.min_confidence}'`,
      });
      continue;
    }

    // Rule 3: conflict check.
    if (config.auto_merge.require_no_conflict) {
      const typeDir = TYPE_DIRS[type];
      const destFile = path.join(paths.knowledgeDir, typeDir, `${id}.md`);
      let destExists = false;
      try {
        await fs.access(destFile);
        destExists = true;
      } catch {
        // Good — doesn't exist.
      }

      if (destExists) {
        results.push({
          proposalPath,
          frontmatter: fm,
          eligible: false,
          reason: `knowledge entry '${id}' already exists at ${destFile}`,
        });
        continue;
      }

      // Check if any existing entry supersedes this id.
      if (conflictIndex.has(id)) {
        results.push({
          proposalPath,
          frontmatter: fm,
          eligible: false,
          reason: `existing entry supersedes '${id}'`,
        });
        continue;
      }
    }

    // Rule 4: threshold check.
    if (sources.length < config.auto_merge.threshold) {
      results.push({
        proposalPath,
        frontmatter: fm,
        eligible: false,
        reason: `sources count (${sources.length}) is below threshold (${config.auto_merge.threshold})`,
      });
      continue;
    }

    results.push({ proposalPath, frontmatter: fm, eligible: true });
  }

  return results;
}

/**
 * Build a set of proposal IDs that are superseded by an existing knowledge entry.
 * An entry "supersedes" a proposal when it has `supersedes: [<proposal-id>]` in frontmatter.
 */
async function buildConflictIndex(knowledgeDir: string): Promise<Set<string>> {
  const supersededIds = new Set<string>();

  let typeDirs: string[];
  try {
    typeDirs = await fs.readdir(knowledgeDir);
  } catch {
    return supersededIds;
  }

  for (const typeDir of typeDirs) {
    const dirPath = path.join(knowledgeDir, typeDir);
    let files: string[];
    try {
      files = await fs.readdir(dirPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = path.join(dirPath, file);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = matter(raw, matterOptions);
        const supersedes = parsed.data["supersedes"] as string[] | undefined;
        if (Array.isArray(supersedes)) {
          for (const id of supersedes) {
            if (typeof id === "string") supersededIds.add(id);
          }
        }
      } catch {
        // Skip unreadable files.
      }
    }
  }

  return supersededIds;
}
