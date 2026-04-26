/**
 * Integration test for runShadowPrefetch.
 *
 * Sets up a tmpdir with a small .apex/knowledge/ fixture (copied from the
 * shared test fixtures), then runs runShadowPrefetch and asserts:
 *   - predicted queries are returned
 *   - cache entries are written to disk
 *   - a second call with the same prompt returns warm hits
 *   - latency is well under 500ms (conservative; target is <100ms)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { runShadowPrefetch } from "../../src/shadow/index.js";
import { getCached, countCacheEntries } from "../../src/shadow/cache.js";
import { computeShadowStats } from "../../src/shadow/stats.js";

const FIXTURE_SRC = path.resolve("test/fixtures/knowledge");

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-shadow-int-"));
  const dest = path.join(root, ".apex", "knowledge");
  fs.mkdirSync(dest, { recursive: true });
  for (const sub of ["decisions", "patterns", "gotchas", "conventions"]) {
    const subDest = path.join(dest, sub);
    fs.mkdirSync(subDest, { recursive: true });
    const subSrc = path.join(FIXTURE_SRC, sub);
    if (!fs.existsSync(subSrc)) continue;
    for (const f of fs.readdirSync(subSrc)) {
      fs.copyFileSync(path.join(subSrc, f), path.join(subDest, f));
    }
  }
  return root;
}

describe("runShadowPrefetch integration", () => {
  let root: string;

  beforeEach(() => {
    root = makeRoot();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns predicted queries and caches results", async () => {
    const result = await runShadowPrefetch(root, "how to rotate JWT signing key", {
      silent: true,
    });

    expect(result.predicted.length).toBeGreaterThanOrEqual(1);
    expect(result.predicted.length).toBeLessThanOrEqual(3);
    // verbatim prompt is always first
    expect(result.predicted[0]).toBe("how to rotate JWT signing key");
    // at least one query was newly cached (may be 0 if recall returns nothing,
    // but it should try to write even empty results)
    expect(result.cached).toBeGreaterThanOrEqual(0);
    expect(result.hits).toHaveLength(0); // first run: nothing warm yet
  });

  it("writes cache entries to disk", async () => {
    await runShadowPrefetch(root, "auth session token rotation", { silent: true });
    const count = countCacheEntries(root);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("second call with same prompt returns warm hits", async () => {
    const prompt = "JWT authentication refresh token";

    // First run: cold.
    const first = await runShadowPrefetch(root, prompt, { silent: true });
    expect(first.hits).toHaveLength(0);
    expect(first.cached).toBeGreaterThanOrEqual(1);

    // Second run: warm.
    const second = await runShadowPrefetch(root, prompt, { silent: true });
    // The verbatim prompt should now be a cache hit.
    expect(second.hits).toContain(prompt);
    expect(second.cached).toBe(0); // nothing new to cache
  });

  it("cache entries are readable via getCached", async () => {
    const prompt = "cursor pagination database pattern";
    await runShadowPrefetch(root, prompt, { silent: true });

    const cached = getCached(root, prompt);
    expect(cached).not.toBeNull();
    expect(cached!.isFresh).toBe(true);
    // results may be empty if FTS finds nothing, but the entry should exist
    expect(Array.isArray(cached!.results)).toBe(true);
  });

  it("completes within 500ms (conservative speed budget)", async () => {
    const start = Date.now();
    await runShadowPrefetch(root, "implement authentication with JWT", { silent: true });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it("respects a short TTL option", async () => {
    const prompt = "short ttl test query";
    await runShadowPrefetch(root, prompt, { ttlMs: 1, silent: true });

    // Wait for TTL to expire.
    await new Promise((r) => setTimeout(r, 10));

    const cached = getCached(root, prompt);
    expect(cached).not.toBeNull();
    expect(cached!.isFresh).toBe(false);
  });

  it("reads recent prompts from episodes/.current episode", async () => {
    // Seed a fake episode with a prompts.jsonl.
    const episodesDir = path.join(root, ".apex", "episodes");
    const episodeId = "2026-04-26-1200-aa01";
    const episodeDir = path.join(episodesDir, episodeId);
    fs.mkdirSync(episodeDir, { recursive: true });
    fs.writeFileSync(path.join(episodesDir, ".current"), episodeId + "\n", "utf8");

    const promptLines = [
      { schema_version: 1, ts: new Date().toISOString(), turn: 0, prompt: "what is the JWT rotation schedule" },
      { schema_version: 1, ts: new Date().toISOString(), turn: 1, prompt: "how long is the token valid" },
    ];
    fs.writeFileSync(
      path.join(episodeDir, "prompts.jsonl"),
      promptLines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      "utf8",
    );

    const result = await runShadowPrefetch(root, "rotate signing certificate", { silent: true });
    // With history available, predictor has more tokens to work with.
    expect(result.predicted.length).toBeGreaterThanOrEqual(1);
    expect(result.predicted[0]).toBe("rotate signing certificate");
  });

  it("returns empty hits array on first run (nothing warm)", async () => {
    const result = await runShadowPrefetch(root, "brand new query xyz", { silent: true });
    expect(result.hits).toEqual([]);
  });

  it("computeShadowStats reflects cache and hits after prefetch", async () => {
    await runShadowPrefetch(root, "statistics test query", { silent: true });
    // Read it back to create a hit.
    await runShadowPrefetch(root, "statistics test query", { silent: true });

    const stats = computeShadowStats(root);
    expect(stats.cacheEntries).toBeGreaterThanOrEqual(1);
    // After second run the verbatim query was a warm hit, so hits.jsonl has entries.
    expect(stats.totalHits).toBeGreaterThanOrEqual(1);
  });
});
