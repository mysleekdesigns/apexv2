// Drift detection for knowledge entries.
//
// Phase 4.3 extends Phase 2's file-existence check with three more drift kinds:
//   * file_missing      — `file/<path>:<line>` source ref points at a deleted file
//   * symbol_missing    — symbol referenced in body/sources is gone from the codeindex
//   * reference_missing — frontmatter `references: [...]` lists a non-existent path
//   * path_missing      — inline relative path in body markdown no longer exists
//
// All scanning is best-effort and never throws on filesystem or codeindex errors.

import fs from "node:fs";
import path from "node:path";
import type { KnowledgeEntry } from "../types/shared.js";
import { CodeIndex } from "../codeindex/index.js";

// `file/<path>:<line>` or `file/<path>` (line optional).
const FILE_REF_RE = /^file\/(.+?)(?::\d+)?$/;
// `symbol:<file>:<line>` (line optional).
const SYMBOL_REF_RE = /^symbol:(.+?)(?::(\d+))?$/;
// `[[symbol-name]]` wiki-link in body markdown.
const WIKI_LINK_RE = /\[\[([a-zA-Z_$][a-zA-Z0-9_$-]*)\]\]/g;
// Relative path inside body. Anchored to non-word boundary; URLs filtered separately.
const INLINE_PATH_RE =
  /(^|[\s(`'"<>])([a-zA-Z0-9_./-]+\.(?:ts|tsx|js|jsx|py|rs|go|md|json|yaml|toml))(?=[\s)`'"<>,.;:!?]|$)/g;

const SUPPORTED_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".md",
  ".json",
  ".yaml",
  ".toml",
]);

export type DriftKind =
  | "file_missing"
  | "symbol_missing"
  | "reference_missing"
  | "path_missing";

export type DriftSeverity = "high" | "medium" | "low";

export interface DriftHit {
  entry_id: string;
  kind: DriftKind;
  ref: string;
  severity: DriftSeverity;
}

export const DEFAULT_SEVERITY: Record<DriftKind, DriftSeverity> = {
  file_missing: "high",
  symbol_missing: "medium",
  reference_missing: "medium",
  path_missing: "low",
};

// ---- Phase 2 compatibility surface -----------------------------------------

export interface DriftEntry {
  entry: KnowledgeEntry;
  /** The source ref that triggered the drift. */
  ref: string;
  /** The resolved file path that no longer exists. */
  missingPath: string;
}

/**
 * Phase 2 surface — kept stable for callers that still want the gotcha-only,
 * one-hit-per-entry view. Internally implemented in terms of {@link findAllDrift}.
 */
export function findDriftEntries(entries: KnowledgeEntry[], root: string): DriftEntry[] {
  const out: DriftEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.frontmatter.type !== "gotcha") continue;
    if (seen.has(entry.frontmatter.id)) continue;
    for (const source of entry.frontmatter.sources) {
      const m = FILE_REF_RE.exec(source.ref);
      if (!m) continue;
      const filePath = m[1]!;
      if (!fileExists(root, filePath)) {
        out.push({ entry, ref: source.ref, missingPath: filePath });
        seen.add(entry.frontmatter.id);
        break;
      }
    }
  }
  return out;
}

// ---- Extended detection ----------------------------------------------------

export interface ExtendedDriftOptions {
  /**
   * Optional codeindex instance. If supplied, used for symbol-existence checks.
   * If omitted, callers should pass `useGrepFallback: true` to fall back to
   * a grep-style scan over the working tree.
   */
  codeIndex?: CodeIndex | null;
  /** When true and no codeindex is available, grep the working tree for the symbol. */
  useGrepFallback?: boolean;
}

export interface ExtendedDriftResult {
  hits: DriftHit[];
  /** Convenience grouping by entry id. */
  byEntry: Map<string, DriftHit[]>;
}

/**
 * Scan every knowledge entry across all four drift kinds.
 *
 * Tolerates missing codeindex (degrades to grep fallback or treats symbol checks
 * as inconclusive — no hit is emitted). Never throws on filesystem errors.
 */
export async function findAllDrift(
  entries: KnowledgeEntry[],
  root: string,
  opts: ExtendedDriftOptions = {},
): Promise<ExtendedDriftResult> {
  const hits: DriftHit[] = [];
  const symbolCache = new Map<string, boolean>();

  for (const entry of entries) {
    const id = entry.frontmatter.id;

    // 1. File-existence drift via `file/<path>` source refs.
    for (const src of entry.frontmatter.sources) {
      const m = FILE_REF_RE.exec(src.ref);
      if (!m) continue;
      const filePath = m[1]!;
      if (!fileExists(root, filePath)) {
        hits.push({
          entry_id: id,
          kind: "file_missing",
          ref: src.ref,
          severity: DEFAULT_SEVERITY.file_missing,
        });
      }
    }

    // 2. Symbol-existence drift via `symbol:<file>:<line>` source refs and `[[wiki]]` body links.
    const symbolRefs = collectSymbolRefs(entry);
    for (const sref of symbolRefs) {
      const exists = await checkSymbol(sref, symbolCache, root, opts);
      if (exists === false) {
        hits.push({
          entry_id: id,
          kind: "symbol_missing",
          ref: sref.ref,
          severity: DEFAULT_SEVERITY.symbol_missing,
        });
      }
    }

    // 3. Frontmatter `references:` array drift.
    const refsField = (entry.frontmatter as unknown as Record<string, unknown>)["references"];
    if (Array.isArray(refsField)) {
      for (const r of refsField) {
        if (typeof r !== "string" || r.length === 0) continue;
        if (!fileExists(root, r)) {
          hits.push({
            entry_id: id,
            kind: "reference_missing",
            ref: r,
            severity: DEFAULT_SEVERITY.reference_missing,
          });
        }
      }
    }

    // 4. Inline path drift in the body markdown (skip fenced code blocks).
    const inlinePaths = collectInlinePaths(entry.body);
    for (const p of inlinePaths) {
      if (!fileExists(root, p)) {
        hits.push({
          entry_id: id,
          kind: "path_missing",
          ref: p,
          severity: DEFAULT_SEVERITY.path_missing,
        });
      }
    }
  }

  const byEntry = new Map<string, DriftHit[]>();
  for (const h of hits) {
    if (!byEntry.has(h.entry_id)) byEntry.set(h.entry_id, []);
    byEntry.get(h.entry_id)!.push(h);
  }

  return { hits, byEntry };
}

// ---- Helpers ---------------------------------------------------------------

function fileExists(root: string, rel: string): boolean {
  try {
    return fs.existsSync(path.resolve(root, rel));
  } catch {
    return false;
  }
}

interface SymbolRef {
  /** Original ref string (used in DriftHit.ref). */
  ref: string;
  /** The bare symbol name (last path segment / wiki-link content). */
  name: string;
  /** Optional file path (only present for `symbol:<file>:<line>` refs). */
  file?: string;
}

function collectSymbolRefs(entry: KnowledgeEntry): SymbolRef[] {
  const out: SymbolRef[] = [];

  for (const src of entry.frontmatter.sources) {
    const m = SYMBOL_REF_RE.exec(src.ref);
    if (!m) continue;
    const filePart = m[1]!;
    const baseName = path.basename(filePart, path.extname(filePart));
    out.push({ ref: src.ref, name: baseName, file: filePart });
  }

  // Strip fenced code blocks before pulling wiki-links so we don't pick up
  // links shown as examples.
  const stripped = stripFencedBlocks(entry.body);
  let m: RegExpExecArray | null;
  WIKI_LINK_RE.lastIndex = 0;
  while ((m = WIKI_LINK_RE.exec(stripped)) !== null) {
    const name = m[1]!;
    out.push({ ref: `[[${name}]]`, name });
  }

  return out;
}

async function checkSymbol(
  sref: SymbolRef,
  cache: Map<string, boolean>,
  root: string,
  opts: ExtendedDriftOptions,
): Promise<boolean | null> {
  const cacheKey = sref.file ? `${sref.file}::${sref.name}` : sref.name;
  const prior = cache.get(cacheKey);
  if (prior !== undefined) return prior;

  // For symbol:<file>:<line> refs, the file itself going missing is the
  // strongest signal — file_missing already covers the disk state, but for
  // the symbol-check we report missing when neither codeindex nor grep finds it.
  if (sref.file) {
    if (!fileExists(root, sref.file)) {
      cache.set(cacheKey, false);
      return false;
    }
  }

  if (opts.codeIndex) {
    try {
      const hits = await opts.codeIndex.findSymbol(sref.name, { k: 5 });
      if (hits.length > 0) {
        if (sref.file) {
          const ok = hits.some((h) => h.file === sref.file || h.file.endsWith(`/${sref.file}`));
          cache.set(cacheKey, ok || hits.length > 0 ? ok : false);
          // Don't be too strict: if the codeindex has the symbol anywhere, accept it.
          if (!ok) {
            cache.set(cacheKey, true);
            return true;
          }
          return ok;
        }
        cache.set(cacheKey, true);
        return true;
      }
      cache.set(cacheKey, false);
      return false;
    } catch {
      // fall through to grep
    }
  }

  if (opts.useGrepFallback) {
    const found = grepSymbol(root, sref.name);
    cache.set(cacheKey, found);
    return found;
  }

  // No way to check — return null = inconclusive (caller emits no hit).
  return null;
}

function grepSymbol(root: string, name: string): boolean {
  // Conservative recursive scan — limited to common code dirs to keep tests fast.
  const candidates = ["src", "lib", "app", "apps", "packages", "test", "tests"];
  const seen: string[] = [];
  for (const c of candidates) {
    seen.push(path.resolve(root, c));
  }
  seen.push(path.resolve(root));

  const word = new RegExp(`\\b${escapeRegex(name)}\\b`);
  const visited = new Set<string>();

  function walk(dir: string, depth: number): boolean {
    if (depth > 6) return false;
    if (visited.has(dir)) return false;
    visited.add(dir);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      if (
        ent.name === "node_modules" ||
        ent.name === "dist" ||
        ent.name === "build" ||
        ent.name === "coverage"
      ) {
        continue;
      }
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (walk(full, depth + 1)) return true;
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name);
      if (!SUPPORTED_EXTS.has(ext)) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > 1_000_000) continue;
      let txt: string;
      try {
        txt = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (word.test(txt)) return true;
    }
    return false;
  }

  for (const start of seen) {
    if (!fs.existsSync(start)) continue;
    if (walk(start, 0)) return true;
  }
  return false;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remove fenced code blocks (```...```) so that paths shown in code examples
 * are not flagged as drift.
 */
function stripFencedBlocks(body: string): string {
  return body.replace(/```[\s\S]*?```/g, "");
}

function collectInlinePaths(body: string): string[] {
  const stripped = stripFencedBlocks(body);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  INLINE_PATH_RE.lastIndex = 0;
  while ((m = INLINE_PATH_RE.exec(stripped)) !== null) {
    const candidate = m[2]!;
    // Skip URLs, scheme:// patterns, and bare filenames without slashes that
    // are common false positives (e.g. `.eslintrc.json` referenced abstractly).
    if (/^(https?|ftp|file):/i.test(candidate)) continue;
    if (candidate.includes("://")) continue;
    if (candidate.startsWith("./") || candidate.startsWith("../")) {
      out.push(candidate.replace(/^\.\//, ""));
      continue;
    }
    // Require at least one slash — bare `something.json` is too noisy.
    if (!candidate.includes("/")) continue;
    out.push(candidate);
  }
  return out;
}

// ---- Severity breakdown helper --------------------------------------------

export interface DriftSeverityCounts {
  high: number;
  medium: number;
  low: number;
}

export function severityBreakdown(hits: DriftHit[]): DriftSeverityCounts {
  const out: DriftSeverityCounts = { high: 0, medium: 0, low: 0 };
  for (const h of hits) out[h.severity]++;
  return out;
}
