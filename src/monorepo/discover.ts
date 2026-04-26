// Monorepo discovery for APEX.
//
// Detects whether the project at `root` is a monorepo and, if so, enumerates
// its packages. The detector is deliberately tolerant — any signal indicating
// a workspace is enough; we then try to enumerate packages from that signal
// (with a globby-free, dependency-free expansion of common patterns).
//
// Returned shape: `{ kind, root, packages: PackageInfo[] }` or `null` for the
// single-repo case (no monorepo signals found).

import fs from "node:fs/promises";
import path from "node:path";
import yaml from "yaml";
import { parse as tomlParse } from "smol-toml";

export type MonorepoKind =
  | "pnpm"
  | "lerna"
  | "nx"
  | "turbo"
  | "yarn"
  | "npm"
  | "cargo";

export interface PackageInfo {
  /** Package name (from package.json or directory name fallback). */
  name: string;
  /** Absolute path to the package root directory. */
  path: string;
  /**
   * Absolute path to the package's `.apex/` directory if one exists,
   * otherwise null. The directory must already exist on disk; we never
   * create it here.
   */
  apexDir: string | null;
}

export interface MonorepoInfo {
  kind: MonorepoKind;
  /** Absolute monorepo root path. */
  root: string;
  packages: PackageInfo[];
}

async function readJsonIfExists(p: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

async function readTextIfExists(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch {
    return null;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    const st = await fs.stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Expand a workspace glob pattern (rooted at `root`) into matching directory
 * paths. We only support the two patterns that account for >95% of real-world
 * monorepo configs: `<dir>/*` and `<dir>/<name>` (a literal package path).
 *
 * `**` and other complex globs are intentionally not supported here — projects
 * using them tend to also have richer tooling that lists packages explicitly.
 */
async function expandWorkspacePattern(root: string, pattern: string): Promise<string[]> {
  const trimmed = pattern.replace(/^\.\/+/, "");
  // Plain literal path (no glob) → return if it exists and is a directory.
  if (!trimmed.includes("*")) {
    const p = path.join(root, trimmed);
    return (await isDir(p)) ? [p] : [];
  }
  // `dir/*` form: list immediate subdirs of `dir` that contain a package.json
  // (or, for non-node monorepos like cargo, just any subdir).
  if (trimmed.endsWith("/*")) {
    const parent = path.join(root, trimmed.slice(0, -2));
    if (!(await isDir(parent))) return [];
    let names: string[];
    try {
      names = await fs.readdir(parent);
    } catch {
      return [];
    }
    const out: string[] = [];
    for (const n of names) {
      if (n.startsWith(".")) continue;
      const full = path.join(parent, n);
      if (await isDir(full)) out.push(full);
    }
    return out;
  }
  // Anything more exotic — skip.
  return [];
}

async function packageInfoFor(packagePath: string): Promise<PackageInfo | null> {
  if (!(await isDir(packagePath))) return null;
  // Prefer name from package.json; fall back to dirname.
  const pkgJson = (await readJsonIfExists(path.join(packagePath, "package.json"))) as
    | { name?: unknown }
    | null;
  let name = path.basename(packagePath);
  if (pkgJson && typeof pkgJson.name === "string" && pkgJson.name.length > 0) {
    name = pkgJson.name;
  }
  // Cargo crates carry their name in Cargo.toml.
  if (!pkgJson) {
    const cargoToml = await readTextIfExists(path.join(packagePath, "Cargo.toml"));
    if (cargoToml) {
      const parsed = safeParseToml(cargoToml);
      const pkg = parsed && typeof parsed === "object" ? (parsed as { package?: unknown }).package : null;
      if (pkg && typeof pkg === "object") {
        const n = (pkg as { name?: unknown }).name;
        if (typeof n === "string" && n.length > 0) name = n;
      }
    }
  }
  const apexDir = path.join(packagePath, ".apex");
  const hasApex = await isDir(apexDir);
  return {
    name,
    path: packagePath,
    apexDir: hasApex ? apexDir : null,
  };
}

function safeParseToml(s: string): unknown {
  try {
    return tomlParse(s);
  } catch {
    return null;
  }
}

async function enumeratePackages(
  root: string,
  patterns: string[],
): Promise<PackageInfo[]> {
  const seen = new Set<string>();
  const out: PackageInfo[] = [];
  for (const pat of patterns) {
    const dirs = await expandWorkspacePattern(root, pat);
    for (const d of dirs) {
      const resolved = path.resolve(d);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      const info = await packageInfoFor(resolved);
      if (info) out.push(info);
    }
  }
  // Stable ordering by path for deterministic test output.
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Detect a monorepo at `root`. Returns `null` if no signals are found.
 *
 * Detection priority (first match wins for `kind`):
 *  1. pnpm-workspace.yaml         → pnpm
 *  2. lerna.json                  → lerna
 *  3. nx.json                     → nx
 *  4. turbo.json                  → turbo
 *  5. package.json `workspaces`   → yarn/npm (yarn if `yarn.lock` exists)
 *  6. Cargo.toml `[workspace]`    → cargo
 */
export async function detectMonorepo(root: string): Promise<MonorepoInfo | null> {
  const absRoot = path.resolve(root);

  // 1. pnpm-workspace.yaml
  const pnpmYaml = await readTextIfExists(path.join(absRoot, "pnpm-workspace.yaml"));
  if (pnpmYaml !== null) {
    let patterns: string[] = [];
    try {
      const parsed = yaml.parse(pnpmYaml) as { packages?: unknown } | null;
      if (parsed && Array.isArray(parsed.packages)) {
        patterns = parsed.packages.filter((x): x is string => typeof x === "string");
      }
    } catch {
      /* ignore — empty patterns */
    }
    const packages = await enumeratePackages(absRoot, patterns);
    return { kind: "pnpm", root: absRoot, packages };
  }

  // 2. lerna.json
  const lerna = (await readJsonIfExists(path.join(absRoot, "lerna.json"))) as
    | { packages?: unknown }
    | null;
  if (lerna !== null) {
    const patterns =
      Array.isArray(lerna.packages)
        ? lerna.packages.filter((x): x is string => typeof x === "string")
        : ["packages/*"];
    const packages = await enumeratePackages(absRoot, patterns);
    return { kind: "lerna", root: absRoot, packages };
  }

  // 3. nx.json (Nx workspaces typically use package.json `workspaces` for the package list)
  if (await exists(path.join(absRoot, "nx.json"))) {
    const pkg = (await readJsonIfExists(path.join(absRoot, "package.json"))) as
      | { workspaces?: unknown }
      | null;
    const patterns = extractWorkspacesField(pkg);
    // Nx commonly has `apps/*` and `libs/*` even without explicit workspaces field.
    const fallback = patterns.length > 0 ? patterns : ["apps/*", "libs/*", "packages/*"];
    const packages = await enumeratePackages(absRoot, fallback);
    return { kind: "nx", root: absRoot, packages };
  }

  // 4. turbo.json
  if (await exists(path.join(absRoot, "turbo.json"))) {
    const pkg = (await readJsonIfExists(path.join(absRoot, "package.json"))) as
      | { workspaces?: unknown }
      | null;
    const patterns = extractWorkspacesField(pkg);
    const packages = await enumeratePackages(
      absRoot,
      patterns.length > 0 ? patterns : ["packages/*", "apps/*"],
    );
    return { kind: "turbo", root: absRoot, packages };
  }

  // 5. package.json workspaces (yarn or npm)
  const pkg = (await readJsonIfExists(path.join(absRoot, "package.json"))) as
    | { workspaces?: unknown }
    | null;
  const wsPatterns = extractWorkspacesField(pkg);
  if (wsPatterns.length > 0) {
    const yarnLock = await exists(path.join(absRoot, "yarn.lock"));
    const kind: MonorepoKind = yarnLock ? "yarn" : "npm";
    const packages = await enumeratePackages(absRoot, wsPatterns);
    return { kind, root: absRoot, packages };
  }

  // 6. Cargo workspace
  const cargoToml = await readTextIfExists(path.join(absRoot, "Cargo.toml"));
  if (cargoToml !== null) {
    const parsed = safeParseToml(cargoToml);
    if (parsed && typeof parsed === "object") {
      const ws = (parsed as { workspace?: unknown }).workspace;
      if (ws && typeof ws === "object") {
        const members = (ws as { members?: unknown }).members;
        const patterns = Array.isArray(members)
          ? members.filter((x): x is string => typeof x === "string")
          : [];
        const packages = await enumeratePackages(absRoot, patterns);
        return { kind: "cargo", root: absRoot, packages };
      }
    }
  }

  return null;
}

function extractWorkspacesField(pkg: { workspaces?: unknown } | null): string[] {
  if (!pkg) return [];
  const ws = pkg.workspaces;
  if (Array.isArray(ws)) {
    return ws.filter((x): x is string => typeof x === "string");
  }
  if (ws && typeof ws === "object") {
    const packages = (ws as { packages?: unknown }).packages;
    if (Array.isArray(packages)) {
      return packages.filter((x): x is string => typeof x === "string");
    }
  }
  return [];
}
