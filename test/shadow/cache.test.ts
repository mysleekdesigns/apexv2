import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  getCached,
  setCached,
  clearCache,
  countCacheEntries,
  DEFAULT_TTL_MS,
} from "../../src/shadow/cache.js";
import type { RecallHit } from "../../src/types/shared.js";

function makeRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "apex-shadow-cache-"));
}

function makeHit(id: string): RecallHit {
  return {
    entry_id: id,
    entry_type: "convention",
    title: `Entry ${id}`,
    path: `.apex/knowledge/conventions/${id}.md`,
    excerpt: "some excerpt",
    rank: 1,
    score: 1.0,
    confidence: "high",
    last_validated: "2026-04-26",
    tier: "fts",
  };
}

describe("shadow cache", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns null when no entry exists", () => {
    const result = getCached(root, "some query that was never cached");
    expect(result).toBeNull();
  });

  it("write then read returns fresh results", async () => {
    const query = "auth flow";
    const hits = [makeHit("auth-pattern-1"), makeHit("auth-pattern-2")];
    await setCached(root, query, hits);

    const result = getCached(root, query);
    expect(result).not.toBeNull();
    expect(result!.isFresh).toBe(true);
    expect(result!.results).toHaveLength(2);
    expect(result!.results[0]?.entry_id).toBe("auth-pattern-1");
  });

  it("returns isFresh=false when TTL has expired", async () => {
    const query = "expired query";
    const hits = [makeHit("old-entry")];
    // Write with 1ms TTL so it's immediately stale.
    await setCached(root, query, hits, 1);

    // Wait a tick to ensure TTL passes.
    await new Promise((r) => setTimeout(r, 5));

    const result = getCached(root, query);
    expect(result).not.toBeNull();
    expect(result!.isFresh).toBe(false);
  });

  it("different queries produce different cache entries", async () => {
    await setCached(root, "query alpha", [makeHit("alpha")]);
    await setCached(root, "query beta", [makeHit("beta")]);

    const a = getCached(root, "query alpha");
    const b = getCached(root, "query beta");
    expect(a?.results[0]?.entry_id).toBe("alpha");
    expect(b?.results[0]?.entry_id).toBe("beta");
  });

  it("write is atomic: no .tmp file left behind after success", async () => {
    await setCached(root, "atomic test", [makeHit("x")]);
    const dir = path.join(root, ".apex", "index", "prefetch");
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });

  it("countCacheEntries counts .json files only", async () => {
    expect(countCacheEntries(root)).toBe(0);
    await setCached(root, "q1", [makeHit("e1")]);
    await setCached(root, "q2", [makeHit("e2")]);
    await setCached(root, "q3", [makeHit("e3")]);
    // hits.jsonl should not be counted (not a cache entry)
    expect(countCacheEntries(root)).toBe(3);
  });

  it("clearCache removes the prefetch directory", async () => {
    await setCached(root, "something", [makeHit("e1")]);
    const dir = path.join(root, ".apex", "index", "prefetch");
    expect(fs.existsSync(dir)).toBe(true);

    await clearCache(root);
    expect(fs.existsSync(dir)).toBe(false);
    expect(countCacheEntries(root)).toBe(0);
  });

  it("clearCache is idempotent when directory does not exist", async () => {
    await expect(clearCache(root)).resolves.not.toThrow();
  });

  it("getCached(fresh) appends a row to hits.jsonl", async () => {
    const query = "hits accounting query";
    await setCached(root, query, [makeHit("h1")]);

    // First read — should record a hit.
    const result = getCached(root, query);
    expect(result?.isFresh).toBe(true);

    const hitsFile = path.join(root, ".apex", "index", "prefetch", "hits.jsonl");
    expect(fs.existsSync(hitsFile)).toBe(true);
    const rows = fs
      .readFileSync(hitsFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { query: string; fresh: boolean });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.query).toBe(query);
    expect(rows[0]?.fresh).toBe(true);
  });

  it("getCached(stale) does NOT append to hits.jsonl", async () => {
    const query = "stale hits test";
    await setCached(root, query, [makeHit("s1")], 1);
    await new Promise((r) => setTimeout(r, 5));

    getCached(root, query); // stale read

    const hitsFile = path.join(root, ".apex", "index", "prefetch", "hits.jsonl");
    expect(fs.existsSync(hitsFile)).toBe(false);
  });

  it("respects custom ttlMs when writing", async () => {
    const customTtl = 30 * 60 * 1000; // 30 min
    await setCached(root, "custom ttl query", [makeHit("c1")], customTtl);

    const dir = path.join(root, ".apex", "index", "prefetch");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);

    const entry = JSON.parse(
      fs.readFileSync(path.join(dir, files[0]!), "utf8"),
    ) as { ttl_ms: number };
    expect(entry.ttl_ms).toBe(customTtl);
  });

  it("default TTL is 15 minutes", () => {
    expect(DEFAULT_TTL_MS).toBe(15 * 60 * 1000);
  });
});
