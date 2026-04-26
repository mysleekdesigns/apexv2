import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { projectPaths } from "../util/paths.js";
import { validateProposal, stripProposedHeader } from "./validate.js";
import type { KnowledgeType } from "../types/shared.js";

/** Map from knowledge type to its subdirectory under .apex/knowledge/. */
const TYPE_TO_DIR: Record<KnowledgeType, string> = {
  decision: "decisions",
  pattern: "patterns",
  gotcha: "gotchas",
  convention: "conventions",
};

export type PromoteStatus = "promoted" | "skipped" | "error";

export interface PromoteResult {
  status: PromoteStatus;
  proposalPath: string;
  /** Destination path — set on status==="promoted". */
  destPath?: string;
  /** Human-readable reason — set on status!=="promoted". */
  reason?: string;
}

export interface PromoteOptions {
  /** When true, overwrite an existing knowledge file. Default false. */
  force?: boolean;
  /** When true, validate and compute destination but do not write or delete. */
  dryRun?: boolean;
}

/**
 * Promote a single proposal file into the knowledge store.
 *
 * - Strips the `<!-- PROPOSED — ... -->` header line.
 * - Validates frontmatter; refuses on failure.
 * - Computes destination: `.apex/knowledge/{type-dir}/<id>.md`.
 * - Refuses (returns skipped) if destination exists unless opts.force===true.
 * - Updates `last_validated` to today's date.
 * - Removes the source proposal file on success.
 */
export async function promoteProposal(
  root: string,
  proposalPath: string,
  opts: PromoteOptions = {},
): Promise<PromoteResult> {
  const validation = await validateProposal(proposalPath);
  if (!validation.valid) {
    return {
      status: "error",
      proposalPath,
      reason: (validation.errors ?? ["validation failed"]).join("; "),
    };
  }

  const fm = validation.frontmatter!;
  const type = fm["type"] as KnowledgeType;
  const id = fm["id"] as string;
  const body = validation.body ?? "";

  const paths = projectPaths(root);
  const typeDir = TYPE_TO_DIR[type];
  const destPath = path.join(paths.knowledgeDir, typeDir, `${id}.md`);

  // Conflict check — refuse unless force.
  if (!opts.dryRun) {
    let destExists = false;
    try {
      await fs.access(destPath);
      destExists = true;
    } catch {
      // does not exist — good
    }

    if (destExists && !opts.force) {
      return {
        status: "skipped",
        proposalPath,
        destPath,
        reason: "destination exists",
      };
    }
  }

  // Stamp last_validated with today.
  const today = new Date().toISOString().slice(0, 10);
  const updatedFm = { ...fm, last_validated: today };

  // Serialise back to frontmatter + body.
  const fmYaml = yaml
    .stringify(updatedFm, {
      lineWidth: 0,
      defaultStringType: "QUOTE_DOUBLE",
      defaultKeyType: "PLAIN",
    })
    .trimEnd();
  const output = `---\n${fmYaml}\n---\n\n${body}\n`;

  if (opts.dryRun) {
    return { status: "promoted", proposalPath, destPath };
  }

  // Ensure destination directory exists.
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await fs.writeFile(destPath, output, "utf8");

  // Remove source proposal.
  await fs.unlink(proposalPath);

  return { status: "promoted", proposalPath, destPath };
}

/**
 * Read the raw content of a proposal file, stripping the PROPOSED header,
 * so callers can inspect it without running a full validation pass.
 * Returns null if the file cannot be read.
 */
export async function readProposalContent(proposalPath: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(proposalPath, "utf8");
    return stripProposedHeader(raw);
  } catch {
    return null;
  }
}
