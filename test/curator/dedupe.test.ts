import { describe, it, expect } from "vitest";
import { findDuplicates } from "../../src/curator/dedupe.js";
import type { KnowledgeEntry } from "../../src/types/shared.js";

function makeEntry(overrides: Partial<KnowledgeEntry["frontmatter"]> & { body?: string }): KnowledgeEntry {
  const id = overrides.id ?? "test-id";
  return {
    frontmatter: {
      id,
      type: overrides.type ?? "gotcha",
      title: overrides.title ?? "Default title",
      applies_to: overrides.applies_to ?? "all",
      confidence: overrides.confidence ?? "medium",
      sources: overrides.sources ?? [{ kind: "manual", ref: "manual/test" }],
      created: overrides.created ?? "2026-01-01",
      last_validated: overrides.last_validated ?? "2026-01-01",
      tags: overrides.tags,
    },
    body: overrides.body ?? "Default body text for this entry.",
    path: `.apex/knowledge/gotchas/${id}.md`,
  };
}

describe("findDuplicates", () => {
  it("returns empty array for empty input", () => {
    expect(findDuplicates([])).toEqual([]);
  });

  it("returns empty array for a single entry", () => {
    const entries = [makeEntry({ id: "only-one" })];
    expect(findDuplicates(entries)).toEqual([]);
  });

  it("detects identical titles as duplicates", () => {
    const a = makeEntry({ id: "entry-a", title: "Forgetting to await db transaction causes silent failure" });
    const b = makeEntry({ id: "entry-b", title: "Forgetting to await db transaction causes silent failure" });
    const clusters = findDuplicates([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.pair.via).toBe("title");
    expect(clusters[0]!.pair.score).toBeGreaterThanOrEqual(0.85);
  });

  it("detects very similar titles as duplicates (>=0.85 Jaccard)", () => {
    // Tiny variation but very similar
    const a = makeEntry({ id: "entry-a", title: "Use cursor pagination for all list endpoints in the API" });
    const b = makeEntry({ id: "entry-b", title: "Use cursor pagination for all list endpoints in the API layer" });
    const clusters = findDuplicates([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.pair.score).toBeGreaterThanOrEqual(0.85);
  });

  it("does not flag clearly different titles", () => {
    const a = makeEntry({
      id: "entry-a",
      title: "Use cursor pagination for all API endpoints",
      body: "Cursor pagination is stable under concurrent inserts and deletes unlike offset pagination.",
    });
    const b = makeEntry({
      id: "entry-b",
      title: "Always run database migrations in a transaction",
      body: "Wrapping migrations in a transaction ensures atomicity and allows rollback on failure.",
    });
    expect(findDuplicates([a, b])).toHaveLength(0);
  });

  it("detects identical body first-200-chars as duplicate", () => {
    const body = "When the cache is not properly invalidated after a mutation, the page shows stale data. This is a common pitfall with Next.js server components fetching data.";
    const a = makeEntry({ id: "entry-a", title: "NextJS cache invalidation problem", body });
    const b = makeEntry({ id: "entry-b", title: "NextJS cache stale data issue", body });
    const clusters = findDuplicates([a, b]);
    // body similarity should fire
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const bodyCluster = clusters.find((c) => c.pair.via === "body");
    expect(bodyCluster).toBeDefined();
  });

  it("does NOT compare entries of different types", () => {
    const a = makeEntry({ id: "entry-a", type: "gotcha", title: "Forgetting to await db transaction returns a promise" });
    const b = makeEntry({ id: "entry-b", type: "pattern", title: "Forgetting to await db transaction returns a promise" });
    // Different types — should not be flagged as duplicates.
    expect(findDuplicates([a, b])).toHaveLength(0);
  });

  it("proposeMerge=true when confidences differ", () => {
    const high = makeEntry({ id: "high-entry", title: "Always validate inputs at the API boundary with Zod", confidence: "high" });
    const low = makeEntry({ id: "low-entry", title: "Always validate inputs at the API boundary with Zod", confidence: "low" });
    const clusters = findDuplicates([high, low]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.proposeMerge).toBe(true);
    expect(clusters[0]!.keepId).toBe("high-entry");
    expect(clusters[0]!.discardId).toBe("low-entry");
  });

  it("proposeMerge=true when high vs medium", () => {
    const high = makeEntry({ id: "high-id", title: "Always validate inputs at the API boundary with Zod", confidence: "high" });
    const med = makeEntry({ id: "med-id", title: "Always validate inputs at the API boundary with Zod", confidence: "medium" });
    const clusters = findDuplicates([high, med]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.proposeMerge).toBe(true);
    expect(clusters[0]!.keepId).toBe("high-id");
  });

  it("proposeMerge=false when same confidence (duplicate cluster warning only)", () => {
    const a = makeEntry({ id: "entry-a", title: "Always validate inputs at the API boundary with Zod", confidence: "medium" });
    const b = makeEntry({ id: "entry-b", title: "Always validate inputs at the API boundary with Zod", confidence: "medium" });
    const clusters = findDuplicates([a, b]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.proposeMerge).toBe(false);
  });

  it("tiebreaks same-confidence by applies_to breadth (all wins over team)", () => {
    const team = makeEntry({ id: "team-entry", title: "Always validate inputs at the API boundary with Zod", confidence: "high", applies_to: "team" });
    const all = makeEntry({ id: "all-entry", title: "Always validate inputs at the API boundary with Zod", confidence: "high", applies_to: "all" });
    const clusters = findDuplicates([team, all]);
    expect(clusters).toHaveLength(1);
    // Same confidence so no merge proposal, but keepId should be all-entry
    expect(clusters[0]!.keepId).toBe("all-entry");
    expect(clusters[0]!.proposeMerge).toBe(false);
  });

  it("handles multiple entries with some duplicates and some unique", () => {
    const entries = [
      makeEntry({ id: "a", title: "Use cursor pagination for every list endpoint response", body: "Cursor A: stable pagination for list views." }),
      makeEntry({ id: "b", title: "Use cursor pagination for every list endpoint response", body: "Cursor B: stable pagination approach." }),
      makeEntry({ id: "c", title: "Always run linters in CI before merging a pull request", body: "Lint C: enforce style in CI pipeline." }),
      makeEntry({ id: "d", title: "Always run linters in CI before merging a pull request", body: "Lint D: CI style enforcement approach." }),
      makeEntry({ id: "e", title: "Completely unrelated entry about async error handling patterns", body: "Async errors require careful propagation through promise chains to avoid swallowing exceptions." }),
    ];
    const clusters = findDuplicates(entries);
    // Should find a-b and c-d as duplicate pairs (title match), not e with others
    expect(clusters).toHaveLength(2);
  });
});
