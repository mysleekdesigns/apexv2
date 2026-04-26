// Episode ID generation. Implements specs/episode-schema.md §"Episode ID format".
//
// Format: YYYY-MM-DD-HHMM-<4hex>
//   - YYYY-MM-DD-HHMM: UTC `started_at` truncated to minute precision.
//   - <4hex>: first 4 hex chars of sha1(uuidv4()), lowercase.
//
// Sortable lexicographically by start time. Regex enforced:
//   ^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$

import { createHash, randomUUID } from "node:crypto";

export const EPISODE_ID_REGEX = /^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$/;

export function newEpisodeId(now: Date = new Date()): string {
  const y = now.getUTCFullYear().toString().padStart(4, "0");
  const m = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = now.getUTCDate().toString().padStart(2, "0");
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mm = now.getUTCMinutes().toString().padStart(2, "0");
  const hash = createHash("sha1").update(randomUUID()).digest("hex").slice(0, 4);
  return `${y}-${m}-${d}-${hh}${mm}-${hash}`;
}

export function isEpisodeId(s: string): boolean {
  return EPISODE_ID_REGEX.test(s);
}
