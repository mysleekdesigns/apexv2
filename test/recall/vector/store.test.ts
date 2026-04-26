import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { VectorStore } from "../../../src/recall/vector/store.js";
import type { KnowledgeEntry } from "../../../src/types/shared.js";

function tmpIndex(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "apex-vec-")),
    "vectors.lance",
  );
}

function makeEntry(
  id: string,
  type: KnowledgeEntry["frontmatter"]["type"],
  title: string,
  body: string,
): KnowledgeEntry {
  return {
    frontmatter: {
      id,
      type,
      title,
      applies_to: "all",
      confidence: "high",
      sources: [{ kind: "manual", ref: "manual/test" }],
      created: "2026-01-01",
      last_validated: "2026-04-26",
      tags: [],
      supersedes: [],
    },
    body,
    path: `.apex/knowledge/${type}s/${id}.md`,
  };
}

describe("VectorStore (fake-vector mode)", () => {
  let indexPath: string;
  let store: VectorStore;

  beforeEach(() => {
    indexPath = tmpIndex();
    store = new VectorStore({ path: indexPath, fake: true });
  });

  afterEach(async () => {
    await store.close();
  });

  it("upsert + search returns the seeded entry", async () => {
    await store.upsert([
      makeEntry(
        "auth-pattern",
        "pattern",
        "JWT auth handler",
        "Use JWT auth with refresh-token rotation in Express middleware.",
      ),
      makeEntry(
        "db-pattern",
        "pattern",
        "Cursor pagination",
        "Prefer cursor pagination for list endpoints over offset-based.",
      ),
    ]);

    const hits = await store.search("JWT auth handler refresh-token rotation Express", { k: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.entry_id).toBe("auth-pattern");
    expect(hits[0]?.tier).toBe("vector");
    expect(hits[0]?.path).toBe(".apex/knowledge/patterns/auth-pattern.md");
    expect(hits[0]?.last_validated).toBe("2026-04-26");
    expect(hits[0]?.rank).toBe(1);
  });

  it("upsert is idempotent — re-seeding does not duplicate rows", async () => {
    const e = makeEntry("twice", "decision", "Twice", "the same content twice");
    await store.upsert([e]);
    await store.upsert([e]);
    await store.upsert([e]);
    const stats = await store.stats();
    expect(stats.total).toBe(1);
  });

  it("delete removes an entry", async () => {
    await store.upsert([makeEntry("doomed", "gotcha", "Doomed", "delete this one please")]);
    expect((await store.stats()).total).toBe(1);
    await store.delete("gotcha", "doomed");
    expect((await store.stats()).total).toBe(0);
    const hits = await store.search("delete this one please");
    expect(hits.find((h) => h.entry_id === "doomed")).toBeUndefined();
  });

  it("search supports type filtering", async () => {
    await store.upsert([
      makeEntry("p1", "pattern", "shared term pattern", "shared phrase here"),
      makeEntry("g1", "gotcha", "shared term gotcha", "shared phrase here"),
    ]);
    const onlyPatterns = await store.search("shared phrase", { k: 5, type: "pattern" });
    expect(onlyPatterns.length).toBeGreaterThan(0);
    for (const h of onlyPatterns) expect(h.entry_type).toBe("pattern");
  });

  it("stats reports dim and model", async () => {
    const s = await store.stats();
    expect(s.dim).toBe(384);
    expect(s.model).toMatch(/MiniLM/);
  });

  it("returns empty for empty queries", async () => {
    await store.upsert([makeEntry("x", "pattern", "X", "anything")]);
    expect(await store.search("")).toEqual([]);
    expect(await store.search("   ")).toEqual([]);
  });
});
