// Mark knowledge entries as `verified: false` when drift is detected.
//
// Idempotent: re-running on an already-flagged entry never duplicates rows in
// `drift_report`. When drift is *resolved*, the relevant rows are removed and
// `verified` flips back to true; once `drift_report` becomes empty, the field
// is dropped entirely. `last_validated` is intentionally never touched here —
// drift is a negative signal and should not refresh the freshness clock.

import path from "node:path";
import fs from "node:fs/promises";
import matter from "gray-matter";
import yaml from "yaml";
import type { DriftHit, DriftKind } from "./drift.js";
import type { KnowledgeEntry } from "../types/shared.js";

const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

export interface DriftReportEntry {
  kind: DriftKind;
  ref: string;
  detected: string;
}

export interface VerifyResult {
  /** Entries newly marked `verified: false` (drift_report rows added). */
  flagged: string[];
  /** Entries whose drift_report changed but already had verified=false. */
  updated: string[];
  /** Entries flipped back to verified=true (all drift cleared). */
  cleared: string[];
  /** Entries left untouched (no change vs disk). */
  unchanged: string[];
}

export interface VerifyOptions {
  /** Override "today" for deterministic tests. ISO date `YYYY-MM-DD`. */
  today?: string;
  /** When true, compute the result but do not write any files. */
  dryRun?: boolean;
}

/**
 * Apply drift hits to entries on disk. Hits are grouped by entry id; each
 * entry's frontmatter is rewritten with merged `drift_report` rows.
 *
 * If an entry has no hits in `hitsByEntry` but already has `drift_report` rows
 * on disk, those rows are cleared (the previously-detected drift has resolved).
 */
export async function applyDriftFlags(
  root: string,
  entries: KnowledgeEntry[],
  hitsByEntry: Map<string, DriftHit[]>,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const result: VerifyResult = {
    flagged: [],
    updated: [],
    cleared: [],
    unchanged: [],
  };

  for (const entry of entries) {
    const id = entry.frontmatter.id;
    const hits = hitsByEntry.get(id) ?? [];
    const filePath = path.resolve(root, entry.path);

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      result.unchanged.push(id);
      continue;
    }

    const parsed = matter(raw, matterOptions);
    const fm = (parsed.data ?? {}) as Record<string, unknown>;
    const existingReport = readDriftReport(fm);

    // Merge: keep existing rows that are still hit, drop rows that are no longer
    // hit (resolved), add new rows for fresh hits.
    const hitKeys = new Set(hits.map((h) => `${h.kind}::${h.ref}`));
    const merged: DriftReportEntry[] = [];
    const seen = new Set<string>();
    for (const row of existingReport) {
      const k = `${row.kind}::${row.ref}`;
      if (hitKeys.has(k) && !seen.has(k)) {
        merged.push(row);
        seen.add(k);
      }
    }
    for (const h of hits) {
      const k = `${h.kind}::${h.ref}`;
      if (seen.has(k)) continue;
      merged.push({ kind: h.kind, ref: h.ref, detected: today });
      seen.add(k);
    }

    const priorVerified = fm["verified"];
    const priorReportLen = existingReport.length;
    const newReportLen = merged.length;

    // No change at all: keep file untouched.
    const reportUnchanged =
      priorReportLen === newReportLen &&
      existingReport.every((r, i) => {
        const m = merged[i];
        return m && m.kind === r.kind && m.ref === r.ref && m.detected === r.detected;
      });

    if (reportUnchanged && newReportLen === 0 && priorVerified !== false) {
      result.unchanged.push(id);
      continue;
    }
    if (reportUnchanged && newReportLen > 0 && priorVerified === false) {
      result.unchanged.push(id);
      continue;
    }

    const newFm: Record<string, unknown> = { ...fm };
    if (newReportLen === 0) {
      delete newFm["drift_report"];
      // Remove `verified: false`. Set to true only if it was previously false.
      if (priorVerified === false) {
        newFm["verified"] = true;
      } else {
        // Don't introduce verified: true if the field was absent before.
        if (!("verified" in fm)) delete newFm["verified"];
      }
    } else {
      newFm["drift_report"] = merged.map((m) => ({
        kind: m.kind,
        ref: m.ref,
        detected: m.detected,
      }));
      newFm["verified"] = false;
    }

    if (!opts.dryRun) {
      const out = renderEntry(newFm, parsed.content);
      await fs.writeFile(filePath, out, "utf8");
    }

    if (newReportLen === 0 && priorReportLen > 0) {
      result.cleared.push(id);
    } else if (priorReportLen === 0 && newReportLen > 0) {
      result.flagged.push(id);
    } else {
      result.updated.push(id);
    }
  }

  return result;
}

function readDriftReport(fm: Record<string, unknown>): DriftReportEntry[] {
  const raw = fm["drift_report"];
  if (!Array.isArray(raw)) return [];
  const out: DriftReportEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const kind = r["kind"];
    const ref = r["ref"];
    const detected = r["detected"];
    if (
      typeof kind === "string" &&
      typeof ref === "string" &&
      typeof detected === "string" &&
      isDriftKind(kind)
    ) {
      out.push({ kind, ref, detected });
    }
  }
  return out;
}

function isDriftKind(s: string): s is DriftKind {
  return (
    s === "file_missing" ||
    s === "symbol_missing" ||
    s === "reference_missing" ||
    s === "path_missing"
  );
}

function renderEntry(frontmatter: Record<string, unknown>, body: string): string {
  const fmYaml = yaml
    .stringify(frontmatter, {
      lineWidth: 0,
      defaultStringType: "PLAIN",
      defaultKeyType: "PLAIN",
    })
    .trimEnd();
  // Preserve a single trailing newline; gray-matter's parsed.content already
  // begins with a newline after the frontmatter delimiters.
  const trimmedBody = body.replace(/^\n+/, "");
  return `---\n${fmYaml}\n---\n\n${trimmedBody.replace(/\n+$/, "")}\n`;
}
