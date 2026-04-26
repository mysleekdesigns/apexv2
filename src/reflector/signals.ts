// Episode reader for the reflector.
//
// Reads the JSONL files produced by src/episode/writer.ts from
// .apex/episodes/<id>/ and returns typed signal arrays.
// Files are already redacted on write; we trust the on-disk format.

import path from "node:path";
import fs from "fs-extra";
import type { EpisodeMeta } from "../types/shared.js";
import type { FailureLine, CorrectionLine, ToolLine } from "../episode/writer.js";
import { isEpisodeId } from "../episode/id.js";

export type { FailureLine, CorrectionLine, ToolLine };

export interface EpisodeSignals {
  episodeId: string;
  failures: FailureLine[];
  corrections: CorrectionLine[];
  tools: ToolLine[];
  meta: EpisodeMeta;
}

function episodeDir(root: string, episodeId: string): string {
  return path.join(root, ".apex", "episodes", episodeId);
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

export async function readEpisodeSignals(
  root: string,
  episodeId: string,
): Promise<EpisodeSignals> {
  const dir = episodeDir(root, episodeId);
  const metaFile = path.join(dir, "meta.json");
  const meta = JSON.parse(await fs.readFile(metaFile, "utf8")) as EpisodeMeta;

  const [failures, corrections, tools] = await Promise.all([
    readJsonlSafe<FailureLine>(path.join(dir, "failures.jsonl")),
    readJsonlSafe<CorrectionLine>(path.join(dir, "corrections.jsonl")),
    readJsonlSafe<ToolLine>(path.join(dir, "tools.jsonl")),
  ]);

  return { episodeId, failures, corrections, tools, meta };
}

export async function listRecentEpisodes(root: string, limit = 50): Promise<string[]> {
  const episodesDir = path.join(root, ".apex", "episodes");
  if (!(await fs.pathExists(episodesDir))) return [];

  const entries = await fs.readdir(episodesDir);
  return entries
    .filter((e) => isEpisodeId(e))
    .sort()
    .reverse()
    .slice(0, limit);
}
