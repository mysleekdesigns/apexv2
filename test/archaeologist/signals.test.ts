import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";
import {
  ciSignal,
  gitLogSignal,
  openPrsSignal,
  readmeSignal,
  testRunnerSignal,
  topImportsSignal,
} from "../../src/archaeologist/signals.js";
import { detect } from "../../src/detect/index.js";

const exec = promisify(execFile);

const FIXTURE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../fixtures/projects/archaeology-sample",
);

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-arch-"));
  await fs.copy(FIXTURE, tempRoot);
  await exec("git", ["init", "-q", "-b", "main"], { cwd: tempRoot, shell: false });
  await exec("git", ["config", "user.email", "fixture@example.com"], { cwd: tempRoot, shell: false });
  await exec("git", ["config", "user.name", "Fixture Author"], { cwd: tempRoot, shell: false });
  await exec("git", ["config", "commit.gpgsign", "false"], { cwd: tempRoot, shell: false });
  await exec("git", ["add", "."], { cwd: tempRoot, shell: false });
  await exec("git", ["commit", "-q", "-m", "feat: initial commit"], { cwd: tempRoot, shell: false });
  await fs.writeFile(path.join(tempRoot, "src", "extra.ts"), "export const x = 1;\n", "utf8");
  await exec("git", ["add", "."], { cwd: tempRoot, shell: false });
  await exec("git", ["commit", "-q", "-m", "fix: handle null case in parser"], { cwd: tempRoot, shell: false });
  await fs.writeFile(path.join(tempRoot, "src", "extra2.ts"), "export const y = 2;\n", "utf8");
  await exec("git", ["add", "."], { cwd: tempRoot, shell: false });
  await exec("git", ["commit", "-q", "-m", "fix: another null bug"], { cwd: tempRoot, shell: false });
  await fs.writeFile(path.join(tempRoot, "src", "extra3.ts"), "export const z = 3;\n", "utf8");
  await exec("git", ["add", "."], { cwd: tempRoot, shell: false });
  await exec("git", ["commit", "-q", "-m", "chore: bump deps"], { cwd: tempRoot, shell: false });
});

afterAll(async () => {
  if (tempRoot) await fs.remove(tempRoot);
});

describe("gitLogSignal", () => {
  it("parses commits, authors, and conventional prefixes", async () => {
    const s = await gitLogSignal(tempRoot);
    expect(s.kind).toBe("git-log");
    expect(s.available).toBe(true);
    expect(s.commitCount).toBeGreaterThanOrEqual(4);
    expect(s.topAuthors.length).toBeGreaterThan(0);
    expect(s.topAuthors[0]!.commits).toBeGreaterThanOrEqual(4);
    const prefixes = s.conventionalPrefixes.map((p) => p.prefix);
    expect(prefixes).toContain("fix");
    expect(prefixes).toContain("feat");
    expect(s.recentCommits.length).toBeGreaterThan(0);
  });

  it("returns unavailable when not a git repo", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-nongit-"));
    try {
      const s = await gitLogSignal(tmp);
      expect(s.available).toBe(false);
      expect(s.reason).toBeDefined();
    } finally {
      await fs.remove(tmp);
    }
  });
});

describe("readmeSignal", () => {
  it("extracts H1 and getting started block", async () => {
    const s = await readmeSignal(tempRoot);
    expect(s.available).toBe(true);
    expect(s.path).toBe("README.md");
    expect(s.h1).toBe("Archaeology Sample");
    expect(s.gettingStarted).toBeDefined();
    expect(s.gettingStarted!.body.toLowerCase()).toContain("pnpm");
    expect(s.stackMentions).toEqual(expect.arrayContaining(["TypeScript", "pnpm", "vitest"]));
  });

  it("returns unavailable when no README exists", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-noreadme-"));
    try {
      const s = await readmeSignal(tmp);
      expect(s.available).toBe(false);
    } finally {
      await fs.remove(tmp);
    }
  });
});

describe("topImportsSignal", () => {
  it("ranks deps by source-import frequency", async () => {
    const detection = await detect(tempRoot);
    const s = await topImportsSignal(tempRoot, detection);
    expect(s.available).toBe(true);
    expect(s.language).toBe("node");
    const names = s.ranked.map((r) => r.pkg);
    expect(names).toContain("zod");
    expect(names).toContain("fs-extra");
  });
});

describe("testRunnerSignal", () => {
  it("finds test files and reports the runner", async () => {
    const detection = await detect(tempRoot);
    const s = await testRunnerSignal(tempRoot, detection);
    expect(s.available).toBe(true);
    expect(s.runner).toBe("vitest");
    expect(s.testFiles.length).toBeGreaterThan(0);
    expect(s.testFiles.some((f) => f.endsWith(".test.ts"))).toBe(true);
  });
});

describe("openPrsSignal", () => {
  it("returns either available or a graceful skip", async () => {
    const s = await openPrsSignal(tempRoot);
    expect(s.kind).toBe("open-prs");
    if (!s.available) {
      expect(s.reason).toBeDefined();
      expect(s.prs).toEqual([]);
    } else {
      expect(Array.isArray(s.prs)).toBe(true);
    }
  });
});

describe("ciSignal", () => {
  it("reads workflow steps", async () => {
    const s = await ciSignal(tempRoot);
    expect(s.available).toBe(true);
    expect(s.workflows.length).toBeGreaterThan(0);
    const steps = s.workflows[0]!.steps;
    expect(steps.some((step) => /lint/i.test(step))).toBe(true);
    expect(steps.some((step) => /test/i.test(step))).toBe(true);
  });
});
