import { describe, it, expect } from "vitest";
import {
  hybridSearch,
  reciprocalRankFusion,
  HybridResultCache,
  RRF_K,
} from "../../../src/recall/hybrid.js";
import type { Confidence, KnowledgeType, RecallHit } from "../../../src/types/shared.js";

function hit(
  id: string,
  type: KnowledgeType,
  rank: number,
  tier: RecallHit["tier"],
): RecallHit {
  return {
    entry_id: id,
    entry_type: type,
    title: `${id} title`,
    path: `.apex/knowledge/${type}s/${id}.md`,
    excerpt: `${id} excerpt`,
    score: 1 / rank,
    rank,
    tier,
    last_validated: "2026-04-26",
    confidence: "high" as Confidence,
  };
}

describe("reciprocalRankFusion", () => {
  it("combines two ranked lists, blending duplicates higher", () => {
    const fts = [
      hit("a", "pattern", 1, "fts"),
      hit("b", "pattern", 2, "fts"),
      hit("c", "pattern", 3, "fts"),
    ];
    const vector = [
      hit("c", "pattern", 1, "vector"),
      hit("a", "pattern", 2, "vector"),
      hit("d", "pattern", 3, "vector"),
    ];
    const fused = reciprocalRankFusion({ fts, vector }, 5);
    const ids = fused.map((h) => h.entry_id);
    expect(ids[0]).toMatch(/^(a|c)$/);
    expect(ids).toContain("a");
    expect(ids).toContain("c");
    const a = fused.find((h) => h.entry_id === "a");
    const b = fused.find((h) => h.entry_id === "b");
    expect(a?.tier).toBe("hybrid");
    expect(b?.tier).toBe("fts");
  });

  it("preserves originating tier when only one source contributes", () => {
    const fts = [hit("a", "pattern", 1, "fts")];
    const vector = [hit("b", "pattern", 1, "vector")];
    const fused = reciprocalRankFusion({ fts, vector }, 5);
    const a = fused.find((h) => h.entry_id === "a");
    const b = fused.find((h) => h.entry_id === "b");
    expect(a?.tier).toBe("fts");
    expect(b?.tier).toBe("vector");
  });

  it("uses RRF formula 1/(k+rank)", () => {
    const fts = [hit("a", "pattern", 1, "fts")];
    const vector = [hit("a", "pattern", 1, "vector")];
    const [fused] = reciprocalRankFusion({ fts, vector }, 5);
    expect(fused?.score).toBeCloseTo(2 / (RRF_K + 1), 6);
  });
});

describe("hybridSearch", () => {
  it("returns FTS-only results when vector returns empty", async () => {
    const fts = [hit("a", "pattern", 1, "fts"), hit("b", "pattern", 2, "fts")];
    const out = await hybridSearch("anything", {
      ftsSearch: () => fts,
      vectorSearch: () => [],
      knowledgeVersion: () => "v1",
    });
    expect(out.map((h) => h.entry_id)).toEqual(["a", "b"]);
    expect(out[0]?.tier).toBe("fts");
  });

  it("returns vector-only results when FTS returns empty", async () => {
    const vector = [hit("z", "gotcha", 1, "vector")];
    const out = await hybridSearch("nope", {
      ftsSearch: () => [],
      vectorSearch: () => vector,
      knowledgeVersion: () => "v1",
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.tier).toBe("vector");
  });

  it("returns empty when both sources are empty", async () => {
    const out = await hybridSearch("nope", {
      ftsSearch: () => [],
      vectorSearch: () => [],
      knowledgeVersion: () => "v1",
    });
    expect(out).toEqual([]);
  });

  it("respects k limit on the fused result", async () => {
    const fts = Array.from({ length: 10 }, (_, i) =>
      hit(`f${i}`, "pattern", i + 1, "fts"),
    );
    const vector = Array.from({ length: 10 }, (_, i) =>
      hit(`v${i}`, "pattern", i + 1, "vector"),
    );
    const out = await hybridSearch("q", {
      ftsSearch: () => fts,
      vectorSearch: () => vector,
      knowledgeVersion: () => "v1",
    }, { k: 3 });
    expect(out).toHaveLength(3);
  });

  it("calls custom rerank function", async () => {
    const fts = [hit("a", "pattern", 1, "fts"), hit("b", "pattern", 2, "fts")];
    const vector = [hit("a", "pattern", 1, "vector")];
    let called = false;
    const out = await hybridSearch(
      "q",
      {
        ftsSearch: () => fts,
        vectorSearch: () => vector,
        knowledgeVersion: () => "v1",
      },
      {
        rerank: async (_q, hits) => {
          called = true;
          return [...hits].reverse();
        },
      },
    );
    expect(called).toBe(true);
    expect(out[0]?.entry_id).not.toBe("a");
  });
});

describe("HybridResultCache", () => {
  it("caches by (query, version) and returns hit on second call", async () => {
    const cache = new HybridResultCache(8);
    let ftsCalls = 0;
    let vecCalls = 0;
    const deps = {
      ftsSearch: () => {
        ftsCalls++;
        return [hit("a", "pattern", 1, "fts")];
      },
      vectorSearch: () => {
        vecCalls++;
        return [hit("a", "pattern", 1, "vector")];
      },
      knowledgeVersion: () => "v1",
      cache,
    };
    const a = await hybridSearch("auth", deps);
    const b = await hybridSearch("auth", deps);
    expect(a).toEqual(b);
    expect(ftsCalls).toBe(1);
    expect(vecCalls).toBe(1);
  });

  it("misses when version changes (knowledge updated)", async () => {
    const cache = new HybridResultCache(8);
    let ftsCalls = 0;
    let version = "v1";
    const deps = {
      ftsSearch: () => {
        ftsCalls++;
        return [hit("a", "pattern", 1, "fts")];
      },
      vectorSearch: () => [],
      knowledgeVersion: () => version,
      cache,
    };
    await hybridSearch("auth", deps);
    version = "v2";
    await hybridSearch("auth", deps);
    expect(ftsCalls).toBe(2);
  });

  it("evicts oldest entries past capacity", () => {
    const cache = new HybridResultCache(3);
    cache.set("a", "v", []);
    cache.set("b", "v", []);
    cache.set("c", "v", []);
    cache.set("d", "v", []);
    expect(cache.size()).toBe(3);
    expect(cache.get("a", "v")).toBeUndefined();
    expect(cache.get("d", "v")).toEqual([]);
  });
});
