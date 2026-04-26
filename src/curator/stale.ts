// Stale entry detection.
//
// An entry is stale when BOTH conditions hold:
//   1. Its `last_validated` date is older than `staleDays` days from `now`.
//   2. No `retrievals.jsonl` row in ANY episode within the last `staleDays` days
//      references the entry's id.

import fs from "node:fs";
import path from "node:path";
import type { KnowledgeEntry } from "../types/shared.js";
import type { RetrievalLine } from "../episode/writer.js";

export interface StaleEntry {
  entry: KnowledgeEntry;
  lastValidated: string;
  daysSinceValidated: number;
}

function daysBetween(earlier: Date, later: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Read all retrievals.jsonl files under `episodesDir` and collect entry_ids
 * whose most-recent retrieval is within `staleDays` days of `now`.
 *
 * Returns a Set of entry ids that were retrieved recently enough.
 */
function recentlyRetrievedIds(episodesDir: string, now: Date, staleDays: number): Set<string> {
  const recent = new Set<string>();

  let episodeDirs: string[];
  try {
    episodeDirs = fs.readdirSync(episodesDir);
  } catch {
    // No episodes directory — all entries are "not retrieved".
    return recent;
  }

  for (const ep of episodeDirs) {
    const file = path.join(episodesDir, ep, "retrievals.jsonl");
    if (!fs.existsSync(file)) continue;

    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let rec: RetrievalLine;
      try {
        rec = JSON.parse(trimmed) as RetrievalLine;
      } catch {
        continue;
      }
      if (!rec.ts || !rec.entry_id) continue;
      const ts = new Date(rec.ts);
      if (!isFinite(ts.getTime())) continue;
      if (daysBetween(ts, now) <= staleDays) {
        recent.add(rec.entry_id);
      }
    }
  }

  return recent;
}

/**
 * Return entries that are stale (old `last_validated` AND no recent retrieval).
 */
export function findStaleEntries(
  entries: KnowledgeEntry[],
  episodesDir: string,
  now: Date,
  staleDays: number,
): StaleEntry[] {
  const recentIds = recentlyRetrievedIds(episodesDir, now, staleDays);
  const stale: StaleEntry[] = [];

  for (const entry of entries) {
    const lv = entry.frontmatter.last_validated;
    const lvDate = new Date(lv + "T00:00:00Z");
    if (!isFinite(lvDate.getTime())) continue;

    const age = daysBetween(lvDate, now);
    if (age <= staleDays) continue;           // still fresh by last_validated
    if (recentIds.has(entry.frontmatter.id)) continue; // retrieved recently

    stale.push({ entry, lastValidated: lv, daysSinceValidated: age });
  }

  return stale;
}
