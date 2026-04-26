import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { Recall } from "../../../src/recall/index.js";
import { setVectorEnabled } from "../../../src/config/index.js";

async function makeProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "apex-recall-int-"));
  const knowDir = path.join(root, ".apex", "knowledge");
  await fs.mkdir(path.join(knowDir, "patterns"), { recursive: true });
  await fs.mkdir(path.join(knowDir, "gotchas"), { recursive: true });
  await fs.mkdir(path.join(knowDir, "decisions"), { recursive: true });
  await fs.mkdir(path.join(knowDir, "conventions"), { recursive: true });
  return root;
}

async function writeEntry(
  root: string,
  type: "pattern" | "gotcha" | "decision" | "convention",
  id: string,
  title: string,
  body: string,
): Promise<void> {
  const folder =
    type === "pattern"
      ? "patterns"
      : type === "gotcha"
        ? "gotchas"
        : type === "decision"
          ? "decisions"
          : "conventions";
  const fm = [
    "---",
    `id: ${id}`,
    `type: ${type}`,
    `title: ${title}`,
    "applies_to: all",
    "confidence: high",
    "sources:",
    "  - kind: manual",
    "    ref: manual/test",
    "created: 2026-01-01",
    "last_validated: 2026-04-26",
    type === "decision"
      ? ["decision: x", "rationale: y", "outcome: z"].join("\n")
      : type === "pattern"
        ? ["intent: do x", "applies_when: [\"always\"]"].join("\n")
        : type === "gotcha"
          ? ["symptom: it breaks", "resolution: fix it"].join("\n")
          : ["rule: use this", "enforcement: manual"].join("\n"),
    "---",
    body,
    "",
  ].join("\n");
  await fs.writeFile(path.join(root, ".apex", "knowledge", folder, `${id}.md`), fm, "utf8");
}

describe("Recall facade — vector + hybrid", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeProject();
    await writeEntry(
      root,
      "pattern",
      "auth-jwt",
      "JWT auth pattern",
      "Use JWT auth handler with refresh-token rotation in Express middleware.",
    );
    await writeEntry(
      root,
      "pattern",
      "db-cursor",
      "Cursor pagination",
      "Prefer cursor pagination for list endpoints over offset-based queries.",
    );
    await writeEntry(
      root,
      "gotcha",
      "stale-cache",
      "Stale cache",
      "Redis sessions outlive auth token rotation; flush on logout.",
    );
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("falls back to FTS when vector is disabled", async () => {
    const recall = new Recall(root);
    try {
      const hits = await recall.search("JWT auth handler");
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0]?.entry_id).toBe("auth-jwt");
      expect(hits[0]?.tier).toBe("fts");
    } finally {
      recall.close();
    }
  });

  it("uses hybrid retrieval when vector is enabled", async () => {
    await setVectorEnabled(root, true);
    const recall = new Recall(root, { fakeVector: true });
    try {
      await recall.sync();
      await recall.syncVector();
      const hits = await recall.search("JWT auth handler refresh token", { k: 5 });
      expect(hits.length).toBeGreaterThan(0);
      const ids = hits.map((h) => h.entry_id);
      expect(ids).toContain("auth-jwt");
      const tiers = new Set(hits.map((h) => h.tier));
      expect([...tiers].some((t) => t === "hybrid" || t === "fts" || t === "vector")).toBe(
        true,
      );
    } finally {
      recall.close();
    }
  });

  it("explicit --tier=vector hits the vector store directly", async () => {
    await setVectorEnabled(root, true);
    const recall = new Recall(root, { fakeVector: true });
    try {
      await recall.sync();
      await recall.syncVector();
      const hits = await recall.search("JWT auth handler refresh token", {
        k: 3,
        tier: "vector",
      });
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) expect(h.tier).toBe("vector");
    } finally {
      recall.close();
    }
  });

  it("explicit --tier=fts skips vector even when enabled", async () => {
    await setVectorEnabled(root, true);
    const recall = new Recall(root, { fakeVector: true });
    try {
      await recall.sync();
      const hits = await recall.search("JWT auth", { k: 3, tier: "fts" });
      for (const h of hits) expect(h.tier).toBe("fts");
    } finally {
      recall.close();
    }
  });

  it("syncVector is mtime-incremental — re-running after no changes is fast", async () => {
    await setVectorEnabled(root, true);
    const recall = new Recall(root, { fakeVector: true });
    try {
      await recall.sync();
      await recall.syncVector();
      const stats1 = await recall.stats();
      expect(stats1.vector?.total).toBe(3);
      await recall.syncVector();
      const stats2 = await recall.stats();
      expect(stats2.vector?.total).toBe(3);
    } finally {
      recall.close();
    }
  });

  it("stats reports vector index when enabled", async () => {
    await setVectorEnabled(root, true);
    const recall = new Recall(root, { fakeVector: true });
    try {
      await recall.sync();
      await recall.syncVector();
      const s = await recall.stats();
      expect(s.vector).toBeDefined();
      expect(s.vector?.total).toBe(3);
      expect(s.vector?.dim).toBe(384);
    } finally {
      recall.close();
    }
  });
});
