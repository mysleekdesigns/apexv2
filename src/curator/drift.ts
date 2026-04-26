// Drift detection for gotcha entries.
//
// Checks whether file-path references of the form `file/<path>:<line>` in a
// gotcha's `sources[]` still point to existing files on disk. If the file is
// gone, the entry is a drift candidate.

import fs from "node:fs";
import path from "node:path";
import type { KnowledgeEntry } from "../types/shared.js";

// Matches "file/<path>:<line>" or "file/<path>" (line number optional).
const FILE_REF_RE = /^file\/(.+?)(?::\d+)?$/;

export interface DriftEntry {
  entry: KnowledgeEntry;
  /** The source ref that triggered the drift. */
  ref: string;
  /** The resolved file path that no longer exists. */
  missingPath: string;
}

/**
 * For each gotcha entry, inspect its `sources[]` for `file/<path>:<line>` refs
 * and verify the file still exists relative to `root`. Returns entries where at
 * least one referenced file is missing.
 */
export function findDriftEntries(entries: KnowledgeEntry[], root: string): DriftEntry[] {
  const drifted: DriftEntry[] = [];

  for (const entry of entries) {
    if (entry.frontmatter.type !== "gotcha") continue;

    for (const source of entry.frontmatter.sources) {
      const m = FILE_REF_RE.exec(source.ref);
      if (!m) continue;
      const filePath = m[1]!;
      const abs = path.resolve(root, filePath);
      if (!fs.existsSync(abs)) {
        drifted.push({ entry, ref: source.ref, missingPath: filePath });
        // Only report once per entry (first missing ref).
        break;
      }
    }
  }

  return drifted;
}
