// git.ts — read merged commits from a git repo.
//
// Uses execFile (no shell) to parse `git log` output within a configurable
// window. Accepts an optional `runGit` seam for testing.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "fs-extra";

const execFileAsync = promisify(execFile);
const SPAWN_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 8 * 1024 * 1024;

export interface CommitInfo {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  files: string[];
  prNumber?: number;
}

export interface PrInfo {
  number: number;
  title: string;
  body: string;
  mergeCommitSha?: string;
}

export type RunGitFn = (args: string[], cwd: string) => Promise<string>;

const defaultRunGit: RunGitFn = async (args: string[], cwd: string): Promise<string> => {
  const result = await execFileAsync("git", args, {
    cwd,
    timeout: SPAWN_TIMEOUT_MS,
    shell: false,
    maxBuffer: MAX_BUFFER,
  });
  return result.stdout;
};

export interface GitReaderOpts {
  since?: string;
  limit?: number;
  runGit?: RunGitFn;
}

const RECORD_SEP = "\x1e"; // ASCII Record Separator — safe delimiter inside commits
const FIELD_SEP = "\x1f"; // ASCII Unit Separator — safe field delimiter

/**
 * Read commits from the repository in [since..HEAD] range.
 * Falls back to all commits if since is not resolvable.
 */
export async function readCommits(
  root: string,
  opts: GitReaderOpts = {},
): Promise<{ commits: CommitInfo[]; available: boolean; reason?: string }> {
  const gitDir = path.join(root, ".git");
  if (!(await fs.pathExists(gitDir))) {
    return { commits: [], available: false, reason: "not a git repo" };
  }

  const run = opts.runGit ?? defaultRunGit;
  const limit = opts.limit ?? 50;
  const since = opts.since ?? `HEAD~${limit}`;

  // Build the git log format with safe separators:
  // sha, short sha, author name, date, subject, body
  const format = `${RECORD_SEP}%H${FIELD_SEP}%h${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${FIELD_SEP}%b`;

  let logOutput: string;
  try {
    // Attempt with the given since ref
    logOutput = await run(
      ["log", `--pretty=format:${format}`, "--name-only", `${since}..HEAD`, `--max-count=${limit}`],
      root,
    );
  } catch {
    // since ref might not exist (shallow clone, first run, etc.) — fall back to limit
    try {
      logOutput = await run(
        ["log", `--pretty=format:${format}`, "--name-only", `--max-count=${limit}`],
        root,
      );
    } catch (e) {
      return {
        commits: [],
        available: false,
        reason: `git log failed: ${(e as Error).message.slice(0, 120)}`,
      };
    }
  }

  const commits = parseGitLogOutput(logOutput);
  return { commits, available: true };
}

/**
 * Fetch merged PR metadata via `gh` CLI.
 * Returns empty array (gracefully) if gh is not on PATH or unauthenticated.
 */
export async function readMergedPrs(
  root: string,
  opts: { limit?: number; runGit?: RunGitFn } = {},
): Promise<PrInfo[]> {
  const run = opts.runGit ?? defaultRunGit;
  const limit = opts.limit ?? 50;

  // Check if gh is on PATH
  try {
    await execFileAsync("gh", ["--version"], { timeout: 5_000, shell: false });
  } catch {
    return [];
  }

  try {
    const result = await execFileAsync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "merged",
        "--json",
        "number,title,body,mergeCommit",
        "--limit",
        String(limit),
      ],
      { cwd: root, timeout: SPAWN_TIMEOUT_MS, shell: false, maxBuffer: MAX_BUFFER },
    );
    const parsed = JSON.parse(result.stdout) as Array<{
      number: number;
      title: string;
      body: string;
      mergeCommit?: { oid?: string };
    }>;
    return parsed.map((p) => ({
      number: p.number,
      title: (p.title ?? "").slice(0, 200),
      body: (p.body ?? "").slice(0, 2000),
      mergeCommitSha: p.mergeCommit?.oid,
    }));
  } catch {
    // Fail gracefully — unauthenticated, no remote, etc.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internal parser
// ---------------------------------------------------------------------------

function parseGitLogOutput(raw: string): CommitInfo[] {
  if (!raw.trim()) return [];

  // Records are delimited by RECORD_SEP; split and parse each.
  const rawRecords = raw.split(RECORD_SEP).filter((r) => r.trim().length > 0);
  const commits: CommitInfo[] = [];

  for (const record of rawRecords) {
    // The record starts with the header fields (FIELD_SEP separated), followed
    // by a newline, then changed file paths (one per line).
    const newlineIdx = record.indexOf("\n");
    let header: string;
    let filesPart: string;
    if (newlineIdx === -1) {
      header = record;
      filesPart = "";
    } else {
      header = record.slice(0, newlineIdx);
      filesPart = record.slice(newlineIdx + 1);
    }

    const parts = header.split(FIELD_SEP);
    if (parts.length < 5) continue;

    const sha = (parts[0] ?? "").trim();
    const shortSha = (parts[1] ?? "").trim();
    const author = (parts[2] ?? "").trim();
    const date = (parts[3] ?? "").trim();
    const subject = (parts[4] ?? "").trim();
    const body = (parts[5] ?? "").trim();

    if (!sha || !subject) continue;

    // Parse file list — blank lines and git stat lines can appear; keep only
    // lines that look like file paths (no leading spaces, not a summary line).
    const files = filesPart
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) =>
          l.length > 0 &&
          !l.startsWith("diff") &&
          !l.startsWith("index") &&
          !l.startsWith("---") &&
          !l.startsWith("+++") &&
          !l.startsWith("@@") &&
          !/^\d+\s+files?\s+changed/.test(l),
      );

    // Extract PR number from subject or body (e.g. "(#123)" or "Merge pull request #123")
    const prMatch =
      /\(#(\d+)\)/.exec(subject) ??
      /Merge pull request #(\d+)/.exec(subject) ??
      /\(#(\d+)\)/.exec(body);
    const prNumber = prMatch ? parseInt(prMatch[1]!, 10) : undefined;

    commits.push({ sha, shortSha, subject, body, author, date, files, prNumber });
  }

  return commits;
}
