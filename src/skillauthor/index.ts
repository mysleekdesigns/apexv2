// Skill auto-author orchestrator.
//
// Reads episode tool sequences, detects repeated n-gram patterns, proposes
// SKILL.md drafts and writes them to .apex/proposed-skills/<slug>/SKILL.md.

import path from "node:path";
import fs from "fs-extra";
import { listRecentEpisodes } from "../reflector/signals.js";
import { detectPatterns } from "./patterns.js";
import { proposeSkillDrafts } from "./proposer.js";
import { writeSkillDrafts } from "./writer.js";
import type { EpisodeToolSequence } from "./patterns.js";
import type { SkillWriteResult } from "./writer.js";

export interface SkillAuthorOpts {
  /** Minimum occurrences to qualify a pattern. Default: 3 */
  threshold?: number;
  /** Maximum number of skill drafts to produce per run. Default: 10 */
  limit?: number;
  /** How many recent episodes to scan. Default: 50 */
  episodes?: number;
  /** If true, detect + draft but do not write files. */
  dryRun?: boolean;
}

export interface SkillAuthorReport {
  patternsDetected: number;
  drafted: number;
  written: string[];
  skipped: Array<{ slug: string; reason: string }>;
}

async function readJsonlSafe<T>(file: string): Promise<T[]> {
  if (!(await fs.pathExists(file))) return [];
  const text = await fs.readFile(file, "utf8");
  const results: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed) as T);
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

async function loadEpisodeToolSequence(
  root: string,
  episodeId: string,
): Promise<EpisodeToolSequence | null> {
  const toolsFile = path.join(root, ".apex", "episodes", episodeId, "tools.jsonl");
  type RawTool = { tool_name?: string; turn?: number };
  const lines = await readJsonlSafe<RawTool>(toolsFile);

  if (lines.length === 0) return null;

  const tools: string[] = [];
  const turns: number[] = [];

  for (const line of lines) {
    if (typeof line.tool_name === "string" && line.tool_name.length > 0) {
      tools.push(line.tool_name);
      turns.push(typeof line.turn === "number" ? line.turn : tools.length - 1);
    }
  }

  if (tools.length === 0) return null;

  return { episodeId, tools, turns };
}

export async function runSkillAuthor(
  root: string,
  opts: SkillAuthorOpts = {},
): Promise<SkillAuthorReport> {
  const threshold = opts.threshold ?? 3;
  const limit = opts.limit ?? 10;
  const episodesLimit = opts.episodes ?? 50;

  const report: SkillAuthorReport = {
    patternsDetected: 0,
    drafted: 0,
    written: [],
    skipped: [],
  };

  // List recent episodes
  const episodeIds = await listRecentEpisodes(root, episodesLimit);
  if (episodeIds.length === 0) return report;

  // Load tool sequences
  const sequences: EpisodeToolSequence[] = [];
  for (const id of episodeIds) {
    const seq = await loadEpisodeToolSequence(root, id);
    if (seq) sequences.push(seq);
  }

  if (sequences.length === 0) return report;

  // Detect patterns
  const patterns = detectPatterns(sequences, { threshold, limit });
  report.patternsDetected = patterns.length;

  if (patterns.length === 0) return report;

  // Propose skill drafts
  const drafts = proposeSkillDrafts(patterns);
  report.drafted = drafts.length;

  if (drafts.length === 0) return report;

  // Write drafts
  const writeResult: SkillWriteResult = await writeSkillDrafts(root, drafts, {
    dryRun: opts.dryRun,
  });

  report.written = writeResult.written;
  report.skipped = writeResult.skipped;

  return report;
}
