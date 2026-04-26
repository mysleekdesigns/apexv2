import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { KnowledgeStore } from "../../src/recall/store.js";
import type { KnowledgeEntry } from "../../src/types/shared.js";

function tmpDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-store-"));
  return path.join(dir, "fts.sqlite");
}

function makeEntry(
  partial: Partial<KnowledgeEntry["frontmatter"]> & {
    id: string;
    type: KnowledgeEntry["frontmatter"]["type"];
    title: string;
  },
  body: string,
  filePath: string,
): KnowledgeEntry {
  return {
    frontmatter: {
      id: partial.id,
      type: partial.type,
      title: partial.title,
      applies_to: partial.applies_to ?? "all",
      confidence: partial.confidence ?? "high",
      sources: partial.sources ?? [{ kind: "manual", ref: "manual/test" }],
      created: partial.created ?? "2026-01-01",
      last_validated: partial.last_validated ?? "2026-04-26",
      tags: partial.tags ?? [],
      supersedes: partial.supersedes ?? [],
    },
    body,
    path: filePath,
  };
}

describe("KnowledgeStore", () => {
  let dbPath: string;
  let store: KnowledgeStore;

  beforeEach(() => {
    dbPath = tmpDb();
    store = new KnowledgeStore(dbPath);
  });

  afterEach(() => {
    store.close();
  });

  it("upserts and retrieves an entry by (type, id)", () => {
    const e = makeEntry(
      { id: "gh-pnpm-not-npm", type: "convention", title: "Use pnpm" },
      "Always use pnpm install. Lockfile is pnpm-lock.yaml.",
      ".apex/knowledge/conventions/gh-pnpm-not-npm.md",
    );
    store.upsert(e);
    const got = store.get("convention", "gh-pnpm-not-npm");
    expect(got).not.toBeNull();
    expect(got?.frontmatter.title).toBe("Use pnpm");
    expect(got?.body).toContain("pnpm-lock");
  });

  it("search returns hits for a body keyword and ranks BM25", () => {
    store.upsert(
      makeEntry(
        { id: "a", type: "pattern", title: "Auth pattern" },
        "JWT auth handler with refresh-token rotation.",
        "a.md",
      ),
    );
    store.upsert(
      makeEntry(
        { id: "b", type: "pattern", title: "Database pattern" },
        "Prefer cursor pagination for list endpoints.",
        "b.md",
      ),
    );
    const hits = store.search("jwt auth");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.entry_id).toBe("a");
    expect(hits[0]?.tier).toBe("fts");
    expect(hits[0]?.path).toBe("a.md");
    expect(hits[0]?.last_validated).toBeTruthy();
  });

  it("search is case-insensitive and tokenized", () => {
    store.upsert(
      makeEntry(
        { id: "case", type: "convention", title: "Lowercase everything" },
        "Project uses PNPM exclusively.",
        "c.md",
      ),
    );
    const hits = store.search("pnpm");
    expect(hits.length).toBe(1);
    expect(hits[0]?.entry_id).toBe("case");
  });

  it("search supports a type filter", () => {
    store.upsert(
      makeEntry(
        { id: "p1", type: "pattern", title: "shared term pattern" },
        "shared phrase here",
        "p1.md",
      ),
    );
    store.upsert(
      makeEntry(
        { id: "g1", type: "gotcha", title: "shared term gotcha" },
        "shared phrase here",
        "g1.md",
      ),
    );
    const onlyPatterns = store.search("shared", { type: "pattern" });
    expect(onlyPatterns).toHaveLength(1);
    expect(onlyPatterns[0]?.entry_type).toBe("pattern");
  });

  it("delete removes an entry from both tables", () => {
    const e = makeEntry(
      { id: "drop-me", type: "gotcha", title: "doomed" },
      "delete this one",
      "x.md",
    );
    store.upsert(e);
    expect(store.search("delete").length).toBe(1);
    store.delete("gotcha", "drop-me");
    expect(store.search("delete").length).toBe(0);
    expect(store.get("gotcha", "drop-me")).toBeNull();
  });

  it("upsert is idempotent (no duplicate FTS rows)", () => {
    const e = makeEntry(
      { id: "twice", type: "decision", title: "twice" },
      "the same content twice",
      "t.md",
    );
    store.upsert(e);
    store.upsert(e);
    store.upsert(e);
    const hits = store.search("twice");
    expect(hits).toHaveLength(1);
  });

  it("stats reports counts per type", () => {
    store.upsert(
      makeEntry(
        { id: "d1", type: "decision", title: "D1" },
        "decision one",
        "d1.md",
      ),
    );
    store.upsert(
      makeEntry(
        { id: "p1", type: "pattern", title: "P1" },
        "pattern one",
        "p1.md",
      ),
    );
    store.upsert(
      makeEntry(
        { id: "p2", type: "pattern", title: "P2" },
        "pattern two",
        "p2.md",
      ),
    );
    const s = store.stats();
    expect(s.total).toBe(3);
    expect(s.byType.pattern).toBe(2);
    expect(s.byType.decision).toBe(1);
    expect(s.byType.gotcha).toBe(0);
  });

  it("recovers from a corrupt index file", () => {
    store.close();
    fs.writeFileSync(dbPath, "not a sqlite database — totally garbage");
    // Constructing the store should wipe and rebuild.
    const fresh = new KnowledgeStore(dbPath);
    fresh.upsert(
      makeEntry(
        { id: "after", type: "pattern", title: "After Recovery" },
        "rebuilt cleanly",
        "after.md",
      ),
    );
    const hits = fresh.search("rebuilt");
    expect(hits).toHaveLength(1);
    fresh.close();
  });

  it("returns empty for empty/whitespace queries", () => {
    store.upsert(
      makeEntry(
        { id: "x", type: "pattern", title: "X" },
        "anything",
        "x.md",
      ),
    );
    expect(store.search("")).toEqual([]);
    expect(store.search("   ")).toEqual([]);
  });

  it("excerpt highlights a query term region", () => {
    const longBody = `${"prelude ".repeat(40)}the secret keyword appears here ${"epilogue ".repeat(40)}`;
    store.upsert(
      makeEntry(
        { id: "e", type: "pattern", title: "Excerpt" },
        longBody,
        "e.md",
      ),
    );
    const hits = store.search("keyword");
    expect(hits[0]?.excerpt).toContain("keyword");
    expect(hits[0]?.excerpt.length).toBeLessThan(220);
  });
});
