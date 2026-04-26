// Unit tests for src/prmining/git.ts
//
// Uses the `runGit` dependency-injection seam to avoid real git calls.
// The integration boundary (real git) is covered in integration.test.ts.

import { describe, it, expect } from "vitest";
import { readCommits } from "../../src/prmining/git.js";
import type { RunGitFn } from "../../src/prmining/git.js";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake git log output using the same separators as the real parser. */
const RS = "\x1e";
const FS = "\x1f";

function fakeRecord(
  sha: string,
  shortSha: string,
  author: string,
  date: string,
  subject: string,
  body: string,
  files: string[],
): string {
  const header = `${RS}${sha}${FS}${shortSha}${FS}${author}${FS}${date}${FS}${subject}${FS}${body}`;
  const fileList = files.length > 0 ? `\n${files.join("\n")}` : "";
  return `${header}${fileList}`;
}

function makeRunGit(output: string): RunGitFn {
  return async (_args: string[], _cwd: string) => output;
}

function makeFailingRunGit(message: string): RunGitFn {
  return async () => {
    throw new Error(message);
  };
}

// ---------------------------------------------------------------------------
// Tests: readCommits with mocked RunGitFn
// ---------------------------------------------------------------------------

describe("readCommits — mocked git runner", () => {
  it("returns available:false when root has no .git directory", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-git-"));
    try {
      const result = await readCommits(tmp, { runGit: makeRunGit("") });
      expect(result.available).toBe(false);
      expect(result.commits).toHaveLength(0);
      expect(result.reason).toMatch(/not a git repo/i);
    } finally {
      await fs.remove(tmp);
    }
  });

  it("returns available:true and empty commits for empty output", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-git-"));
    try {
      await fs.ensureDir(path.join(tmp, ".git"));
      const result = await readCommits(tmp, { runGit: makeRunGit("") });
      expect(result.available).toBe(true);
      expect(result.commits).toHaveLength(0);
    } finally {
      await fs.remove(tmp);
    }
  });

  it("parses a single commit record correctly", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-git-"));
    try {
      await fs.ensureDir(path.join(tmp, ".git"));
      const output = fakeRecord(
        "abc1234def5678abc1234def5678abc1234def56",
        "abc1234",
        "Alice",
        "2026-04-26T10:00:00Z",
        "fix: handle null pointer in parser",
        "Because the parser was not checking for null input.\nThis caused crashes.",
        ["src/parser.ts", "test/parser.test.ts"],
      );
      const result = await readCommits(tmp, { runGit: makeRunGit(output) });
      expect(result.available).toBe(true);
      expect(result.commits).toHaveLength(1);
      const c = result.commits[0]!;
      expect(c.sha).toBe("abc1234def5678abc1234def5678abc1234def56");
      expect(c.shortSha).toBe("abc1234");
      expect(c.author).toBe("Alice");
      expect(c.subject).toBe("fix: handle null pointer in parser");
      expect(c.body).toContain("Because the parser was not checking");
      expect(c.files).toContain("src/parser.ts");
      expect(c.files).toContain("test/parser.test.ts");
    } finally {
      await fs.remove(tmp);
    }
  });

  it("parses multiple commit records", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-git-"));
    try {
      await fs.ensureDir(path.join(tmp, ".git"));
      const r1 = fakeRecord(
        "aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111",
        "aaaa111",
        "Alice",
        "2026-04-26T10:00:00Z",
        "fix: crash on empty input",
        "",
        ["src/foo.ts"],
      );
      const r2 = fakeRecord(
        "bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222",
        "bbbb222",
        "Bob",
        "2026-04-26T11:00:00Z",
        "decide: adopt zod for validation",
        "Why: zod provides runtime safety.\nBecause other libs were harder to use.",
        ["src/schema.ts"],
      );
      const output = r1 + r2;
      const result = await readCommits(tmp, { runGit: makeRunGit(output) });
      expect(result.available).toBe(true);
      expect(result.commits).toHaveLength(2);
      expect(result.commits[0]!.subject).toBe("fix: crash on empty input");
      expect(result.commits[1]!.subject).toBe("decide: adopt zod for validation");
    } finally {
      await fs.remove(tmp);
    }
  });

  it("extracts PR number from commit subject like '(#42)'", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-git-"));
    try {
      await fs.ensureDir(path.join(tmp, ".git"));
      const output = fakeRecord(
        "cccc3333cccc3333cccc3333cccc3333cccc3333",
        "cccc333",
        "Carol",
        "2026-04-26T12:00:00Z",
        "fix: memory leak in worker (#42)",
        "",
        [],
      );
      const result = await readCommits(tmp, { runGit: makeRunGit(output) });
      expect(result.commits[0]!.prNumber).toBe(42);
    } finally {
      await fs.remove(tmp);
    }
  });

  it("falls back to limit-only query when since ref fails", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-git-"));
    try {
      await fs.ensureDir(path.join(tmp, ".git"));
      let callCount = 0;
      const output = fakeRecord(
        "dddd4444dddd4444dddd4444dddd4444dddd4444",
        "dddd444",
        "Dave",
        "2026-04-26T13:00:00Z",
        "hotfix: revert bad deploy",
        "",
        [],
      );
      const runGit: RunGitFn = async (args, _cwd) => {
        callCount++;
        // First call (with since ref) throws; second call (fallback) succeeds
        if (callCount === 1 && args.some((a) => a.includes("..HEAD"))) {
          throw new Error("unknown revision");
        }
        return output;
      };
      const result = await readCommits(tmp, { since: "nonexistent-ref", runGit });
      expect(result.available).toBe(true);
      expect(result.commits).toHaveLength(1);
      expect(callCount).toBe(2);
    } finally {
      await fs.remove(tmp);
    }
  });

  it("returns available:false if both git calls fail", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-git-"));
    try {
      await fs.ensureDir(path.join(tmp, ".git"));
      const result = await readCommits(tmp, {
        runGit: makeFailingRunGit("git is broken"),
      });
      expect(result.available).toBe(false);
      expect(result.reason).toContain("git log failed");
    } finally {
      await fs.remove(tmp);
    }
  });

  it("ignores non-file lines in the diff output", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-git-"));
    try {
      await fs.ensureDir(path.join(tmp, ".git"));
      // Simulate git output that includes garbage lines mixed with files
      const output =
        RS +
        `eeee5555eeee5555eeee5555eeee5555eeee5555${FS}eee5555${FS}Eve${FS}2026-04-26T14:00:00Z${FS}fix: parse error` +
        `${FS}` +
        "\nsrc/parser.ts\n\n3 files changed, 10 insertions(+)";
      const result = await readCommits(tmp, { runGit: makeRunGit(output) });
      expect(result.commits).toHaveLength(1);
      const files = result.commits[0]!.files;
      // Should contain src/parser.ts but NOT the summary line
      expect(files).toContain("src/parser.ts");
      expect(files.some((f) => f.includes("files changed"))).toBe(false);
    } finally {
      await fs.remove(tmp);
    }
  });
});

describe("readCommits — respects limit option", () => {
  it("passes --max-count to git", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-git-"));
    try {
      await fs.ensureDir(path.join(tmp, ".git"));
      let capturedArgs: string[] = [];
      const runGit: RunGitFn = async (args, _cwd) => {
        capturedArgs = args;
        return "";
      };
      await readCommits(tmp, { limit: 25, runGit });
      expect(capturedArgs).toContain("--max-count=25");
    } finally {
      await fs.remove(tmp);
    }
  });
});
