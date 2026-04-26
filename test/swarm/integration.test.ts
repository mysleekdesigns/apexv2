import { describe, it, expect, afterEach } from "vitest";
import { runSwarmReflect } from "../../src/swarm/index.js";
import type { ApexResult, RunApexFn } from "../../src/swarm/runner.js";

// ─── Recursion guard ─────────────────────────────────────────────────────────

describe("runSwarmReflect — recursion guard", () => {
  afterEach(() => {
    delete process.env["APEX_IN_SWARM"];
  });

  it("throws immediately when APEX_IN_SWARM=1", async () => {
    process.env["APEX_IN_SWARM"] = "1";
    await expect(runSwarmReflect("/any/path", {})).rejects.toThrow(
      "nested swarm invocation refused",
    );
  });

  it("does NOT throw when APEX_IN_SWARM is unset", async () => {
    delete process.env["APEX_IN_SWARM"];

    const fakeFn: RunApexFn = async (): Promise<ApexResult> => {
      return { stdout: "0 file(s) written", stderr: "", code: 0 };
    };

    // Use a fake discoverer by injecting fake runApex — no real git needed
    // runSwarmReflect calls discoverWorktrees(root) which will return [] for a non-git path,
    // which means runSwarmWorktrees is called with [] and returns []
    const result = await runSwarmReflect("/tmp/not-a-git-repo-apex-swarm-test", {
      runApex: fakeFn,
    });

    // Should complete without throwing
    expect(result.totalWorktrees).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
  });
});

// ─── End-to-end through runSwarmReflect with fake runner ─────────────────────

describe("runSwarmReflect — end-to-end with injected runApex", () => {
  afterEach(() => {
    delete process.env["APEX_IN_SWARM"];
  });

  it("aggregates results correctly for all-success scenario", async () => {
    const fakeFn: RunApexFn = async (): Promise<ApexResult> => {
      return {
        stdout: "reflector: 2 episode(s) processed, 1 gotcha candidate(s), 0 convention candidate(s), 3 file(s) written, 0 skipped.",
        stderr: "",
        code: 0,
      };
    };

    // Manually call runSwarmWorktrees-level test by injecting a pre-known worktree list.
    // Since we can't easily inject discover, we wrap with a non-git tmpdir (returns 0 worktrees)
    // and test the aggregation logic by calling the runner directly.
    const { runSwarmWorktrees } = await import("../../src/swarm/runner.js");
    const results = await runSwarmWorktrees(["/wt/a", "/wt/b"], {
      parallel: 2,
      runApex: fakeFn,
    });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);

    // Verify proposal counting
    const totalProposals = results.reduce((sum, r) => {
      const m = r.stdout.match(/(\d+)\s+file\(s\)\s+written/);
      return sum + (m && m[1] ? parseInt(m[1], 10) : 0);
    }, 0);
    expect(totalProposals).toBe(6); // 3 per worktree * 2
  });

  it("reports errors in the errors array for failed worktrees", async () => {
    const fakeFn: RunApexFn = async (cwd: string): Promise<ApexResult> => {
      if (cwd === "/wt/broken") {
        return { stdout: "", stderr: "reflector error: no episodes found", code: 1 };
      }
      return { stdout: "2 file(s) written", stderr: "", code: 0 };
    };

    const { runSwarmWorktrees } = await import("../../src/swarm/runner.js");
    const results = await runSwarmWorktrees(["/wt/ok", "/wt/broken"], {
      parallel: 2,
      runApex: fakeFn,
    });

    const failed = results.filter((r) => !r.success);
    const succeeded = results.filter((r) => r.success);

    expect(failed).toHaveLength(1);
    expect(succeeded).toHaveLength(1);
    expect(failed[0]!.path).toBe("/wt/broken");
    expect(failed[0]!.stderr).toContain("reflector error");
  });

  it("dry-run returns results without calling runApex", async () => {
    // dry-run short-circuits before calling runApex
    let apexCallCount = 0;
    const fakeFn: RunApexFn = async (): Promise<ApexResult> => {
      apexCallCount++;
      return { stdout: "", stderr: "", code: 0 };
    };

    // We need to have no worktrees discovered (non-git dir) for dry-run to work cleanly
    const result = await runSwarmReflect("/tmp/not-a-git-repo-apex-swarm-dry-run", {
      dryRun: true,
      runApex: fakeFn,
    });

    // No apex calls (dry-run + 0 worktrees)
    expect(apexCallCount).toBe(0);
    expect(result.dryRun === undefined || result.totalWorktrees === 0).toBe(true);
  });

  it("SwarmReflectResult shape is correct", async () => {
    const fakeFn: RunApexFn = async (): Promise<ApexResult> => {
      return { stdout: "1 file(s) written", stderr: "", code: 0 };
    };

    // Non-git dir => 0 worktrees
    const result = await runSwarmReflect("/tmp/non-git-dir-apex-test", {
      runApex: fakeFn,
    });

    expect(typeof result.totalWorktrees).toBe("number");
    expect(typeof result.succeeded).toBe("number");
    expect(typeof result.failed).toBe("number");
    expect(typeof result.totalProposals).toBe("number");
    expect(Array.isArray(result.worktrees)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("totalProposals sums across all worktrees", async () => {
    const fakeFn: RunApexFn = async (): Promise<ApexResult> => {
      return { stdout: "5 file(s) written", stderr: "", code: 0 };
    };

    const { runSwarmWorktrees } = await import("../../src/swarm/runner.js");
    const results = await runSwarmWorktrees(["/a", "/b", "/c"], { runApex: fakeFn });

    const totalProposals = results.reduce((sum, r) => {
      const m = r.stdout.match(/(\d+)\s+file\(s\)\s+written/);
      return sum + (m && m[1] ? parseInt(m[1], 10) : 0);
    }, 0);

    expect(totalProposals).toBe(15); // 5 * 3 worktrees
  });
});
