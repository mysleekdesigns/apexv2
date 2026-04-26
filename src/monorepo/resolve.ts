// Per-package override resolution for monorepos.
//
// Mirrors directory-scoped CLAUDE.md behavior: a knowledge entry defined inside
// a package's `.apex/knowledge/` overrides a same-id entry from the monorepo
// root's `.apex/knowledge/`. Same id, package-scoped value wins.
//
// These functions are deliberately pure — no I/O, no fs touches. Pass in the
// already-loaded entry lists (use `loader.ts` to gather them). This makes the
// merge logic trivially testable and lets callers cache loads.

import path from "node:path";
import type { KnowledgeEntry } from "../types/shared.js";
import type { PackageInfo } from "./discover.js";

export interface ResolvedKnowledge {
  /** Entries from the monorepo-root `.apex/knowledge/`. */
  rootEntries: KnowledgeEntry[];
  /** Entries from the matched package's `.apex/knowledge/` (empty if not in a package). */
  packageEntries: KnowledgeEntry[];
  /**
   * IDs of entries in the merged view, in stable order: package overrides first
   * (alphabetical by id), then root-only entries (alphabetical by id).
   */
  mergedIds: string[];
  /** IDs that exist in BOTH lists — the package version is the effective one. */
  overriddenIds: string[];
  /**
   * Final merged entry list, with package entries replacing same-id root entries.
   * Sorted by id for stable output.
   */
  merged: KnowledgeEntry[];
  /** The matched package (null if `filePath` is outside any package). */
  matchedPackage: PackageInfo | null;
}

/**
 * Find the package that contains `filePath`. Returns the package whose `path`
 * is the longest prefix of `filePath` — i.e. nested packages match the most
 * specific one. Returns null if `filePath` is not inside any known package.
 *
 * `filePath` may be absolute or relative-to-`root`; both are handled.
 */
export function findContainingPackage(
  root: string,
  filePath: string,
  packages: PackageInfo[],
): PackageInfo | null {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
  let best: PackageInfo | null = null;
  let bestLen = -1;
  for (const pkg of packages) {
    const pkgPath = path.resolve(pkg.path);
    // Use path.relative + sentinel check to avoid false positives like
    // `/repo/packages/foo-bar` matching when only `/repo/packages/foo` is the prefix.
    const rel = path.relative(pkgPath, abs);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      if (pkgPath.length > bestLen) {
        best = pkg;
        bestLen = pkgPath.length;
      }
    }
  }
  return best;
}

/**
 * Merge root + package knowledge for a file lookup. Pure: no I/O.
 *
 * If `filePath` is not inside any package (or `packages` is empty), returns
 * the root entries unmodified, with no overrides.
 */
export function resolveKnowledgeForPath(
  root: string,
  filePath: string,
  rootEntries: KnowledgeEntry[],
  packages: PackageInfo[],
  packageEntriesByPath: Map<string, KnowledgeEntry[]>,
): ResolvedKnowledge {
  const matchedPackage = findContainingPackage(root, filePath, packages);
  const packageEntries = matchedPackage
    ? (packageEntriesByPath.get(path.resolve(matchedPackage.path)) ?? [])
    : [];

  return mergeKnowledge(rootEntries, packageEntries, matchedPackage);
}

/**
 * Lower-level merge primitive — merges two entry lists with package-wins
 * semantics on `frontmatter.id` collisions. Useful for tests and callers
 * that already know which package they're in.
 */
export function mergeKnowledge(
  rootEntries: KnowledgeEntry[],
  packageEntries: KnowledgeEntry[],
  matchedPackage: PackageInfo | null = null,
): ResolvedKnowledge {
  const rootById = new Map<string, KnowledgeEntry>();
  for (const e of rootEntries) rootById.set(e.frontmatter.id, e);

  const pkgById = new Map<string, KnowledgeEntry>();
  for (const e of packageEntries) pkgById.set(e.frontmatter.id, e);

  const overriddenIds: string[] = [];
  for (const id of pkgById.keys()) {
    if (rootById.has(id)) overriddenIds.push(id);
  }
  overriddenIds.sort();

  // Build merged: package-version wins on collision; root-only entries fill the rest.
  const mergedMap = new Map<string, KnowledgeEntry>();
  for (const [id, e] of rootById) mergedMap.set(id, e);
  for (const [id, e] of pkgById) mergedMap.set(id, e);

  const mergedIds = [...mergedMap.keys()].sort();
  const merged = mergedIds.map((id) => mergedMap.get(id)!);

  return {
    rootEntries,
    packageEntries,
    mergedIds,
    overriddenIds,
    merged,
    matchedPackage,
  };
}
