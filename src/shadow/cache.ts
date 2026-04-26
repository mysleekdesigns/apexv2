/**
 * Shadow cache — stores prefetched recall results keyed by sha1(query).
 *
 * Layout:  <root>/.apex/index/prefetch/<sha1(query)>.json
 * Sidecar: <root>/.apex/index/prefetch/hits.jsonl
 *
 * Cache entry schema: { query, results, ts, ttl_ms }
 */

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { RecallHit } from "../types/shared.js";

export const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes

export interface CacheEntry {
  query: string;
  results: RecallHit[];
  ts: string;       // ISO timestamp of when the entry was written
  ttl_ms: number;
}

export interface CacheReadResult {
  results: RecallHit[];
  isFresh: boolean;
}

function prefetchDir(root: string): string {
  return path.join(root, ".apex", "index", "prefetch");
}

function cacheFilePath(root: string, query: string): string {
  const sha = crypto.createHash("sha1").update(query, "utf8").digest("hex");
  return path.join(prefetchDir(root), `${sha}.json`);
}

function hitsFilePath(root: string): string {
  return path.join(prefetchDir(root), "hits.jsonl");
}

/**
 * Read a cached entry for the given query.
 *
 * Returns null when no cache file exists.
 * Returns { results, isFresh: false } when the entry is stale.
 * Returns { results, isFresh: true } when the entry is fresh, AND appends a
 *   row to hits.jsonl for hit-rate accounting.
 */
export function getCached(root: string, query: string): CacheReadResult | null {
  const file = cacheFilePath(root, query);
  if (!fs.existsSync(file)) return null;

  let entry: CacheEntry;
  try {
    entry = JSON.parse(fs.readFileSync(file, "utf8")) as CacheEntry;
  } catch {
    return null;
  }

  const age = Date.now() - new Date(entry.ts).getTime();
  const isFresh = age < (entry.ttl_ms ?? DEFAULT_TTL_MS);

  if (isFresh) {
    // Append to hits.jsonl (best-effort, do not throw on failure).
    try {
      const dir = prefetchDir(root);
      fs.mkdirSync(dir, { recursive: true });
      const row = JSON.stringify({ ts: new Date().toISOString(), query, fresh: true });
      fs.appendFileSync(hitsFilePath(root), row + "\n", "utf8");
    } catch {
      /* ignore accounting failures */
    }
  }

  return { results: entry.results, isFresh };
}

/**
 * Write results to the cache for the given query.
 *
 * Uses an atomic write-to-tmp-then-rename pattern to avoid partial reads.
 */
export async function setCached(
  root: string,
  query: string,
  results: RecallHit[],
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<void> {
  const dir = prefetchDir(root);
  await fsp.mkdir(dir, { recursive: true });

  const entry: CacheEntry = {
    query,
    results,
    ts: new Date().toISOString(),
    ttl_ms: ttlMs,
  };

  const dest = cacheFilePath(root, query);
  const tmp = `${dest}.tmp`;

  await fsp.writeFile(tmp, JSON.stringify(entry, null, 2), "utf8");
  await fsp.rename(tmp, dest);
}

/**
 * Remove the entire prefetch directory (cache + hits log).
 */
export async function clearCache(root: string): Promise<void> {
  const dir = prefetchDir(root);
  await fsp.rm(dir, { recursive: true, force: true });
}

/**
 * Count the number of cache entries (excludes hits.jsonl and tmp files).
 */
export function countCacheEntries(root: string): number {
  const dir = prefetchDir(root);
  if (!fs.existsSync(dir)) return 0;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".tmp.json")).length;
}
