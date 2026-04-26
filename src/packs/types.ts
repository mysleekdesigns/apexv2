// Pack format types and zod validators for APEX knowledge packs.
//
// A "pack" is a curated bundle of knowledge entries (patterns, gotchas,
// conventions, decisions) for a specific stack (Next.js, Django, Rails, …).
// Pack entries match the same frontmatter contract as `.apex/knowledge/`
// entries (see `specs/knowledge-schema.md`) so packs round-trip cleanly
// through the existing FTS / vector / graph subsystems once promoted.

import { z } from "zod";
import type { KnowledgeFrontmatter } from "../types/shared.js";

// ---------- Frontmatter validators (mirror promote/validate.ts) -------------

const ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const sourceSchema = z.object({
  kind: z.enum(["bootstrap", "correction", "reflection", "manual", "pr"]),
  ref: z.string().min(1),
  note: z.string().optional(),
});

const baseFrontmatterShape = {
  id: z.string().regex(ID_REGEX).max(64),
  type: z.enum(["decision", "pattern", "gotcha", "convention"]),
  title: z.string().min(1).max(120),
  applies_to: z.enum(["user", "team", "all"]),
  confidence: z.enum(["low", "medium", "high"]),
  sources: z.array(sourceSchema).min(1),
  created: z.string().regex(DATE_REGEX),
  last_validated: z.string().regex(DATE_REGEX),
  supersedes: z.array(z.string().regex(ID_REGEX)).optional(),
  archived: z.boolean().optional(),
  verified: z.boolean().optional(),
  tags: z.array(z.string().min(1)).optional(),
  schema_version: z.number().optional(),
};

export const decisionFrontmatterSchema = z
  .object({
    ...baseFrontmatterShape,
    decision: z.string().min(1),
    rationale: z.string().min(1),
    outcome: z.string().min(1),
    alternatives: z.array(z.string()).optional(),
    affects: z.array(z.string()).optional(),
  })
  .passthrough();

export const patternFrontmatterSchema = z
  .object({
    ...baseFrontmatterShape,
    intent: z.string().min(1),
    applies_when: z.array(z.string()).min(1),
    example_ref: z.string().optional(),
  })
  .passthrough();

export const gotchaFrontmatterSchema = z
  .object({
    ...baseFrontmatterShape,
    symptom: z.string().min(1),
    resolution: z.string().min(1),
    error_signature: z.string().optional(),
    affects: z.array(z.string()).optional(),
    resolved_at: z.string().optional(),
  })
  .passthrough();

export const conventionFrontmatterSchema = z
  .object({
    ...baseFrontmatterShape,
    rule: z.string().min(1),
    enforcement: z.enum(["manual", "lint", "ci", "hook"]),
    scope: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * Discriminated zod schema across all four entry types.
 * Usage:
 *   const result = entryFrontmatterSchema.safeParse(parsedYaml);
 *   if (!result.success) handle(result.error);
 */
export const entryFrontmatterSchema = z.discriminatedUnion("type", [
  decisionFrontmatterSchema.extend({ type: z.literal("decision") }),
  patternFrontmatterSchema.extend({ type: z.literal("pattern") }),
  gotchaFrontmatterSchema.extend({ type: z.literal("gotcha") }),
  conventionFrontmatterSchema.extend({ type: z.literal("convention") }),
]);

// ---------- Pack manifest --------------------------------------------------

export const PACK_VERSION_REGEX = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.\-]+)?$/;
export const PACK_ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface PackEntryCounts {
  total: number;
  decisions: number;
  patterns: number;
  gotchas: number;
  conventions: number;
}

export const packManifestSchema = z
  .object({
    id: z.string().regex(PACK_ID_REGEX).max(64),
    version: z.string().regex(PACK_VERSION_REGEX),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(600),
    stack: z.string().min(1).max(64),
    /** Default `applies_to` value to inject into entries that omit one. */
    applies_to_default: z.enum(["user", "team", "all"]).optional(),
    /** Optional human-readable list of authors/maintainers. */
    maintainers: z.array(z.string().min(1)).optional(),
    /** Optional homepage / repo URL. */
    homepage: z.string().url().optional(),
    /** Optional declared entry counts (sanity check, not authoritative). */
    entry_counts: z
      .object({
        total: z.number().int().nonnegative().optional(),
        decisions: z.number().int().nonnegative().optional(),
        patterns: z.number().int().nonnegative().optional(),
        gotchas: z.number().int().nonnegative().optional(),
        conventions: z.number().int().nonnegative().optional(),
      })
      .optional(),
  })
  .passthrough();

export type PackManifest = z.infer<typeof packManifestSchema>;

// ---------- Pack entry & full pack -----------------------------------------

/** A single knowledge entry inside a pack — frontmatter + markdown body. */
export interface PackEntry {
  /** Source path of the entry markdown file (under templates/packs/<id>/...) */
  sourcePath: string;
  /** Validated frontmatter conforming to specs/knowledge-schema.md. */
  frontmatter: KnowledgeFrontmatter & Record<string, unknown>;
  /** Free-form markdown body (already trimmed). */
  body: string;
}

/** A fully-loaded pack: manifest + all of its entries. */
export interface Pack {
  manifest: PackManifest;
  /** Absolute path to the directory the pack was loaded from. */
  rootDir: string;
  entries: PackEntry[];
  /** Authoritative counts derived from `entries`. */
  counts: PackEntryCounts;
}

// ---------- Public validator helpers ---------------------------------------

/** Parsed but un-validated frontmatter from a pack entry markdown file. */
export type RawFrontmatter = Record<string, unknown>;

export interface ValidateEntryResult {
  ok: boolean;
  frontmatter?: KnowledgeFrontmatter & Record<string, unknown>;
  errors?: string[];
}

/**
 * Validate a parsed frontmatter object against the knowledge schema.
 * Returns either `{ ok: true, frontmatter }` or `{ ok: false, errors }`.
 */
export function validatePackEntryFrontmatter(
  raw: RawFrontmatter,
  loc?: string,
): ValidateEntryResult {
  const where = loc ?? "<entry>";
  const result = entryFrontmatterSchema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map(
        (i) => `${where}: ${i.path.join(".") || "<root>"}: ${i.message}`,
      ),
    };
  }
  const fm = result.data as KnowledgeFrontmatter & Record<string, unknown>;
  if (fm.last_validated < fm.created) {
    return {
      ok: false,
      errors: [
        `${where}: last_validated (${fm.last_validated}) precedes created (${fm.created})`,
      ],
    };
  }
  return { ok: true, frontmatter: fm };
}

/** Compute counts by type from a list of entries. */
export function countEntries(entries: PackEntry[]): PackEntryCounts {
  const counts: PackEntryCounts = {
    total: entries.length,
    decisions: 0,
    patterns: 0,
    gotchas: 0,
    conventions: 0,
  };
  for (const e of entries) {
    switch (e.frontmatter.type) {
      case "decision":
        counts.decisions++;
        break;
      case "pattern":
        counts.patterns++;
        break;
      case "gotcha":
        counts.gotchas++;
        break;
      case "convention":
        counts.conventions++;
        break;
    }
  }
  return counts;
}
