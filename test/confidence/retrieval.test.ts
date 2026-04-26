import { describe, expect, it } from "vitest";
import {
  applyConfidenceWeights,
  hybridSearch,
  reciprocalRankFusion,
} from "../../src/recall/hybrid.js";
import type { Confidence, KnowledgeType, RecallHit } from "../../src/types/shared.js";

function hit(
  id: string,
  type: KnowledgeType,
  rank: number,
  tier: RecallHit["tier"],
  confidence: Confidence = "high",
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
    confidence,
  };
}

describe("applyConfidenceWeights", () => {
  it("multiplies score by 0.5 / 0.85 / 1.0 by confidence", () => {
    const hits: RecallHit[] = [
      hit("hi", "pattern", 1, "fts", "high"),
      hit("md", "pattern", 1, "fts", "medium"),
      hit("lo", "pattern", 1, "fts", "low"),
    ];
    const weighted = applyConfidenceWeights(hits);
    expect(weighted[0]?.score).toBe(1);
    expect(weighted[1]?.score).toBe(0.85);
    expect(weighted[2]?.score).toBe(0.5);
  });

  it("does not mutate the input", () => {
    const hits: RecallHit[] = [hit("a", "pattern", 1, "fts", "low")];
    const before = hits[0]!.score;
    applyConfidenceWeights(hits);
    expect(hits[0]!.score).toBe(before);
  });
});

describe("hybridSearch — confidence filtering", () => {
  it("filters low-confidence entries by default", async () => {
    const fts = [
      hit("a", "pattern", 1, "fts", "high"),
      hit("b", "pattern", 2, "fts", "low"),
      hit("c", "pattern", 3, "fts", "medium"),
    ];
    const out = await hybridSearch("anything", {
      ftsSearch: () => fts,
      vectorSearch: () => [],
      knowledgeVersion: () => "v1",
    });
    const ids = out.map((h) => h.entry_id);
    expect(ids).toContain("a");
    expect(ids).toContain("c");
    expect(ids).not.toContain("b");
  });

  it("includeLowConfidence: true returns low-confidence entries", async () => {
    const fts = [
      hit("a", "pattern", 1, "fts", "high"),
      hit("b", "pattern", 2, "fts", "low"),
    ];
    const out = await hybridSearch(
      "anything",
      {
        ftsSearch: () => fts,
        vectorSearch: () => [],
        knowledgeVersion: () => "v1",
      },
      { includeLowConfidence: true },
    );
    const ids = out.map((h) => h.entry_id);
    expect(ids).toContain("b");
  });

  it("returns a low-confidence entry when the query mentions its id", async () => {
    const fts = [hit("zod-default-vs-optional", "gotcha", 1, "fts", "low")];
    const out = await hybridSearch("zod-default-vs-optional", {
      ftsSearch: () => fts,
      vectorSearch: () => [],
      knowledgeVersion: () => "v1",
    });
    expect(out.map((h) => h.entry_id)).toContain("zod-default-vs-optional");
  });

  it("down-weights medium hits below high hits even when they tie in rank", async () => {
    const fts = [
      hit("hi", "pattern", 1, "fts", "high"),
      hit("md", "pattern", 1, "fts", "medium"),
    ];
    const vector = [
      hit("md", "pattern", 1, "vector", "medium"),
      hit("hi", "pattern", 2, "vector", "high"),
    ];
    const out = await hybridSearch(
      "q",
      {
        ftsSearch: () => fts,
        vectorSearch: () => vector,
        knowledgeVersion: () => "v1",
      },
      { k: 2 },
    );
    expect(out[0]?.entry_id).toBe("hi");
  });
});

describe("hybridSearch — preserves Phase 3 behaviour", () => {
  it("still calls user-supplied rerank after weighting", async () => {
    const fts = [hit("a", "pattern", 1, "fts", "high"), hit("b", "pattern", 2, "fts", "high")];
    const vector = [hit("c", "pattern", 1, "vector", "high")];
    let called = false;
    const out = await hybridSearch(
      "q",
      {
        ftsSearch: () => fts,
        vectorSearch: () => vector,
        knowledgeVersion: () => "v1",
      },
      {
        rerank: (_q, hits) => {
          called = true;
          return [...hits].reverse();
        },
      },
    );
    expect(called).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it("RRF still fuses two ranked lists by reciprocal rank", () => {
    const fts = [
      hit("a", "pattern", 1, "fts", "high"),
      hit("b", "pattern", 2, "fts", "high"),
    ];
    const vector = [
      hit("a", "pattern", 1, "vector", "high"),
      hit("c", "pattern", 2, "vector", "high"),
    ];
    const fused = reciprocalRankFusion({ fts, vector }, 5);
    expect(fused[0]?.entry_id).toBe("a");
    expect(fused[0]?.tier).toBe("hybrid");
  });
});
