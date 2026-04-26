/**
 * Shadow stats — reads hits.jsonl and cache entries to report on prefetch
 * hit rate and cache size.
 */

import fs from "node:fs";
import path from "node:path";
import { countCacheEntries } from "./cache.js";

export interface ShadowStats {
  /** Number of cache entry files currently on disk. */
  cacheEntries: number;
  /** Total hit events recorded in hits.jsonl. */
  totalHits: number;
  /** Hits in the last 24 hours. */
  hitsLast24h: number;
  /** Hit rate: hitsLast24h / totalHits (0 when no hits). */
  hitRate24h: number;
}

interface HitRow {
  ts: string;
  query: string;
  fresh: boolean;
}

function hitsFilePath(root: string): string {
  return path.join(root, ".apex", "index", "prefetch", "hits.jsonl");
}

function parseHitsFile(root: string): HitRow[] {
  const file = hitsFilePath(root);
  if (!fs.existsSync(file)) return [];

  const rows: HitRow[] = [];
  const raw = fs.readFileSync(file, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as HitRow);
    } catch {
      /* skip malformed rows */
    }
  }
  return rows;
}

export function computeShadowStats(root: string): ShadowStats {
  const cacheEntries = countCacheEntries(root);
  const rows = parseHitsFile(root);
  const totalHits = rows.length;

  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const hitsLast24h = rows.filter((r) => {
    try {
      return new Date(r.ts).getTime() >= cutoff;
    } catch {
      return false;
    }
  }).length;

  const hitRate24h = totalHits > 0 ? hitsLast24h / totalHits : 0;

  return { cacheEntries, totalHits, hitsLast24h, hitRate24h };
}
