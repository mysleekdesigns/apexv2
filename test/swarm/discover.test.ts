import { describe, it, expect, afterAll } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { realpath } from "node:fs/promises";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { parsePorcelain, discoverWorktrees } from "../../src/swarm/discover.js";

const execFile = promisify(execFileCb);

// ─── Unit tests for parsePorcelain ──────────────────────────────────────────

describe("parsePorcelain", () => {
  it("parses a single worktree with branch", () => {
    const input = `worktree /path/to/main
HEAD abc123def456
branch refs/heads/main

`;
    const result = parsePorcelain(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: "/path/to/main",
      branch: "main",
      head: "abc123def456",
    });
  });

  it("parses multiple worktrees", () => {
    const input = `worktree /path/to/main
HEAD abc123def456
branch refs/heads/main

worktree /path/to/feature-x
HEAD def456ghi789
branch refs/heads/feature-x

`;
    const result = parsePorcelain(input);
    expect(result).toHaveLength(2);
    expect(result[0]!.path).toBe("/path/to/main");
    expect(result[0]!.branch).toBe("main");
    expect(result[1]!.path).toBe("/path/to/feature-x");
    expect(result[1]!.branch).toBe("feature-x");
  });

  it("handles detached HEAD (branch is null)", () => {
    const input = `worktree /path/to/bare-detached
HEAD 789abc123def
detached

`;
    const result = parsePorcelain(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      path: "/path/to/bare-detached",
      branch: null,
      head: "789abc123def",
    });
  });

  it("strips refs/heads/ prefix from branch names", () => {
    const input = `worktree /repo
HEAD aabbccdd1122
branch refs/heads/feat/my-feature

`;
    const result = parsePorcelain(input);
    expect(result[0]!.branch).toBe("feat/my-feature");
  });

  it("returns [] for empty input", () => {
    expect(parsePorcelain("")).toEqual([]);
    expect(parsePorcelain("\n\n")).toEqual([]);
  });

  it("handles mixed detached and branched worktrees", () => {
    const input = `worktree /repos/main
HEAD 111111111111
branch refs/heads/main

worktree /repos/detached
HEAD 222222222222
detached

worktree /repos/feature
HEAD 333333333333
branch refs/heads/feature/foo

`;
    const result = parsePorcelain(input);
    expect(result).toHaveLength(3);
    expect(result[0]!.branch).toBe("main");
    expect(result[1]!.branch).toBeNull();
    expect(result[2]!.branch).toBe("feature/foo");
  });

  it("parses real-world compact output (no trailing newline on last block)", () => {
    const input = `worktree /home/user/project
HEAD deadbeef12345678
branch refs/heads/main`;
    const result = parsePorcelain(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe("/home/user/project");
    expect(result[0]!.head).toBe("deadbeef12345678");
  });
});

// ─── Integration test: real git init + worktree add ──────────────────────────

describe("discoverWorktrees (integration)", () => {
  let tmpDir: string;

  afterAll(async () => {
    if (tmpDir) {
      await fs.remove(tmpDir);
    }
  });

  it("discovers worktrees from a real git repo", async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-swarm-discover-"));
    const mainRepo = path.join(tmpDir, "main-repo");
    const worktreeDir = path.join(tmpDir, "feature-wt");

    await fs.ensureDir(mainRepo);

    // Init bare-minimum git repo
    await execFile("git", ["init", mainRepo]);
    await execFile("git", ["-C", mainRepo, "config", "user.email", "test@test.com"]);
    await execFile("git", ["-C", mainRepo, "config", "user.name", "Test"]);

    // Create an initial commit (required for worktree add)
    await fs.writeFile(path.join(mainRepo, "README.md"), "# test\n");
    await execFile("git", ["-C", mainRepo, "add", "."]);
    await execFile("git", ["-C", mainRepo, "commit", "-m", "init"]);

    // Create a branch for the worktree
    await execFile("git", ["-C", mainRepo, "branch", "feature-branch"]);

    // Add a worktree
    await execFile("git", ["-C", mainRepo, "worktree", "add", worktreeDir, "feature-branch"]);

    const worktrees = await discoverWorktrees(mainRepo);

    // Should find at least 2 worktrees: main + the new one
    expect(worktrees.length).toBeGreaterThanOrEqual(2);

    // Normalize paths: macOS resolves /tmp -> /private/tmp via symlink
    const realMainRepo = await realpath(mainRepo);
    const realWorktreeDir = await realpath(worktreeDir);

    const paths = worktrees.map((wt) => wt.path);
    expect(paths).toContain(realMainRepo);
    expect(paths).toContain(realWorktreeDir);

    const featureWt = worktrees.find((wt) => wt.path === realWorktreeDir);
    expect(featureWt).toBeDefined();
    expect(featureWt!.branch).toBe("feature-branch");
    expect(featureWt!.head).toBeTruthy();
  });

  it("returns [] for a path that is not a git repo", async () => {
    const nonGitDir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-swarm-nogit-"));
    try {
      const result = await discoverWorktrees(nonGitDir);
      expect(result).toEqual([]);
    } finally {
      await fs.remove(nonGitDir);
    }
  });
});
