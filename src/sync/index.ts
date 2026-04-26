/**
 * sync/index.ts — Orchestrator for encrypted bundle export and import.
 *
 * exportBundle: packs .apex/knowledge/ (+ optionally .apex/proposed/) into
 *   a gzipped JSON blob, encrypts it, and writes it to a file.
 *
 * importBundle: reads the file, decrypts, unpacks, and writes files into
 *   .apex/proposed/ only (never directly into .apex/knowledge/).
 *
 * Imports are idempotent: if a proposed file already exists, it writes
 *   <basename>.from-bundle.<ts>.md instead of overwriting.
 *
 * The passphrase is read from an environment variable (never from CLI args).
 * Default env var: APEX_BUNDLE_PASSPHRASE.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pack, unpack } from "./bundle.js";
import { encrypt, decrypt } from "./encrypt.js";
import { projectPaths } from "../util/paths.js";

// ---- Types ----

export interface ExportOptions {
  /** Output file path */
  out: string;
  /** Name of env var containing the passphrase (default: APEX_BUNDLE_PASSPHRASE) */
  passphraseEnv?: string;
  /** Also bundle .apex/proposed/ */
  includeProposed?: boolean;
  /** Project root (default: process.cwd()) */
  cwd?: string;
}

export interface ExportReport {
  outPath: string;
  fileCount: number;
  /** ISO timestamp of when the bundle was created */
  created: string;
}

export interface ImportOptions {
  /** Input file path */
  in: string;
  /** Name of env var containing the passphrase (default: APEX_BUNDLE_PASSPHRASE) */
  passphraseEnv?: string;
  /** Print what would be done but do not write files */
  dryRun?: boolean;
  /** Project root (default: process.cwd()) */
  cwd?: string;
}

export type ImportAction = "written" | "renamed" | "dry-run";

export interface ImportedFile {
  /** Relative path inside the bundle (e.g. "knowledge/decisions/foo.md") */
  bundlePath: string;
  /** Absolute path written on disk */
  writtenPath: string;
  action: ImportAction;
}

export interface ImportReport {
  fileCount: number;
  files: ImportedFile[];
  created: string;
}

// ---- Helpers ----

const DEFAULT_ENV_VAR = "APEX_BUNDLE_PASSPHRASE";

function readPassphrase(envVar: string): string {
  const passphrase = process.env[envVar];
  if (!passphrase) {
    throw new Error(
      `Passphrase env var ${envVar} is empty or not set. ` +
        `Set it before running: export ${envVar}=<your-passphrase>`,
    );
  }
  return passphrase;
}

// ---- Export ----

/**
 * Pack and encrypt .apex/knowledge/ (and optionally .apex/proposed/) into an
 * encrypted bundle file.
 */
export async function exportBundle(
  root: string,
  opts: ExportOptions,
): Promise<ExportReport> {
  const envVar = opts.passphraseEnv ?? DEFAULT_ENV_VAR;
  const passphrase = readPassphrase(envVar);

  // Pack
  const packed = await pack(root, { includeProposed: opts.includeProposed ?? false });

  // Encrypt
  const encrypted = await encrypt(packed, passphrase);

  // Write
  const outPath = path.resolve(opts.cwd ?? root, opts.out);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, encrypted);

  // Unpack just to get metadata (no passphrase involved, just reading manifest)
  const manifest = await unpack(packed);

  return {
    outPath,
    fileCount: manifest.files.length,
    created: manifest.created,
  };
}

// ---- Import ----

/**
 * Decrypt and unpack an encrypted bundle file, writing all files to
 * .apex/proposed/ for user review.
 */
export async function importBundle(
  root: string,
  opts: ImportOptions,
): Promise<ImportReport> {
  const envVar = opts.passphraseEnv ?? DEFAULT_ENV_VAR;
  const passphrase = readPassphrase(envVar);

  // Read
  const inPath = path.resolve(opts.cwd ?? root, opts.in);
  let rawData: Buffer;
  try {
    rawData = await fs.readFile(inPath);
  } catch (err) {
    throw new Error(`could not read bundle file ${inPath}: ${(err as Error).message}`);
  }

  // Decrypt
  let packed: Buffer;
  try {
    packed = await decrypt(rawData, passphrase);
  } catch (err) {
    throw new Error((err as Error).message);
  }

  // Unpack
  const manifest = await unpack(packed);

  const paths = projectPaths(root);
  const proposedDir = paths.proposedDir;

  if (!opts.dryRun) {
    await fs.mkdir(proposedDir, { recursive: true });
  }

  const importedFiles: ImportedFile[] = [];

  for (const bundleFile of manifest.files) {
    const content = Buffer.from(bundleFile.content_base64, "base64");

    // All files land in .apex/proposed/ regardless of their original location.
    // Strip any leading directory segments to get the filename.
    const basename = path.basename(bundleFile.path);

    // Determine the target path, handling idempotency.
    const targetPath = path.join(proposedDir, basename);
    let finalPath = targetPath;
    let action: ImportAction = "written";

    if (!opts.dryRun) {
      let exists = false;
      try {
        await fs.access(targetPath);
        exists = true;
      } catch {
        // file does not exist — write it as-is
      }

      if (exists) {
        // Idempotent: rename to <stem>.from-bundle.<ts>.md
        const ts = Date.now();
        const ext = path.extname(basename);
        const stem = basename.slice(0, basename.length - ext.length);
        finalPath = path.join(proposedDir, `${stem}.from-bundle.${ts}${ext}`);
        action = "renamed";
      }

      await fs.writeFile(finalPath, content);
    } else {
      action = "dry-run";
    }

    importedFiles.push({
      bundlePath: bundleFile.path,
      writtenPath: finalPath,
      action,
    });
  }

  return {
    fileCount: manifest.files.length,
    files: importedFiles,
    created: manifest.created,
  };
}
