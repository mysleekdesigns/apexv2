// Pack loader: discovers and parses APEX knowledge packs.
//
// Layout convention (under any "packs root"):
//
//   <packsRoot>/
//     <pack-id>/
//       pack.toml                    # PackManifest
//       entries/<id>.md              # one knowledge entry per file
//       (or)
//       decisions/<id>.md
//       patterns/<id>.md
//       gotchas/<id>.md
//       conventions/<id>.md
//
// Both flat (`entries/`) and per-type subdirectories are accepted; the
// authoritative `type` for each entry comes from its YAML frontmatter.
//
// `listAvailablePacks(rootOrTemplatesDir)` discovers manifests; `loadPack(...)`
// parses + validates a pack's manifest and all of its entries.

import path from "node:path";
import fs from "fs-extra";
import matter from "gray-matter";
import yaml from "yaml";
import { parse as tomlParse } from "smol-toml";
import { templatesDir } from "../util/paths.js";
import {
  countEntries,
  packManifestSchema,
  validatePackEntryFrontmatter,
  type Pack,
  type PackEntry,
  type PackManifest,
} from "./types.js";

// gray-matter would coerce ISO dates to Date objects without this; we want
// the frontmatter to round-trip as plain strings so zod's regex passes.
const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

const ENTRY_SUBDIRS = ["entries", "decisions", "patterns", "gotchas", "conventions"];

export interface PackDescriptor {
  id: string;
  version: string;
  title: string;
  description: string;
  stack: string;
  /** Absolute path to the pack's root directory. */
  dir: string;
  /** Absolute path to the pack.toml manifest. */
  manifestPath: string;
}

/**
 * Resolve the directory APEX should scan for packs.
 *
 * Accepts either:
 *   - an explicit packs directory (`<...>/packs`),
 *   - a templates directory (`<...>/templates`) — `/packs` is appended,
 *   - a project root (anything else) — `/templates/packs` is appended,
 *   - `undefined` — uses the bundled `templates/packs` shipped with APEX.
 */
export function resolvePacksRoot(rootOrTemplatesDir?: string): string {
  if (!rootOrTemplatesDir) {
    return path.join(templatesDir(), "packs");
  }
  const abs = path.resolve(rootOrTemplatesDir);
  const base = path.basename(abs);
  if (base === "packs") return abs;
  if (base === "templates") return path.join(abs, "packs");
  return path.join(abs, "templates", "packs");
}

/**
 * Discover packs by scanning `<packsRoot>/<pack-id>/pack.toml`.
 * Returns lightweight descriptors (no entries parsed).
 */
export async function listAvailablePacks(
  rootOrTemplatesDir?: string,
): Promise<PackDescriptor[]> {
  const packsRoot = resolvePacksRoot(rootOrTemplatesDir);
  if (!(await fs.pathExists(packsRoot))) return [];

  const dirents = await fs.readdir(packsRoot, { withFileTypes: true });
  const out: PackDescriptor[] = [];

  for (const ent of dirents) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(packsRoot, ent.name);
    const manifestPath = path.join(dir, "pack.toml");
    if (!(await fs.pathExists(manifestPath))) continue;
    let manifest: PackManifest;
    try {
      manifest = await readManifest(manifestPath);
    } catch {
      // Surface clearly only via loadPack; listing should not throw on a
      // single broken pack.
      continue;
    }
    out.push({
      id: manifest.id,
      version: manifest.version,
      title: manifest.title,
      description: manifest.description,
      stack: manifest.stack,
      dir,
      manifestPath,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

async function readManifest(manifestPath: string): Promise<PackManifest> {
  const raw = await fs.readFile(manifestPath, "utf8");
  let parsed: unknown;
  try {
    parsed = tomlParse(raw);
  } catch (err) {
    throw new Error(
      `pack manifest ${manifestPath}: TOML parse error: ${(err as Error).message}`,
    );
  }
  const result = packManifestSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
      .join("; ");
    throw new Error(`pack manifest ${manifestPath}: invalid: ${issues}`);
  }
  return result.data;
}

async function listEntryFiles(packDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const sub of ENTRY_SUBDIRS) {
    const dir = path.join(packDir, sub);
    if (!(await fs.pathExists(dir))) continue;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (f.endsWith(".md")) out.push(path.join(dir, f));
    }
  }
  return out.sort();
}

export interface LoadPackOptions {
  /** Optional packs root override (path passed straight to resolvePacksRoot). */
  rootOrTemplatesDir?: string;
}

export class PackLoadError extends Error {
  public readonly errors: string[];
  constructor(packId: string, errors: string[]) {
    super(`pack '${packId}' failed validation:\n  - ${errors.join("\n  - ")}`);
    this.name = "PackLoadError";
    this.errors = errors;
  }
}

/**
 * Load a pack by id. Throws `PackLoadError` if the manifest or any entry
 * fails validation.
 */
export async function loadPack(
  packId: string,
  opts: LoadPackOptions = {},
): Promise<Pack> {
  const packsRoot = resolvePacksRoot(opts.rootOrTemplatesDir);
  const dir = path.join(packsRoot, packId);
  const manifestPath = path.join(dir, "pack.toml");
  if (!(await fs.pathExists(manifestPath))) {
    throw new PackLoadError(packId, [
      `manifest not found at ${manifestPath} (packsRoot=${packsRoot})`,
    ]);
  }

  let manifest: PackManifest;
  try {
    manifest = await readManifest(manifestPath);
  } catch (err) {
    throw new PackLoadError(packId, [(err as Error).message]);
  }

  if (manifest.id !== packId) {
    throw new PackLoadError(packId, [
      `manifest id "${manifest.id}" does not match directory "${packId}"`,
    ]);
  }

  const entryFiles = await listEntryFiles(dir);
  const entries: PackEntry[] = [];
  const errors: string[] = [];

  for (const filePath of entryFiles) {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (err) {
      errors.push(`${filePath}: read failed: ${(err as Error).message}`);
      continue;
    }
    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(raw, matterOptions);
    } catch (err) {
      errors.push(`${filePath}: YAML parse error: ${(err as Error).message}`);
      continue;
    }
    const fmRaw = parsed.data as Record<string, unknown>;
    if (!fmRaw || Object.keys(fmRaw).length === 0) {
      errors.push(`${filePath}: missing or empty frontmatter`);
      continue;
    }
    const v = validatePackEntryFrontmatter(fmRaw, filePath);
    if (!v.ok || !v.frontmatter) {
      errors.push(...(v.errors ?? [`${filePath}: invalid frontmatter`]));
      continue;
    }
    const stem = path.basename(filePath, ".md");
    if (stem !== v.frontmatter.id) {
      errors.push(
        `${filePath}: filename stem "${stem}" must equal frontmatter id "${v.frontmatter.id}"`,
      );
      continue;
    }
    entries.push({
      sourcePath: filePath,
      frontmatter: v.frontmatter,
      body: parsed.content.trim(),
    });
  }

  // ID-uniqueness within type.
  const seen = new Map<string, string>();
  for (const e of entries) {
    const k = `${e.frontmatter.type}:${e.frontmatter.id}`;
    if (seen.has(k)) {
      errors.push(
        `${e.sourcePath}: duplicate ${e.frontmatter.type} id "${e.frontmatter.id}" (also defined at ${seen.get(k)})`,
      );
    } else {
      seen.set(k, e.sourcePath);
    }
  }

  if (errors.length > 0) {
    throw new PackLoadError(packId, errors);
  }

  return {
    manifest,
    rootDir: dir,
    entries,
    counts: countEntries(entries),
  };
}
