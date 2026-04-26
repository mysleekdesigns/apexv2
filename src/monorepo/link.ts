// `apex link` core logic — share knowledge between sibling repos.
//
// DESIGN DECISION (option A — symlinks):
//   We create a real filesystem symlink at `.apex/links/<repo-name>` pointing
//   at the target repo's `.apex/knowledge/` directory. This is read-only
//   inclusion: the linked repo's knowledge is never written to from here.
//
// We also write a small `.apex/links.toml` manifest that mirrors the live
// symlink set. The manifest is the source of truth for `apex link --list`
// (so `--list` keeps working even when fs walking is awkward, e.g. the
// symlink target has gone away). Keeping the symlink AND the manifest in
// lockstep is intentional: the symlink is what tooling consumes, the
// manifest is what humans read and what survives a target-disappearance.
//
// We chose option A over option B (recall-layer integration) because:
//   1. No changes to recall code are required for *this* phase.
//   2. The recall loader already iterates `.apex/knowledge/` non-recursively
//      across the four type subdirs — so a top-level `.apex/links/<name>/`
//      is NOT picked up by recall today. That's fine: linked entries become
//      visible to `apex search` only after a recall-layer follow-up in
//      Phase 6 (documented in the report). Until then the symlink is a
//      durable, file-system-native record that humans, tooling and
//      future-recall can all consume.

import fs from "node:fs/promises";
import path from "node:path";
import { parse as tomlParse, stringify as tomlStringify } from "smol-toml";

export interface LinkRecord {
  /** Display name (the segment under `.apex/links/<name>`). */
  name: string;
  /** Absolute path to the linked repo (parent of its `.apex/knowledge/`). */
  target: string;
  /** Absolute path to the symlink we created. */
  symlinkPath: string;
  /** ISO timestamp of when the link was created. */
  created: string;
}

export interface LinksManifest {
  links: LinkRecord[];
}

const LINKS_DIR = path.join(".apex", "links");
const MANIFEST_FILE = path.join(".apex", "links.toml");

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
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

/** Compute the default link name from a target path (basename). */
export function defaultLinkName(target: string): string {
  return path.basename(path.resolve(target));
}

export async function loadManifest(root: string): Promise<LinksManifest> {
  const p = path.join(root, MANIFEST_FILE);
  let raw: string;
  try {
    raw = await fs.readFile(p, "utf8");
  } catch {
    return { links: [] };
  }
  let parsed: unknown;
  try {
    parsed = tomlParse(raw);
  } catch {
    return { links: [] };
  }
  if (!parsed || typeof parsed !== "object") return { links: [] };
  const linksRaw = (parsed as { links?: unknown }).links;
  if (!Array.isArray(linksRaw)) return { links: [] };
  const links: LinkRecord[] = [];
  for (const item of linksRaw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (
      typeof r["name"] === "string" &&
      typeof r["target"] === "string" &&
      typeof r["symlinkPath"] === "string" &&
      typeof r["created"] === "string"
    ) {
      links.push({
        name: r["name"],
        target: r["target"],
        symlinkPath: r["symlinkPath"],
        created: r["created"],
      });
    }
  }
  return { links };
}

async function writeManifest(root: string, manifest: LinksManifest): Promise<void> {
  const p = path.join(root, MANIFEST_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  // smol-toml stringifies arrays-of-tables cleanly when given a top-level object.
  // We pass `{ links: [...] }` and rely on its default formatter.
  const out = tomlStringify({ links: manifest.links } as unknown as Record<string, unknown>);
  await fs.writeFile(p, out, "utf8");
}

export interface LinkOptions {
  /** Override the auto-derived link name (default: basename of target). */
  name?: string;
  /**
   * `now()` injection for deterministic tests. Defaults to current ISO time.
   */
  now?: () => string;
}

export class LinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkError";
  }
}

/**
 * Create a symlink at `<root>/.apex/links/<name>` → `<target>/.apex/knowledge/`,
 * and append a record to `.apex/links.toml`.
 *
 * Throws `LinkError` if:
 *   - target does not have `.apex/knowledge/` (refused by spec)
 *   - a link with `name` already exists at `.apex/links/`
 */
export async function linkRepo(
  root: string,
  target: string,
  opts: LinkOptions = {},
): Promise<LinkRecord> {
  const absTarget = path.resolve(target);
  const targetKnowledge = path.join(absTarget, ".apex", "knowledge");
  if (!(await isDir(targetKnowledge))) {
    throw new LinkError(
      `target ${absTarget} has no .apex/knowledge/ directory; refusing to link`,
    );
  }

  const name = opts.name ?? defaultLinkName(absTarget);
  if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new LinkError(`invalid link name: "${name}"`);
  }

  const linksDir = path.join(root, LINKS_DIR);
  await fs.mkdir(linksDir, { recursive: true });
  const symlinkPath = path.join(linksDir, name);
  if (await exists(symlinkPath)) {
    throw new LinkError(`link "${name}" already exists at ${symlinkPath}`);
  }

  // `dir` symlinks are needed on Windows; harmless on POSIX.
  await fs.symlink(targetKnowledge, symlinkPath, "dir");

  const now = (opts.now ?? (() => new Date().toISOString()))();
  const record: LinkRecord = {
    name,
    target: absTarget,
    symlinkPath,
    created: now,
  };

  const manifest = await loadManifest(root);
  // Replace any stale record with the same name (shouldn't happen due to the
  // exists() check above, but defensive: keeps manifest consistent if a user
  // deletes the symlink by hand and re-runs).
  manifest.links = manifest.links.filter((l) => l.name !== name);
  manifest.links.push(record);
  manifest.links.sort((a, b) => a.name.localeCompare(b.name));
  await writeManifest(root, manifest);

  return record;
}

/**
 * Remove a link by name. Removes the symlink (if present) and the manifest
 * entry. Returns `true` if anything was removed.
 *
 * Idempotent: calling unlink for a name that doesn't exist returns `false`
 * but does not throw.
 */
export async function unlinkRepo(root: string, name: string): Promise<boolean> {
  const symlinkPath = path.join(root, LINKS_DIR, name);
  let removedSymlink = false;
  if (await exists(symlinkPath)) {
    await fs.rm(symlinkPath, { force: true });
    removedSymlink = true;
  }
  const manifest = await loadManifest(root);
  const before = manifest.links.length;
  manifest.links = manifest.links.filter((l) => l.name !== name);
  const removedManifest = manifest.links.length !== before;
  if (removedManifest) {
    await writeManifest(root, manifest);
  }
  return removedSymlink || removedManifest;
}

/**
 * List all current links. Reads the manifest as the source of truth, then
 * checks whether each symlink is still valid on disk (so callers can warn
 * about broken links). Manifest-only and symlink-only entries are both
 * surfaced — manifest wins for the canonical record list.
 */
export interface ListedLink extends LinkRecord {
  /** True if the symlink at `symlinkPath` exists. */
  symlinkExists: boolean;
  /** True if the symlink target's `.apex/knowledge/` is a real directory. */
  targetReachable: boolean;
}

export async function listLinks(root: string): Promise<ListedLink[]> {
  const manifest = await loadManifest(root);
  const out: ListedLink[] = [];
  for (const l of manifest.links) {
    const symlinkExists = await exists(l.symlinkPath);
    const targetReachable = await isDir(path.join(l.target, ".apex", "knowledge"));
    out.push({ ...l, symlinkExists, targetReachable });
  }
  return out;
}
