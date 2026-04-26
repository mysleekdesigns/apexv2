// Thin I/O loader for monorepo knowledge.
//
// Wraps `loadKnowledge` to read both the monorepo root's knowledge dir and
// each package's `.apex/knowledge/`. Kept separate from `resolve.ts` so
// override-resolution logic stays purely functional.

import path from "node:path";
import type { KnowledgeEntry } from "../types/shared.js";
import { loadKnowledge } from "../recall/loader.js";
import type { MonorepoInfo, PackageInfo } from "./discover.js";

export interface MonorepoKnowledge {
  rootEntries: KnowledgeEntry[];
  /** Map keyed by absolute package path → that package's loaded entries. */
  packageEntriesByPath: Map<string, KnowledgeEntry[]>;
}

/**
 * Load knowledge for a discovered monorepo. Each package that has a `.apex/`
 * directory is loaded independently and keyed by its absolute path.
 *
 * Note: each per-package load runs the full validation (gray-matter, zod,
 * id-matches-filename, type-matches-dir, last_validated >= created). Invalid
 * entries are skipped per the underlying loader's contract.
 */
export async function loadMonorepoKnowledge(
  info: MonorepoInfo,
): Promise<MonorepoKnowledge> {
  const rootEntries = await loadKnowledge(info.root, { onWarn: () => {} });
  const packageEntriesByPath = new Map<string, KnowledgeEntry[]>();
  for (const pkg of info.packages) {
    if (!pkg.apexDir) continue;
    const entries = await loadPackageKnowledge(pkg);
    packageEntriesByPath.set(path.resolve(pkg.path), entries);
  }
  return { rootEntries, packageEntriesByPath };
}

/**
 * Load knowledge from a single package's `.apex/knowledge/` directory. The
 * package itself is treated as the "root" for the underlying loader, which
 * means the loader looks at `<package>/.apex/knowledge/{decisions,...}`.
 */
export async function loadPackageKnowledge(pkg: PackageInfo): Promise<KnowledgeEntry[]> {
  if (!pkg.apexDir) return [];
  return loadKnowledge(pkg.path, { onWarn: () => {} });
}
