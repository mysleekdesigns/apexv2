// Pack applier: writes pack entries into `.apex/proposed/` so the existing
// promote pipeline gates them. Never writes directly to `.apex/knowledge/`.
//
// Mirrors src/archaeologist/writer.ts behavior:
//   - prepends a `<!-- PROPOSED — review before moving -->` header
//   - skips files that already exist (idempotent)
//   - supports --dry-run
//
// On top of that, this applier:
//   - stamps `created` and `last_validated` to today's date
//   - replaces `sources` with `[{ kind: bootstrap, ref: "pack:<id>@<version>" }]`
//     (preserving any pack-author-provided notes/refs as additional sources)
//   - skips proposals whose id already exists in `.apex/knowledge/<type>/`

import path from "node:path";
import fs from "fs-extra";
import yaml from "yaml";
import { projectPaths } from "../util/paths.js";
import { loadPack, type LoadPackOptions } from "./loader.js";
import type { Pack, PackEntry } from "./types.js";
import type { KnowledgeFrontmatter, KnowledgeSource } from "../types/shared.js";

export const PROPOSED_HEADER =
  "<!-- PROPOSED — review before moving to .apex/knowledge/ -->";

export interface ApplyPackOptions {
  /** Do not write to disk; report what would be written. */
  dryRun?: boolean;
  /** Override packs root used by the loader (templates dir or packs dir). */
  packsRoot?: string;
  /** ISO date (YYYY-MM-DD) override; defaults to today (UTC). */
  today?: string;
}

export interface AppliedEntry {
  /** Pack-entry id. */
  id: string;
  /** Pack-entry type. */
  type: KnowledgeFrontmatter["type"];
  /** Absolute target path under `.apex/proposed/`. */
  targetPath: string;
}

export interface SkippedEntry {
  id: string;
  type: KnowledgeFrontmatter["type"];
  targetPath: string;
  reason: string;
}

export interface ApplyPackResult {
  pack: { id: string; version: string; title: string; stack: string };
  written: AppliedEntry[];
  skipped: SkippedEntry[];
  dryRun: boolean;
  proposedDir: string;
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Build the rewritten frontmatter for a pack entry: stamp dates, attach
 * the bootstrap pack source, and preserve everything else verbatim.
 */
export function rewriteEntryFrontmatter(
  entry: PackEntry,
  pack: Pick<Pack, "manifest">,
  today: string,
): KnowledgeFrontmatter & Record<string, unknown> {
  const original = entry.frontmatter;
  const packSource: KnowledgeSource = {
    kind: "bootstrap",
    ref: `pack:${pack.manifest.id}@${pack.manifest.version}`,
  };

  // Keep original sources after the pack source, drop ones that exactly
  // duplicate the pack ref.
  const originalSources = (original.sources ?? []).filter(
    (s) => !(s.kind === "bootstrap" && s.ref === packSource.ref),
  );

  return {
    ...original,
    created: today,
    last_validated: today,
    sources: [packSource, ...originalSources],
  };
}

/**
 * Serialize a frontmatter+body pair into a `.md` file body with the
 * PROPOSED header, mirroring src/archaeologist/writer.ts:serialize().
 */
export function serializeProposal(
  fm: KnowledgeFrontmatter & Record<string, unknown>,
  body: string,
): string {
  const fmYaml = yaml
    .stringify(fm, {
      lineWidth: 0,
      defaultStringType: "QUOTE_DOUBLE",
      defaultKeyType: "PLAIN",
    })
    .trimEnd();
  return `${PROPOSED_HEADER}\n---\n${fmYaml}\n---\n\n${body.trim()}\n`;
}

/**
 * True if a knowledge file with this id already lives under
 * `.apex/knowledge/<type>s/<id>.md`. The directory naming convention
 * pluralises the type — see specs/knowledge-schema.md §"File path convention".
 */
async function knowledgeEntryExists(
  knowledgeDir: string,
  type: KnowledgeFrontmatter["type"],
  id: string,
): Promise<string | null> {
  const dir = path.join(knowledgeDir, `${type}s`);
  const target = path.join(dir, `${id}.md`);
  if (await fs.pathExists(target)) return target;
  return null;
}

/**
 * Apply a pack: copy each entry into `.apex/proposed/<id>.md` with the
 * PROPOSED header, today's dates, and an injected pack source. Idempotent.
 */
export async function applyPack(
  root: string,
  packId: string,
  opts: ApplyPackOptions = {},
): Promise<ApplyPackResult> {
  const loadOpts: LoadPackOptions = {};
  if (opts.packsRoot !== undefined) loadOpts.rootOrTemplatesDir = opts.packsRoot;
  const pack = await loadPack(packId, loadOpts);
  const paths = projectPaths(root);
  const today = opts.today ?? todayUtc();
  const dryRun = Boolean(opts.dryRun);

  const result: ApplyPackResult = {
    pack: {
      id: pack.manifest.id,
      version: pack.manifest.version,
      title: pack.manifest.title,
      stack: pack.manifest.stack,
    },
    written: [],
    skipped: [],
    dryRun,
    proposedDir: paths.proposedDir,
  };

  if (!dryRun) {
    await fs.ensureDir(paths.proposedDir);
  }

  for (const entry of pack.entries) {
    const id = entry.frontmatter.id;
    const type = entry.frontmatter.type;
    const targetPath = path.join(paths.proposedDir, `${id}.md`);

    // Idempotency: skip if proposal or knowledge entry already exists.
    if (await fs.pathExists(targetPath)) {
      result.skipped.push({
        id,
        type,
        targetPath,
        reason: "already exists in .apex/proposed/",
      });
      continue;
    }
    const knowledgeMatch = await knowledgeEntryExists(paths.knowledgeDir, type, id);
    if (knowledgeMatch) {
      result.skipped.push({
        id,
        type,
        targetPath: knowledgeMatch,
        reason: "already exists in .apex/knowledge/",
      });
      continue;
    }

    const fm = rewriteEntryFrontmatter(entry, pack, today);
    const content = serializeProposal(fm, entry.body);

    if (dryRun) {
      result.written.push({ id, type, targetPath });
      continue;
    }

    await fs.writeFile(targetPath, content, "utf8");
    result.written.push({ id, type, targetPath });
  }

  return result;
}
