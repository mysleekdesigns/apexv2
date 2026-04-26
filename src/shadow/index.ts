/**
 * Shadow prefetch orchestrator.
 *
 * runShadowPrefetch(root, prompt, opts):
 *   1. Reads recent prompts from the current episode's prompts.jsonl (up to 5).
 *   2. Uses the predictor to generate 1–3 candidate queries.
 *   3. For each candidate that isn't already warm in the cache, fires a
 *      recall search and stores the result.
 *   4. Returns { predicted, cached, hits }.
 *
 * Speed budget: <100ms for the prefetch call. We use FTS-only tier to skip
 * vector embedding latency.
 */

import fs from "node:fs";
import path from "node:path";
import { Recall } from "../recall/index.js";
import { predictQueries } from "./predictor.js";
import { getCached, setCached, DEFAULT_TTL_MS } from "./cache.js";
import type { RecallHit } from "../types/shared.js";

export interface ShadowPrefetchOptions {
  /** Override TTL for new cache entries (ms). Default: 15 min. */
  ttlMs?: number;
  /** Max results per query (default: 5). */
  k?: number;
  /** Suppress warn output. */
  silent?: boolean;
}

export interface ShadowPrefetchResult {
  /** All queries that were predicted. */
  predicted: string[];
  /** Number of queries for which results were written to the cache. */
  cached: number;
  /** Queries that were already warm in the cache (no re-fetch needed). */
  hits: string[];
}

/** Read up to `limit` recent prompts from the current episode. */
function readRecentPrompts(root: string, limit = 5): string[] {
  // Find the latest episode directory.
  const episodesDir = path.join(root, ".apex", "episodes");

  // Check for the .current pointer first.
  const currentFile = path.join(episodesDir, ".current");
  let episodeId: string | null = null;

  if (fs.existsSync(currentFile)) {
    const v = fs.readFileSync(currentFile, "utf8").trim();
    if (v) episodeId = v;
  }

  // Fallback: find the lexicographically latest episode directory.
  if (!episodeId && fs.existsSync(episodesDir)) {
    const dirs = fs
      .readdirSync(episodesDir)
      .filter((d) => /^\d{4}-\d{2}-\d{2}-\d{4}-[a-f0-9]{4}$/.test(d))
      .sort();
    if (dirs.length > 0) episodeId = dirs[dirs.length - 1] ?? null;
  }

  if (!episodeId) return [];

  const promptsFile = path.join(episodesDir, episodeId, "prompts.jsonl");
  if (!fs.existsSync(promptsFile)) return [];

  const lines = fs.readFileSync(promptsFile, "utf8").split("\n").filter(Boolean);
  const recent = lines.slice(-limit);

  const prompts: string[] = [];
  for (const line of recent) {
    try {
      const row = JSON.parse(line) as { prompt?: string };
      if (typeof row.prompt === "string") prompts.push(row.prompt);
    } catch {
      /* skip malformed rows */
    }
  }
  return prompts;
}

export async function runShadowPrefetch(
  root: string,
  prompt: string,
  opts: ShadowPrefetchOptions = {},
): Promise<ShadowPrefetchResult> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const k = opts.k ?? 5;
  const warn = opts.silent ? () => {} : (m: string) => console.warn(`[apex-shadow] ${m}`);

  // Step 1: gather recent prompts for richer prediction.
  const recentPrompts = readRecentPrompts(root);

  // Step 2: predict candidate queries.
  const predicted = predictQueries(prompt, { recentPrompts });

  // Step 3: for each candidate, check cache; recall if stale/missing.
  const hits: string[] = [];
  let cached = 0;

  // Use FTS-only tier to stay well within 100ms.
  const recall = new Recall(root, { autoSync: true, onWarn: warn });

  try {
    const tasks = predicted.map(async (query) => {
      const cached_ = getCached(root, query);
      if (cached_ !== null && cached_.isFresh) {
        hits.push(query);
        return;
      }

      // Stale or missing — fetch from recall engine.
      let results: RecallHit[];
      try {
        results = await recall.search(query, { tier: "fts", k });
      } catch {
        results = [];
      }

      try {
        await setCached(root, query, results, ttlMs);
        cached++;
      } catch (e) {
        warn(`setCached failed for "${query}": ${String(e)}`);
      }
    });

    await Promise.all(tasks);
  } finally {
    recall.close();
  }

  return { predicted, cached, hits };
}
