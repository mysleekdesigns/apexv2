import { describe, it, expect } from "vitest";
import {
  createEmbedder,
  syntheticVector,
  DEFAULT_EMBED_DIM,
} from "../../../src/recall/vector/embedder.js";

describe("synthetic embedder (fake mode)", () => {
  it("produces 384-dim vectors", async () => {
    const e = createEmbedder({ fake: true });
    const v = await e.embedOne("hello world");
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(DEFAULT_EMBED_DIM);
  });

  it("is deterministic — same input yields the same vector", async () => {
    const e1 = createEmbedder({ fake: true });
    const e2 = createEmbedder({ fake: true });
    const a = await e1.embedOne("the quick brown fox");
    const b = await e2.embedOne("the quick brown fox");
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("differs across distinct inputs", async () => {
    const e = createEmbedder({ fake: true });
    const a = await e.embedOne("auth handler");
    const b = await e.embedOne("database migration");
    let same = 0;
    for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++;
    expect(same).toBeLessThan(a.length);
  });

  it("embed() handles batches", async () => {
    const e = createEmbedder({ fake: true });
    const out = await e.embed(["one", "two", "three"]);
    expect(out).toHaveLength(3);
    for (const v of out) expect(v.length).toBe(DEFAULT_EMBED_DIM);
  });

  it("normalised vectors have unit length (within tolerance)", () => {
    const v = syntheticVector("auth handler with refresh tokens", DEFAULT_EMBED_DIM);
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
      const x = v[i] ?? 0;
      sum += x * x;
    }
    expect(Math.sqrt(sum)).toBeGreaterThan(0.9);
    expect(Math.sqrt(sum)).toBeLessThan(1.1);
  });

  it("respects APEX_VECTOR_FAKE env var", async () => {
    const prev = process.env["APEX_VECTOR_FAKE"];
    process.env["APEX_VECTOR_FAKE"] = "1";
    try {
      const e = createEmbedder();
      const v = await e.embedOne("hello");
      expect(v.length).toBe(DEFAULT_EMBED_DIM);
      expect(e.model).toMatch(/^fake:/);
    } finally {
      if (prev === undefined) delete process.env["APEX_VECTOR_FAKE"];
      else process.env["APEX_VECTOR_FAKE"] = prev;
    }
  });
});
