import { detect } from "../detect/index.js";
import {
  ciSignal,
  gitLogSignal,
  openPrsSignal,
  readmeSignal,
  testRunnerSignal,
  topImportsSignal,
  type Signal,
} from "./signals.js";
import { pendingStackBody, proposeDrafts } from "./proposer.js";
import { writeProposals } from "./writer.js";

export interface ArchaeologistReport {
  proposalsWritten: string[];
  proposalsSkipped: Array<{ path: string; reason: string }>;
  signalCount: number;
  signalsSkipped: Array<{ kind: string; reason: string }>;
  draftCount: number;
}

export interface ArchaeologistOpts {
  dryRun?: boolean;
  skipGit?: boolean;
}

export async function runArchaeologist(
  root: string,
  opts: ArchaeologistOpts = {},
): Promise<ArchaeologistReport> {
  const detection = await detect(root);
  const signals: Signal[] = [];
  const skipped: Array<{ kind: string; reason: string }> = [];

  const gl = opts.skipGit
    ? null
    : await gitLogSignal(root).catch((e) => ({
        kind: "git-log" as const,
        available: false,
        reason: `error: ${(e as Error).message.slice(0, 120)}`,
        commitCount: 0,
        topAuthors: [],
        topKeywords: [],
        conventionalPrefixes: [],
        recentCommits: [],
      }));
  if (gl) {
    signals.push(gl);
    if (!gl.available) skipped.push({ kind: gl.kind, reason: gl.reason ?? "unavailable" });
  } else {
    skipped.push({ kind: "git-log", reason: "skipped via --skip-git" });
  }

  const rs = await readmeSignal(root);
  signals.push(rs);
  if (!rs.available) skipped.push({ kind: rs.kind, reason: rs.reason ?? "unavailable" });

  const ti = await topImportsSignal(root, detection);
  signals.push(ti);
  if (!ti.available) skipped.push({ kind: ti.kind, reason: ti.reason ?? "unavailable" });

  const ts = await testRunnerSignal(root, detection);
  signals.push(ts);
  if (!ts.available) skipped.push({ kind: ts.kind, reason: ts.reason ?? "unavailable" });

  const prs = await openPrsSignal(root);
  signals.push(prs);
  if (!prs.available) skipped.push({ kind: prs.kind, reason: prs.reason ?? "unavailable" });

  const ci = await ciSignal(root);
  signals.push(ci);
  if (!ci.available) skipped.push({ kind: ci.kind, reason: ci.reason ?? "unavailable" });

  const drafts = proposeDrafts(signals, detection);
  const stackBody = pendingStackBody(detection, signals);
  const writeResult = await writeProposals(root, drafts, stackBody, {
    dryRun: opts.dryRun,
  });

  return {
    proposalsWritten: writeResult.written,
    proposalsSkipped: writeResult.skipped,
    signalCount: signals.filter((s) => s.available).length,
    signalsSkipped: skipped,
    draftCount: drafts.length,
  };
}
