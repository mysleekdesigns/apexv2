import path from "node:path";
import fs from "node:fs";
import { projectPaths } from "../util/paths.js";
import type {
  DashboardCounts,
  DashboardOptions,
  DashboardResult,
} from "./types.js";

export type { DashboardCounts, DashboardOptions, DashboardResult } from "./types.js";

interface EpisodeMetaPartial {
  started_at?: string;
  ended_at?: string | null;
}

interface RetrievalRow {
  entry_id?: string;
  referenced?: boolean | null;
}

interface CorrectionRow {
  kind?: string;
  target_entry_id?: string | null;
}

function readJsonlLines<T>(file: string): T[] {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, "utf8");
  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      // skip malformed lines — episodes are append-only and tolerated by readers
    }
  }
  return out;
}

function readMeta(dir: string): EpisodeMetaPartial | null {
  const file = path.join(dir, "meta.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as EpisodeMetaPartial;
  } catch {
    return null;
  }
}

function isEpisodeDir(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]+$/.test(name);
}

export function computeDashboard(
  root: string,
  opts: DashboardOptions = {},
): DashboardResult {
  const windowDays = Math.max(1, opts.windowDays ?? 7);
  const paths = projectPaths(root);
  const cutoff = Date.now() - windowDays * 86_400_000;

  const used = new Set<string>();
  const helpful = new Set<string>();
  const corrected = new Set<string>();
  let episodesScanned = 0;

  if (!fs.existsSync(paths.episodesDir)) {
    return finish({ windowDays, episodesScanned, used, helpful, corrected });
  }

  const entries = fs.readdirSync(paths.episodesDir);
  for (const name of entries) {
    if (!isEpisodeDir(name)) continue;
    const dir = path.join(paths.episodesDir, name);
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) continue;

    const meta = readMeta(dir);
    const startedMs = meta?.started_at
      ? Date.parse(meta.started_at)
      : stat.mtimeMs;
    if (!Number.isFinite(startedMs) || startedMs < cutoff) continue;

    episodesScanned += 1;

    const retrievals = readJsonlLines<RetrievalRow>(
      path.join(dir, "retrievals.jsonl"),
    );
    for (const r of retrievals) {
      if (!r.entry_id) continue;
      used.add(r.entry_id);
      if (r.referenced === true) helpful.add(r.entry_id);
    }

    const corrections = readJsonlLines<CorrectionRow>(
      path.join(dir, "corrections.jsonl"),
    );
    for (const c of corrections) {
      if (!c.target_entry_id) continue;
      if (c.kind === "thumbs_up") helpful.add(c.target_entry_id);
      else if (c.kind === "thumbs_down") corrected.add(c.target_entry_id);
    }
  }

  return finish({ windowDays, episodesScanned, used, helpful, corrected });
}

function finish(input: {
  windowDays: number;
  episodesScanned: number;
  used: Set<string>;
  helpful: Set<string>;
  corrected: Set<string>;
}): DashboardResult {
  const helpful = new Set([...input.helpful].filter((id) => input.used.has(id)));
  const corrected = new Set(
    [...input.corrected].filter((id) => input.used.has(id) && !helpful.has(id)),
  );
  const counts: DashboardCounts = {
    used: input.used.size,
    helpful: helpful.size,
    corrected: corrected.size,
    unused: Math.max(0, input.used.size - helpful.size - corrected.size),
  };
  const window = input.windowDays === 7 ? "last week" : `last ${input.windowDays} days`;
  const line =
    counts.used === 0
      ? `APEX: 0 entries used ${window}`
      : `APEX: ${counts.used} entries used ${window} (${counts.helpful} helpful, ${counts.corrected} corrected, ${counts.unused} unused)`;
  return {
    ...counts,
    windowDays: input.windowDays,
    episodesScanned: input.episodesScanned,
    line,
  };
}
