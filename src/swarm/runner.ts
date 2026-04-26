/**
 * runner.ts — given a list of worktree paths, spawn `apex reflect --all`
 * per worktree with bounded parallelism.
 *
 * Accepts a `runApex` injection seam for tests.
 * Sets APEX_IN_SWARM=1 on child processes to prevent recursion.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFile = promisify(execFileCb);

export interface ApexResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface WorktreeResult {
  path: string;
  success: boolean;
  stdout: string;
  stderr: string;
  code: number;
  durationMs: number;
  error?: string;
}

export type RunApexFn = (cwd: string, args: string[]) => Promise<ApexResult>;

export interface RunnerOptions {
  /** Max number of concurrent apex invocations. Defaults to floor(cpus/2), min 1. */
  parallel?: number;
  /** Per-worktree timeout in milliseconds. Defaults to 60_000. */
  timeoutMs?: number;
  /** Path to the apex binary. Defaults to process.argv[1]. */
  apexBin?: string;
  /** Injection seam for tests. If provided, used instead of real execFile. */
  runApex?: RunApexFn;
}

/**
 * Default parallelism: floor(cpus/2), minimum 1.
 */
export function defaultParallelism(): number {
  return Math.max(1, Math.floor(os.cpus().length / 2));
}

/**
 * Build the real runApex function using child_process.execFile.
 */
function buildRealRunApex(apexBin: string, timeoutMs: number): RunApexFn {
  return async (cwd: string, args: string[]): Promise<ApexResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const { stdout, stderr } = await execFile(
        process.execPath,
        [apexBin, ...args],
        {
          cwd,
          env: {
            ...process.env,
            APEX_IN_SWARM: "1",
          },
          signal: controller.signal,
          timeout: timeoutMs,
        },
      );
      return { stdout, stderr, code: 0 };
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
      };

      // AbortError or timeout
      if (e.name === "AbortError" || e.killed) {
        return {
          stdout: e.stdout ?? "",
          stderr: e.stderr ?? `Timed out after ${timeoutMs}ms`,
          code: 124,
        };
      }

      const code = typeof e.code === "number" ? e.code : 1;
      return {
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? e.message,
        code,
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Run apex reflect --all across a list of worktree paths with bounded parallelism.
 */
export async function runSwarmWorktrees(
  worktreePaths: string[],
  opts: RunnerOptions = {},
): Promise<WorktreeResult[]> {
  const parallelism = opts.parallel ?? defaultParallelism();
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const apexBin = opts.apexBin ?? process.argv[1] ?? "apex";

  const runApex: RunApexFn =
    opts.runApex ?? buildRealRunApex(apexBin, timeoutMs);

  const results: WorktreeResult[] = [];

  // Simple promise-pool: maintain at most `parallelism` in-flight promises
  const queue = [...worktreePaths];
  const inFlight = new Set<Promise<void>>();

  const dispatch = (wtPath: string): Promise<void> => {
    // Use a ref-holder so the async closure can remove itself from inFlight
    const ref: { p: Promise<void> | null } = { p: null };
    ref.p = (async (): Promise<void> => {
      const started = Date.now();
      try {
        const result = await runApex(wtPath, ["reflect", "--all"]);
        results.push({
          path: wtPath,
          success: result.code === 0,
          stdout: result.stdout,
          stderr: result.stderr,
          code: result.code,
          durationMs: Date.now() - started,
        });
      } catch (err: unknown) {
        const e = err as Error;
        results.push({
          path: wtPath,
          success: false,
          stdout: "",
          stderr: e.message,
          code: 1,
          durationMs: Date.now() - started,
          error: e.message,
        });
      } finally {
        if (ref.p !== null) inFlight.delete(ref.p);
      }
    })();
    inFlight.add(ref.p);
    return ref.p;
  };

  // Seed initial batch
  while (queue.length > 0 && inFlight.size < parallelism) {
    const wt = queue.shift()!;
    void dispatch(wt);
  }

  // Drain queue
  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    // Refill up to parallelism limit
    while (queue.length > 0 && inFlight.size < parallelism) {
      const wt = queue.shift()!;
      void dispatch(wt);
    }
  }

  return results;
}
