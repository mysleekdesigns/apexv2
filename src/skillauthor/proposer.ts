// Pure proposer for skill auto-authoring.
//
// Converts detected patterns into SKILL.md draft objects.
// Frontmatter follows templates/claude/skills/apex-recall/SKILL.md shape:
//   name, description
//
// Draft format:
//   slug: generated from shape, e.g. ["Bash","Edit","Bash"] → "bash-edit-bash"
//   frontmatter: { name, description }
//   body: full SKILL.md body (after the closing --- delimiter)

import type { DetectedPattern } from "./patterns.js";

export interface SkillDraft {
  slug: string;
  frontmatter: {
    name: string;
    description: string;
  };
  body: string;
}

const MAX_SLUG_LENGTH = 48;

/** Generate a skill slug from the tool shape. */
export function shapeToSlug(shape: string[]): string {
  return shape
    .map((t) =>
      t
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .join("-")
    .slice(0, MAX_SLUG_LENGTH);
}

/** Generate a human-readable summary of the pattern. */
function humanSummary(shape: string[]): string {
  const tools = shape
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase())
    .join(" → ");
  return `Workflow: ${tools}`;
}

/** Generate a "when to use" heuristic based on the tool sequence. */
function whenToUse(shape: string[]): string {
  const lower = shape.map((t) => t.toLowerCase());

  // Check for common patterns
  const hasBash = lower.includes("bash");
  const hasEdit = lower.includes("edit") || lower.includes("write");
  const hasRead = lower.includes("read");

  const examples: string[] = [];

  if (hasBash && hasEdit && hasBash) {
    examples.push(
      "When Bash + Edit + Bash repeats, you are likely iterating on a build or test step",
    );
  }
  if (hasRead && hasEdit) {
    examples.push(
      "When Read + Edit repeats, you are likely making targeted modifications to existing files",
    );
  }
  if (hasBash && !hasEdit) {
    examples.push("When running a sequence of shell commands to achieve a goal");
  }

  if (examples.length === 0) {
    examples.push(
      `When you need to perform a ${shape.join(" → ")} workflow sequence`,
    );
  }

  return examples.join(". ");
}

/** Count distinct episodes in examples. */
function countEpisodes(pattern: DetectedPattern): number {
  return new Set(pattern.examples.map((e) => e.episodeId)).size;
}

export function proposeSkillDrafts(patterns: DetectedPattern[]): SkillDraft[] {
  const drafts: SkillDraft[] = [];
  const seenSlugs = new Set<string>();

  for (const pattern of patterns) {
    const slug = shapeToSlug(pattern.shape);

    // Deduplicate by slug
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    const episodeCount = countEpisodes(pattern);
    const summary = humanSummary(pattern.shape);
    const name = `apex-auto-${slug}`;
    const description = `Auto-detected workflow — ${summary}. Detected ${pattern.occurrences} times across ${episodeCount} episode(s).`;

    // Build numbered list of tool sequence
    const toolList = pattern.shape
      .map((tool, i) => `${i + 1}. ${tool.charAt(0).toUpperCase() + tool.slice(1).toLowerCase()}`)
      .join("\n");

    // Evidence: cap at 5 examples
    const evidenceItems = pattern.examples.slice(0, 5).map(
      (ex) => `- Episode \`${ex.episodeId}\` starting at turn ${ex.startTurn}`,
    );

    const body = [
      `# ${name}`,
      "",
      "This skill captures a recurring workflow detected by APEX.",
      "",
      "## Pattern",
      "",
      toolList,
      "",
      "## When to use",
      "",
      whenToUse(pattern.shape),
      "",
      "## Evidence",
      "",
      ...evidenceItems,
    ].join("\n");

    drafts.push({
      slug,
      frontmatter: { name, description },
      body,
    });
  }

  return drafts;
}
