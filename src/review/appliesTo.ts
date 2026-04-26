// applies_to validation & filtering helpers (Phase 5.2).
//
// Per specs/knowledge-schema.md, every entry frontmatter has an `applies_to`
// field with allowed values: "user" | "team" | "all". This module exposes:
//
//   * filterByAudience(entries, audience): pick the entries visible to a given
//     audience. "all" entries are always visible; "team" entries are visible to
//     team callers; "user" entries are visible to user callers.
//   * lintEntries(entriesDir): walk a knowledge tree and return warnings for
//     entries whose applies_to field is missing or invalid. Pure I/O, no side
//     effects beyond reading from disk.

import path from "node:path";
import fs from "node:fs/promises";
import matter from "gray-matter";
import yaml from "yaml";
import type { AppliesTo, KnowledgeEntry } from "../types/shared.js";

const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

export const VALID_APPLIES_TO: readonly AppliesTo[] = ["user", "team", "all"] as const;

/** Audience requesting filtered entries. "all" is treated as a synonym for "team" + "user". */
export type Audience = "user" | "team" | "all";

/**
 * Filter knowledge entries by audience.
 *
 * Visibility table (matches §5.2 design intent — "personal preferences don't
 * pollute team knowledge"):
 *
 *   audience = "team" → entries with applies_to ∈ {"team", "all"}
 *   audience = "user" → entries with applies_to ∈ {"user", "all"}
 *   audience = "all"  → every valid entry is returned.
 *
 * Entries with an invalid or missing applies_to are silently dropped. Use
 * lintEntries() if you want warnings about them.
 */
export function filterByAudience<E extends { frontmatter: { applies_to?: unknown } }>(
  entries: E[],
  audience: Audience,
): E[] {
  return entries.filter((e) => {
    const applies = e.frontmatter.applies_to;
    if (typeof applies !== "string") return false;
    if (!(VALID_APPLIES_TO as readonly string[]).includes(applies)) return false;
    if (audience === "all") return true;
    if (applies === "all") return true;
    return applies === audience;
  });
}

export interface LintWarning {
  /** Repo-relative or absolute path of the offending file. */
  path: string;
  /** id parsed from frontmatter (or filename stem when frontmatter unreadable). */
  id: string;
  /** "missing" — frontmatter has no applies_to. "invalid" — value is not user/team/all. */
  kind: "missing" | "invalid" | "unparseable";
  /** Raw value found, when kind === "invalid". */
  value?: string;
  /** Human-readable description. */
  message: string;
}

const KNOWLEDGE_SUBDIRS = ["decisions", "patterns", "gotchas", "conventions"] as const;

/**
 * Walk a knowledge directory tree (typical: `<root>/.apex/knowledge`) and
 * return one warning per entry whose `applies_to` field is missing or invalid.
 *
 * Behaviour:
 *   - Walks each of the four type subdirectories.
 *   - Skips files that don't end with `.md` and files starting with "_"
 *     (matches the loader convention).
 *   - When a file's frontmatter cannot be parsed, emits a single
 *     kind: "unparseable" warning. Does NOT throw.
 *   - Returns warnings sorted by path so output is deterministic in tests.
 *
 * `entriesDir` may be either the .apex/knowledge directory itself, or any
 * directory containing the four subdirs. Subdirs that don't exist are
 * silently skipped.
 */
export async function lintEntries(entriesDir: string): Promise<LintWarning[]> {
  const warnings: LintWarning[] = [];

  for (const sub of KNOWLEDGE_SUBDIRS) {
    const dir = path.join(entriesDir, sub);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      if (f.startsWith("_")) continue;
      const filePath = path.join(dir, f);
      const stem = f.slice(0, -3);
      let raw: string;
      try {
        raw = await fs.readFile(filePath, "utf8");
      } catch (err) {
        warnings.push({
          path: filePath,
          id: stem,
          kind: "unparseable",
          message: `${filePath}: could not read file: ${(err as Error).message}`,
        });
        continue;
      }
      let parsed: ReturnType<typeof matter>;
      try {
        parsed = matter(raw, matterOptions);
      } catch (err) {
        warnings.push({
          path: filePath,
          id: stem,
          kind: "unparseable",
          message: `${filePath}: YAML parse error: ${(err as Error).message}`,
        });
        continue;
      }
      const fm = parsed.data as Record<string, unknown>;
      const id = typeof fm["id"] === "string" ? (fm["id"] as string) : stem;
      const applies = fm["applies_to"];
      if (applies === undefined || applies === null || applies === "") {
        warnings.push({
          path: filePath,
          id,
          kind: "missing",
          message: `${filePath}: applies_to is missing (must be one of ${VALID_APPLIES_TO.join(", ")})`,
        });
        continue;
      }
      if (
        typeof applies !== "string" ||
        !(VALID_APPLIES_TO as readonly string[]).includes(applies)
      ) {
        warnings.push({
          path: filePath,
          id,
          kind: "invalid",
          value: String(applies),
          message: `${filePath}: applies_to has invalid value "${String(applies)}" (must be one of ${VALID_APPLIES_TO.join(", ")})`,
        });
      }
    }
  }

  warnings.sort((a, b) => a.path.localeCompare(b.path));
  return warnings;
}

/**
 * Convenience: narrow a parsed knowledge entry array to only those with a
 * known-good applies_to. Used by callers that consumed loadKnowledge() and
 * want to be permissive about malformed neighbours.
 */
export function pickValidApplies<E extends KnowledgeEntry>(entries: E[]): E[] {
  return entries.filter((e) =>
    (VALID_APPLIES_TO as readonly string[]).includes(e.frontmatter.applies_to),
  );
}
