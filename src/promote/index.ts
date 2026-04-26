import path from "node:path";
import { loadConfig } from "../config/index.js";
import { findEligible } from "./eligibility.js";
import { promoteProposal } from "./move.js";
import { projectPaths } from "../util/paths.js";

export { validateProposal, validateFrontmatter, stripProposedHeader } from "./validate.js";
export type { ValidationResult } from "./validate.js";

export { promoteProposal, readProposalContent } from "./move.js";
export type { PromoteResult, PromoteStatus, PromoteOptions } from "./move.js";

export { findEligible } from "./eligibility.js";
export type { EligibleProposal } from "./eligibility.js";

export type { ApexConfig, AutoMergeConfig } from "../config/index.js";
export { loadConfig, saveConfig, getDefaults } from "../config/index.js";

export interface AutoPromoteReport {
  promoted: import("./move.js").PromoteResult[];
  queued: import("./eligibility.js").EligibleProposal[];
}

/**
 * Convenience: load config, find eligible proposals, promote all of them.
 *
 * @param root  Project root directory (must have .apex/ initialised).
 * @returns Report with every PromoteResult for promoted proposals and
 *          EligibleProposal entries (eligible===false) that were queued.
 */
export async function autoPromoteAll(root: string): Promise<AutoPromoteReport> {
  const config = await loadConfig(root);

  if (!config.auto_merge.enabled) {
    return { promoted: [], queued: [] };
  }

  const candidates = await findEligible(root, config);

  const promoted: import("./move.js").PromoteResult[] = [];
  const queued: import("./eligibility.js").EligibleProposal[] = [];

  for (const candidate of candidates) {
    if (!candidate.eligible) {
      queued.push(candidate);
      continue;
    }
    const result = await promoteProposal(root, candidate.proposalPath);
    promoted.push(result);
  }

  return { promoted, queued };
}

/**
 * Find the absolute path to a proposal by its id, ignoring leading underscores.
 * Returns null when not found.
 */
export async function findProposalById(root: string, id: string): Promise<string | null> {
  const proposedDir = projectPaths(root).proposedDir;
  const fs = await import("node:fs/promises");

  let files: string[];
  try {
    files = await fs.readdir(proposedDir);
  } catch {
    return null;
  }

  // Exact match first (handles `<id>.md`), then strip leading underscores.
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const stem = file.slice(0, -3).replace(/^_+/, "");
    if (stem === id) {
      return path.join(proposedDir, file);
    }
  }

  return null;
}
