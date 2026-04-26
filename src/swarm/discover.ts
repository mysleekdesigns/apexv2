/**
 * discover.ts — list git worktrees by parsing `git worktree list --porcelain`.
 * Uses child_process.execFile (no shell). Returns [] if not in a git repo.
 */

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
}

/**
 * Parse the porcelain output of `git worktree list --porcelain` into
 * an array of WorktreeInfo records.
 */
export function parsePorcelain(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];

  // Split into blocks separated by blank lines
  const blocks = output.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) continue;

    let worktreePath: string | null = null;
    let head: string | null = null;
    let branch: string | null = null;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length).trim();
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        const rawBranch = line.slice("branch ".length).trim();
        // Strip refs/heads/ prefix
        branch = rawBranch.startsWith("refs/heads/")
          ? rawBranch.slice("refs/heads/".length)
          : rawBranch;
      }
      // "detached" line means branch stays null — already handled by default
    }

    if (worktreePath !== null && head !== null) {
      worktrees.push({ path: worktreePath, branch, head });
    }
  }

  return worktrees;
}

/**
 * Discover all git worktrees rooted at `cwd`.
 * Returns [] if `cwd` is not inside a git repo or git is not available.
 */
export async function discoverWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  try {
    const { stdout } = await execFile("git", ["worktree", "list", "--porcelain"], {
      cwd,
    });
    return parsePorcelain(stdout);
  } catch {
    // Not a git repo, git not available, or other error
    return [];
  }
}
