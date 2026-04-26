/**
 * bundle.ts — pack/unpack .apex/knowledge/ + .apex/proposed/ into a
 * self-describing JSON+gzip blob.
 *
 * Wire format:
 *   {
 *     "version": 1,
 *     "created": "<iso>",
 *     "files": [{ "path": "knowledge/decisions/foo.md", "content_base64": "..." }, ...]
 *   }
 *
 * Compressed with node:zlib.gzip (default level).
 * No external dependencies — stdlib only.
 */

import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { promisify } from "node:util";
import { projectPaths } from "../util/paths.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface BundleFile {
  /** Relative path, e.g. "knowledge/decisions/foo.md" */
  path: string;
  content_base64: string;
}

export interface BundleManifest {
  version: 1;
  created: string;
  files: BundleFile[];
}

export interface PackOptions {
  /** Include .apex/proposed/ in addition to .apex/knowledge/ */
  includeProposed?: boolean;
}

/**
 * Collect files under a directory recursively.
 * Returns [relPath, absolutePath] pairs relative to `baseDir`.
 */
async function collectFiles(
  dir: string,
  relPrefix: string,
): Promise<Array<{ rel: string; abs: string }>> {
  const results: Array<{ rel: string; abs: string }> = [];

  let entries: import("node:fs").Dirent[];
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as unknown as import("node:fs").Dirent[];
  } catch {
    // Directory doesn't exist — return empty
    return results;
  }

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      const children = await collectFiles(abs, rel);
      results.push(...children);
    } else if (entry.isFile()) {
      results.push({ rel, abs });
    }
  }

  return results;
}

/**
 * Pack .apex/knowledge/ (and optionally .apex/proposed/) into a gzipped JSON
 * bundle. Returns the compressed Buffer.
 */
export async function pack(root: string, opts: PackOptions = {}): Promise<Buffer> {
  const paths = projectPaths(root);
  const files: BundleFile[] = [];

  // Always include knowledge/
  const knowledgeFiles = await collectFiles(paths.knowledgeDir, "knowledge");
  for (const { rel, abs } of knowledgeFiles) {
    const content = await fs.readFile(abs);
    files.push({ path: rel, content_base64: content.toString("base64") });
  }

  // Optionally include proposed/
  if (opts.includeProposed) {
    const proposedFiles = await collectFiles(paths.proposedDir, "proposed");
    for (const { rel, abs } of proposedFiles) {
      const content = await fs.readFile(abs);
      files.push({ path: rel, content_base64: content.toString("base64") });
    }
  }

  const manifest: BundleManifest = {
    version: 1,
    created: new Date().toISOString(),
    files,
  };

  const json = JSON.stringify(manifest);
  return gzip(Buffer.from(json, "utf8"));
}

/**
 * Unpack a gzipped JSON bundle and return the manifest.
 * Throws on corrupt/invalid data.
 */
export async function unpack(data: Buffer): Promise<BundleManifest> {
  let jsonBuf: Buffer;
  try {
    jsonBuf = await gunzip(data);
  } catch (err) {
    throw new Error(`bundle decompression failed: ${(err as Error).message}`);
  }

  let manifest: unknown;
  try {
    manifest = JSON.parse(jsonBuf.toString("utf8"));
  } catch (err) {
    throw new Error(`bundle JSON parse failed: ${(err as Error).message}`);
  }

  if (!isManifest(manifest)) {
    throw new Error("bundle manifest has unexpected structure");
  }

  return manifest;
}

function isManifest(v: unknown): v is BundleManifest {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  if (m["version"] !== 1) return false;
  if (typeof m["created"] !== "string") return false;
  if (!Array.isArray(m["files"])) return false;
  for (const f of m["files"] as unknown[]) {
    if (typeof f !== "object" || f === null) return false;
    const file = f as Record<string, unknown>;
    if (typeof file["path"] !== "string") return false;
    if (typeof file["content_base64"] !== "string") return false;
  }
  return true;
}
