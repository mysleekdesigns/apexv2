import { describe, it, expect } from "vitest";
import { proposeSkillDrafts, shapeToSlug } from "../../src/skillauthor/proposer.js";
import type { DetectedPattern } from "../../src/skillauthor/patterns.js";

function makePattern(
  shape: string[],
  occurrences: number,
  episodeIds?: string[],
): DetectedPattern {
  const ids = episodeIds ?? [`ep-${occurrences}-a`, `ep-${occurrences}-b`, `ep-${occurrences}-c`];
  return {
    shape,
    occurrences,
    examples: ids.slice(0, occurrences).map((id, i) => ({
      episodeId: id,
      startTurn: i + 1,
    })),
  };
}

describe("shapeToSlug", () => {
  it("generates slug from shape array", () => {
    expect(shapeToSlug(["Bash", "Edit", "Bash"])).toBe("bash-edit-bash");
  });

  it("lowercases all tools", () => {
    expect(shapeToSlug(["READ", "EDIT"])).toBe("read-edit");
  });

  it("truncates to 48 chars", () => {
    const longShape = Array.from({ length: 20 }, (_, i) => `Tool${i}`);
    const slug = shapeToSlug(longShape);
    expect(slug.length).toBeLessThanOrEqual(48);
  });

  it("handles special characters in tool names", () => {
    const slug = shapeToSlug(["mcp__server__tool"]);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("proposeSkillDrafts — frontmatter", () => {
  it("produces a draft with correct name format", () => {
    const pattern = makePattern(["Bash", "Edit", "Bash"], 5);
    const drafts = proposeSkillDrafts([pattern]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.frontmatter.name).toBe("apex-auto-bash-edit-bash");
  });

  it("description contains occurrences count", () => {
    const pattern = makePattern(["Bash", "Edit"], 7, ["ep-a", "ep-b", "ep-c"]);
    const drafts = proposeSkillDrafts([pattern]);
    expect(drafts[0]!.frontmatter.description).toContain("7");
  });

  it("description contains episode count", () => {
    const pattern = makePattern(["Read", "Edit"], 3, ["ep-1", "ep-2", "ep-3"]);
    const drafts = proposeSkillDrafts([pattern]);
    expect(drafts[0]!.frontmatter.description).toContain("3");
  });

  it("description mentions auto-detected workflow", () => {
    const pattern = makePattern(["Bash", "Write"], 4);
    const drafts = proposeSkillDrafts([pattern]);
    expect(drafts[0]!.frontmatter.description.toLowerCase()).toContain("auto-detected");
  });

  it("slug is populated", () => {
    const pattern = makePattern(["Bash", "Edit", "Bash"], 3);
    const drafts = proposeSkillDrafts([pattern]);
    expect(drafts[0]!.slug).toBe("bash-edit-bash");
  });
});

describe("proposeSkillDrafts — body", () => {
  it("body contains a Pattern section with numbered tool list", () => {
    const pattern = makePattern(["Bash", "Edit", "Bash"], 3);
    const drafts = proposeSkillDrafts([pattern]);
    const body = drafts[0]!.body;
    expect(body).toContain("## Pattern");
    expect(body).toContain("1.");
    expect(body).toContain("2.");
    expect(body).toContain("3.");
  });

  it("body contains a When to use section", () => {
    const pattern = makePattern(["Bash", "Edit"], 4);
    const drafts = proposeSkillDrafts([pattern]);
    expect(drafts[0]!.body).toContain("## When to use");
  });

  it("body contains an Evidence section", () => {
    const pattern = makePattern(["Read", "Edit"], 3, ["ep-aaa", "ep-bbb", "ep-ccc"]);
    const drafts = proposeSkillDrafts([pattern]);
    expect(drafts[0]!.body).toContain("## Evidence");
  });

  it("evidence section includes episode IDs", () => {
    const pattern = makePattern(["Bash", "Edit"], 3, ["ep-123", "ep-456", "ep-789"]);
    const drafts = proposeSkillDrafts([pattern]);
    expect(drafts[0]!.body).toContain("ep-123");
  });

  it("evidence is capped at 5 entries", () => {
    const pattern: DetectedPattern = {
      shape: ["Bash", "Edit"],
      occurrences: 10,
      examples: Array.from({ length: 10 }, (_, i) => ({
        episodeId: `ep-${i}`,
        startTurn: i + 1,
      })),
    };
    const drafts = proposeSkillDrafts([pattern]);
    // Count lines starting with "- Episode" in the body
    const evidenceLines = drafts[0]!.body
      .split("\n")
      .filter((l) => l.startsWith("- Episode"));
    expect(evidenceLines.length).toBeLessThanOrEqual(5);
  });

  it("body starts with a heading", () => {
    const pattern = makePattern(["Bash", "Edit"], 3);
    const drafts = proposeSkillDrafts([pattern]);
    expect(drafts[0]!.body.trimStart()).toMatch(/^#/);
  });
});

describe("proposeSkillDrafts — deduplication", () => {
  it("deduplicates drafts with same slug", () => {
    // Two patterns that produce the same slug
    const p1 = makePattern(["Bash", "Edit"], 5);
    const p2 = makePattern(["Bash", "Edit"], 7); // same shape → same slug
    const drafts = proposeSkillDrafts([p1, p2]);
    const slugs = drafts.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("returns empty array for empty input", () => {
    expect(proposeSkillDrafts([])).toHaveLength(0);
  });
});

describe("proposeSkillDrafts — multiple patterns", () => {
  it("produces one draft per unique pattern", () => {
    const p1 = makePattern(["Bash", "Edit", "Bash"], 5);
    const p2 = makePattern(["Read", "Edit", "Write"], 3);
    const p3 = makePattern(["Bash", "Read", "Bash"], 4);

    const drafts = proposeSkillDrafts([p1, p2, p3]);
    expect(drafts).toHaveLength(3);
  });

  it("preserves pattern order from input", () => {
    const p1 = makePattern(["Bash", "Edit"], 5);
    const p2 = makePattern(["Read", "Write"], 3);

    const drafts = proposeSkillDrafts([p1, p2]);
    expect(drafts[0]!.slug).toBe("bash-edit");
    expect(drafts[1]!.slug).toBe("read-write");
  });
});
