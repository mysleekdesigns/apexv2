import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";
import matter from "gray-matter";
import { runArchaeologist } from "../../src/archaeologist/index.js";

const exec = promisify(execFile);

const FIXTURE = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../fixtures/projects/archaeology-sample",
);

let tempRoot: string;

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-arch-int-"));
  await fs.copy(FIXTURE, tempRoot);
  await exec("git", ["init", "-q", "-b", "main"], { cwd: tempRoot, shell: false });
  await exec("git", ["config", "user.email", "fixture@example.com"], { cwd: tempRoot, shell: false });
  await exec("git", ["config", "user.name", "Fixture Author"], { cwd: tempRoot, shell: false });
  await exec("git", ["config", "commit.gpgsign", "false"], { cwd: tempRoot, shell: false });
  await exec("git", ["add", "."], { cwd: tempRoot, shell: false });
  await exec("git", ["commit", "-q", "-m", "feat: initial commit"], { cwd: tempRoot, shell: false });
  for (const subj of [
    "fix: handle null in parser",
    "fix: race in worker",
    "fix: typo in config",
    "fix: stale cache",
    "fix: bad date format",
    "chore: bump deps",
  ]) {
    const filename = `note-${Math.random().toString(36).slice(2, 8)}.txt`;
    await fs.writeFile(path.join(tempRoot, filename), subj, "utf8");
    await exec("git", ["add", "."], { cwd: tempRoot, shell: false });
    await exec("git", ["commit", "-q", "-m", subj], { cwd: tempRoot, shell: false });
  }
});

afterAll(async () => {
  if (tempRoot) await fs.remove(tempRoot);
});

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateFrontmatter(fm: Record<string, unknown>): void {
  expect(fm.id).toMatch(ID_RE);
  expect((fm.id as string).length).toBeLessThanOrEqual(64);
  expect(typeof fm.title).toBe("string");
  expect((fm.title as string).length).toBeLessThanOrEqual(120);
  expect(["decision", "pattern", "gotcha", "convention"]).toContain(fm.type);
  expect(["user", "team", "all"]).toContain(fm.applies_to);
  expect(["low", "medium", "high"]).toContain(fm.confidence);
  expect(Array.isArray(fm.sources)).toBe(true);
  expect((fm.sources as unknown[]).length).toBeGreaterThanOrEqual(1);
  expect(fm.created).toMatch(DATE_RE);
  expect(fm.last_validated).toMatch(DATE_RE);
  expect(fm.last_validated >= fm.created).toBe(true);

  switch (fm.type) {
    case "decision":
      expect(fm.decision).toBeTruthy();
      expect(fm.rationale).toBeTruthy();
      expect(fm.outcome).toBeTruthy();
      break;
    case "pattern":
      expect(fm.intent).toBeTruthy();
      expect(Array.isArray(fm.applies_when)).toBe(true);
      break;
    case "gotcha":
      expect(fm.symptom).toBeTruthy();
      expect(fm.resolution).toBeTruthy();
      break;
    case "convention":
      expect(fm.rule).toBeTruthy();
      expect(["manual", "lint", "ci", "hook"]).toContain(fm.enforcement);
      break;
  }
}

describe("runArchaeologist (integration)", () => {
  it("writes _pending-stack.md and per-entry proposals to .apex/proposed/", async () => {
    const report = await runArchaeologist(tempRoot, {});
    expect(report.proposalsWritten.length).toBeGreaterThan(0);
    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    expect(await fs.pathExists(proposedDir)).toBe(true);
    const stackPath = path.join(proposedDir, "_pending-stack.md");
    expect(await fs.pathExists(stackPath)).toBe(true);
    const stackBody = await fs.readFile(stackPath, "utf8");
    expect(stackBody).toContain("PROPOSED");
    expect(stackBody).toContain("Pending stack summary");
  });

  it("every proposal has a PROPOSED header and valid frontmatter", async () => {
    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    const files = (await fs.readdir(proposedDir)).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(1);
    for (const f of files) {
      const full = path.join(proposedDir, f);
      const content = await fs.readFile(full, "utf8");
      expect(content.startsWith("<!-- PROPOSED")).toBe(true);
      expect(content.length).toBeLessThanOrEqual(16 * 1024);
      if (f === "_pending-stack.md") continue;
      const stripped = content.replace(/^<!--[^\n]*-->\s*/, "");
      const parsed = matter(stripped);
      const fm = parsed.data as Record<string, unknown>;
      expect(`${fm.id}.md`).toBe(f);
      validateFrontmatter(fm);
    }
  });

  it("dry-run does not create files", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-dry-"));
    try {
      await fs.copy(FIXTURE, tmp);
      const report = await runArchaeologist(tmp, { dryRun: true, skipGit: true });
      expect(report.proposalsWritten.length).toBeGreaterThan(0);
      expect(await fs.pathExists(path.join(tmp, ".apex", "proposed"))).toBe(false);
    } finally {
      await fs.remove(tmp);
    }
  });

  it("skipGit gracefully omits git-derived proposals", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-skipgit-"));
    try {
      await fs.copy(FIXTURE, tmp);
      const report = await runArchaeologist(tmp, { skipGit: true });
      expect(report.signalsSkipped.some((s) => s.kind === "git-log")).toBe(true);
      const ids = report.proposalsWritten.map((p) => path.basename(p, ".md"));
      expect(ids).not.toContain("recurring-fix-area");
      expect(ids).not.toContain("git-conventional-commits");
    } finally {
      await fs.remove(tmp);
    }
  });

  it("re-running does not overwrite existing proposals", async () => {
    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    const stackPath = path.join(proposedDir, "_pending-stack.md");
    await fs.writeFile(stackPath, "USER EDITED", "utf8");
    const report = await runArchaeologist(tempRoot, {});
    expect(report.proposalsSkipped.some((s) => s.path === stackPath)).toBe(true);
    expect(await fs.readFile(stackPath, "utf8")).toBe("USER EDITED");
  });
});
