// Skill proposal writer for skill auto-authoring.
//
// Writes .apex/proposed-skills/<slug>/SKILL.md with the PROPOSED header.
// Refuses to overwrite existing files (user may have edited them).

import path from "node:path";
import fs from "fs-extra";
import type { SkillDraft } from "./proposer.js";

export const SKILL_PROPOSED_HEADER =
  "<!-- PROPOSED — review before moving to .claude/skills/ -->";

export interface SkillWriteResult {
  written: string[];
  skipped: Array<{ slug: string; reason: string }>;
}

function serialize(draft: SkillDraft): string {
  const fm = [
    "---",
    `name: ${draft.frontmatter.name}`,
    `description: ${draft.frontmatter.description}`,
    "---",
  ].join("\n");

  return `${SKILL_PROPOSED_HEADER}\n${fm}\n\n${draft.body.trim()}\n`;
}

export async function writeSkillDrafts(
  root: string,
  drafts: SkillDraft[],
  opts: { dryRun?: boolean } = {},
): Promise<SkillWriteResult> {
  const proposedSkillsDir = path.join(root, ".apex", "proposed-skills");
  const result: SkillWriteResult = { written: [], skipped: [] };

  if (!opts.dryRun) {
    await fs.ensureDir(proposedSkillsDir);
  }

  for (const draft of drafts) {
    const skillDir = path.join(proposedSkillsDir, draft.slug);
    const target = path.join(skillDir, "SKILL.md");

    if (opts.dryRun) {
      result.written.push(target);
      continue;
    }

    if (await fs.pathExists(target)) {
      result.skipped.push({ slug: draft.slug, reason: "exists" });
      continue;
    }

    await fs.ensureDir(skillDir);
    await fs.writeFile(target, serialize(draft), "utf8");
    result.written.push(target);
  }

  return result;
}
