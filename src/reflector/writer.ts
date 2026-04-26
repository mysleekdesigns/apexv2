// Proposal writer for the reflector.
//
// Mirrors src/archaeologist/writer.ts — re-exports PROPOSED_HEADER and
// provides writeReflectionProposals which serialises DraftEntry[] to
// .apex/proposed/<id>.md. Skips files that already exist (never clobbers).

import path from "node:path";
import fs from "fs-extra";
import yaml from "yaml";
import { projectPaths } from "../util/paths.js";
export { PROPOSED_HEADER } from "../archaeologist/writer.js";
import { PROPOSED_HEADER } from "../archaeologist/writer.js";
import type { DraftEntry } from "./proposer.js";

export interface ReflectionWriteResult {
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

export async function writeReflectionProposals(
  root: string,
  drafts: DraftEntry[],
  opts: { dryRun?: boolean } = {},
): Promise<ReflectionWriteResult> {
  const paths = projectPaths(root);
  const out: ReflectionWriteResult = { written: [], skipped: [] };

  if (!opts.dryRun) {
    await fs.ensureDir(paths.proposedDir);
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
