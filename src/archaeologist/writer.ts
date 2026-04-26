import path from "node:path";
import fs from "fs-extra";
import yaml from "yaml";
import { projectPaths } from "../util/paths.js";
import type { DraftEntry } from "./proposer.js";

export const PROPOSED_HEADER = "<!-- PROPOSED — review before moving to .apex/knowledge/ -->";

export interface WriteResult {
  written: string[];
  skipped: Array<{ path: string; reason: string }>;
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

export async function writeProposals(
  root: string,
  drafts: DraftEntry[],
  pendingStack: string,
  opts: { dryRun?: boolean } = {},
): Promise<WriteResult> {
  const paths = projectPaths(root);
  const out: WriteResult = { written: [], skipped: [] };

  if (!opts.dryRun) {
    await fs.ensureDir(paths.proposedDir);
  }

  const stackPath = path.join(paths.proposedDir, "_pending-stack.md");
  const stackBody = `${PROPOSED_HEADER}\n\n${pendingStack.trim()}\n`;
  if (opts.dryRun) {
    out.written.push(stackPath);
  } else if (await fs.pathExists(stackPath)) {
    out.skipped.push({ path: stackPath, reason: "exists (will not overwrite)" });
  } else {
    await fs.writeFile(stackPath, stackBody, "utf8");
    out.written.push(stackPath);
  }

  for (const draft of drafts) {
    const target = path.join(paths.proposedDir, `${draft.frontmatter.id}.md`);
    if (opts.dryRun) {
      out.written.push(target);
      continue;
    }
    if (await fs.pathExists(target)) {
      out.skipped.push({ path: target, reason: "exists" });
      continue;
    }
    await fs.writeFile(target, serialize(draft), "utf8");
    out.written.push(target);
  }

  return out;
}
