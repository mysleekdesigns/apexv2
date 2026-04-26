// Reflector orchestrator.
//
// Reads recent episode files, runs heuristic detection for repeated failures
// and corrections, writes proposals to .apex/proposed/, and updates each
// episode's meta.json with reflection.status = "complete".

import path from "node:path";
import fs from "fs-extra";
import { readEpisodeSignals, listRecentEpisodes } from "./signals.js";
import { proposeFromEpisodes } from "./proposer.js";
import { writeReflectionProposals } from "./writer.js";
import { markEpisodeReflected } from "./metaUpdate.js";
import { projectPaths } from "../util/paths.js";
import type { EpisodeSignals } from "./signals.js";

export interface ReflectorReport {
  proposalsWritten: string[];
  proposalsSkipped: Array<{ path: string; reason: string }>;
  episodesProcessed: string[];
  episodesSkipped: Array<{ id: string; reason: string }>;
  gotchaCandidates: number;
  conventionCandidates: number;
}

export interface ReflectorOpts {
  dryRun?: boolean;
  /** Process only this episode id. */
  episode?: string;
  /** Process all episodes without completed reflection. Default: false (only recent). */
  all?: boolean;
  /** How many recent episodes to scan when not using --all or --episode. Default: 20. */
  limit?: number;
}

async function collectExistingKnowledgeIds(root: string): Promise<Set<string>> {
  const knowledgeDir = path.join(root, ".apex", "knowledge");
  const ids = new Set<string>();
  const subdirs = ["gotchas", "conventions", "patterns", "decisions"];
  for (const sub of subdirs) {
    const dir = path.join(knowledgeDir, sub);
    if (!(await fs.pathExists(dir))) continue;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (f.endsWith(".md") && !f.startsWith("_")) {
        ids.add(f.slice(0, -3));
      }
    }
  }
  return ids;
}

export async function runReflector(
  root: string,
  opts: ReflectorOpts = {},
): Promise<ReflectorReport> {
  const report: ReflectorReport = {
    proposalsWritten: [],
    proposalsSkipped: [],
    episodesProcessed: [],
    episodesSkipped: [],
    gotchaCandidates: 0,
    conventionCandidates: 0,
  };

  // Determine which episodes to process
  let episodeIds: string[];
  if (opts.episode) {
    episodeIds = [opts.episode];
  } else if (opts.all) {
    episodeIds = await listRecentEpisodes(root, 1000);
  } else {
    episodeIds = await listRecentEpisodes(root, opts.limit ?? 20);
  }

  if (episodeIds.length === 0) return report;

  // Filter to episodes without completed reflection (unless specific episode requested)
  if (!opts.episode) {
    const filtered: string[] = [];
    for (const id of episodeIds) {
      const metaFile = path.join(root, ".apex", "episodes", id, "meta.json");
      if (!(await fs.pathExists(metaFile))) {
        report.episodesSkipped.push({ id, reason: "meta.json missing" });
        continue;
      }
      try {
        const meta = JSON.parse(await fs.readFile(metaFile, "utf8")) as {
          reflection?: { status?: string };
        };
        if (meta.reflection?.status === "complete") {
          report.episodesSkipped.push({ id, reason: "reflection already complete" });
          continue;
        }
      } catch {
        report.episodesSkipped.push({ id, reason: "meta.json unreadable" });
        continue;
      }
      filtered.push(id);
    }
    episodeIds = filtered;
  }

  if (episodeIds.length === 0) return report;

  // Load all signals
  const signalsList: EpisodeSignals[] = [];
  for (const id of episodeIds) {
    try {
      const signals = await readEpisodeSignals(root, id);
      signalsList.push(signals);
      report.episodesProcessed.push(id);
    } catch (e) {
      report.episodesSkipped.push({
        id,
        reason: `read error: ${(e as Error).message.slice(0, 120)}`,
      });
    }
  }

  if (signalsList.length === 0) return report;

  const existingKnowledgeIds = await collectExistingKnowledgeIds(root);

  const drafts = proposeFromEpisodes(signalsList, existingKnowledgeIds);

  // Tally candidates by type for the report
  for (const d of drafts) {
    if (d.frontmatter.type === "gotcha") report.gotchaCandidates++;
    if (d.frontmatter.type === "convention") report.conventionCandidates++;
  }

  const writeResult = await writeReflectionProposals(root, drafts, { dryRun: opts.dryRun });
  report.proposalsWritten = writeResult.written;
  report.proposalsSkipped = writeResult.skipped;

  // Mark each processed episode as reflected
  if (!opts.dryRun) {
    const proposedIds = writeResult.written.map((p) =>
      path.basename(p, ".md"),
    );
    for (const id of report.episodesProcessed) {
      try {
        await markEpisodeReflected(root, id, proposedIds);
      } catch {
        // Non-fatal: meta update failure shouldn't abort the run
      }
    }
  }

  return report;
}
