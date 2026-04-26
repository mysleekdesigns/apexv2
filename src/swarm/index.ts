/**
 * index.ts — orchestrator for the multi-agent swarm.
 *
 * runSwarmReflect(root, opts) discovers worktrees from `root`, then
 * fans out `apex reflect --all` per worktree with bounded parallelism.
 *
 * Recursion guard: if APEX_IN_SWARM=1 is set, throws immediately.
 */

import { discoverWorktrees } from "./discover.js";
import { runSwarmWorktrees } from "./runner.js";
import type { RunnerOptions, WorktreeResult } from "./runner.js";
import type { WorktreeInfo } from "./discover.js";

export type { WorktreeResult } from "./runner.js";
export type { WorktreeInfo } from "./discover.js";

export interface SwarmError {
  path: string;
  message: string;
}

export interface SwarmReflectResult {
  worktrees: WorktreeResult[];
  errors: SwarmError[];
  totalWorktrees: number;
  succeeded: number;
  failed: number;
  totalProposals: number;
}

export interface SwarmReflectOptions extends RunnerOptions {
  /** If true, print per-worktree progress lines to stdout. */
  verbose?: boolean;
  /** If true, discover + print worktrees but do not run apex. */
  dryRun?: boolean;
}

/**
 * Count proposals mentioned in stdout. Looks for the reflector summary line:
 * "N file(s) written"
 */
function countProposalsFromStdout(stdout: string): number {
  const m = stdout.match(/(\d+)\s+file\(s\)\s+written/);
  return m && m[1] ? parseInt(m[1], 10) : 0;
}

/**
 * Run swarm reflect: discover all worktrees under `root`, fan out
 * `apex reflect --all` with bounded parallelism.
 *
 * @throws if called with APEX_IN_SWARM=1 (recursion guard).
 */
export async function runSwarmReflect(
  root: string,
  opts: SwarmReflectOptions = {},
): Promise<SwarmReflectResult> {
  // Recursion guard
  if (process.env["APEX_IN_SWARM"] === "1") {
    throw new Error("nested swarm invocation refused");
  }

  const discoveredWorktrees: WorktreeInfo[] = await discoverWorktrees(root);
  const worktreePaths = discoveredWorktrees.map((wt) => wt.path);

  if (opts.dryRun) {
    const dryResults: WorktreeResult[] = worktreePaths.map((p) => ({
      path: p,
      success: true,
      stdout: "[dry-run] would run apex reflect --all",
      stderr: "",
      code: 0,
      durationMs: 0,
    }));
    return {
      worktrees: dryResults,
      errors: [],
      totalWorktrees: worktreePaths.length,
      succeeded: worktreePaths.length,
      failed: 0,
      totalProposals: 0,
    };
  }

  const results = await runSwarmWorktrees(worktreePaths, opts);

  const errors: SwarmError[] = results
    .filter((r) => !r.success)
    .map((r) => ({ path: r.path, message: r.error ?? r.stderr }));

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  const totalProposals = results.reduce(
    (sum, r) => sum + countProposalsFromStdout(r.stdout),
    0,
  );

  return {
    worktrees: results,
    errors,
    totalWorktrees: results.length,
    succeeded,
    failed,
    totalProposals,
  };
}
