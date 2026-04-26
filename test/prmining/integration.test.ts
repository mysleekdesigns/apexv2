// Integration tests for src/prmining/index.ts — runPrMining
//
// Uses a real tmpdir + git init + several commits to verify end-to-end behavior.
// The git I/O boundary is real (execFile); only the gh CLI is skipped.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "fs-extra";
import matter from "gray-matter";
import { runPrMining, PROPOSED_HEADER } from "../../src/prmining/index.js";

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gitExec(args: string[], cwd: string): Promise<void> {
  await exec("git", args, { cwd, shell: false });
}

async function setupRepo(dir: string): Promise<void> {
  await gitExec(["init", "-q", "-b", "main"], dir);
  await gitExec(["config", "user.email", "fixture@example.com"], dir);
  await gitExec(["config", "user.name", "Fixture Author"], dir);
  await gitExec(["config", "commit.gpgsign", "false"], dir);
}

async function writeAndCommit(
  dir: string,
  filename: string,
  content: string,
  message: string,
  bodyLines?: string[],
): Promise<void> {
  await fs.ensureDir(path.dirname(path.join(dir, filename)));
  await fs.writeFile(path.join(dir, filename), content, "utf8");
  await gitExec(["add", "."], dir);
  const fullMessage = bodyLines
    ? `${message}\n\n${bodyLines.join("\n")}`
    : message;
  await exec("git", ["commit", "-q", "-m", fullMessage], { cwd: dir, shell: false });
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

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
  const sources = fm.sources as Array<{ kind: string; ref: string }>;
  expect(sources.length).toBeGreaterThanOrEqual(1);
  for (const s of sources) {
    expect(["bootstrap", "correction", "reflection", "manual", "pr"]).toContain(s.kind);
    expect(typeof s.ref).toBe("string");
    expect(s.ref.length).toBeGreaterThan(0);
  }
  expect(fm.created).toMatch(DATE_RE);
  expect(fm.last_validated).toMatch(DATE_RE);
  switch (fm.type) {
    case "gotcha":
      expect(fm.symptom).toBeTruthy();
      expect(fm.resolution).toBeTruthy();
      break;
    case "decision":
      expect(fm.decision).toBeTruthy();
      expect(fm.rationale).toBeTruthy();
      expect(fm.outcome).toBeTruthy();
      break;
  }
}

// ---------------------------------------------------------------------------
// Shared setup: one repo, one mining run
// ---------------------------------------------------------------------------

let tempRoot: string;
let miningReport: Awaited<ReturnType<typeof runPrMining>>;

beforeAll(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-int-"));
  await setupRepo(tempRoot);

  // Baseline commit (non-signal)
  await writeAndCommit(tempRoot, "README.md", "# Test Repo\n", "feat: initial commit");

  // Signal commits
  await writeAndCommit(
    tempRoot,
    "src/parser.ts",
    "export const parse = (s: string) => s;\n",
    "fix: handle null pointer in parser",
    ["Why: the parser assumed non-null input without checking."],
  );
  await writeAndCommit(
    tempRoot,
    "src/worker.ts",
    "export const work = () => {};\n",
    "fix: race condition in worker pool",
    ["Because workers were sharing state without locking."],
  );
  await writeAndCommit(
    tempRoot,
    "docs/decisions/adopt-zod.md",
    "# Adopt Zod\n\nWe use zod for validation.\n",
    "decide: adopt zod for validation",
    ["Reason: zod provides runtime type safety.", "To avoid class of runtime type errors."],
  );
  await writeAndCommit(
    tempRoot,
    "src/config.ts",
    "export const config = {};\n",
    "chore: update config types",
  );
  await writeAndCommit(
    tempRoot,
    "src/api.ts",
    "export const api = {};\n",
    "feat: add new endpoint",
  );

  // Run mining once; all tests share this result
  miningReport = await runPrMining(tempRoot, { limit: 20 });
});

afterAll(async () => {
  if (tempRoot) await fs.remove(tempRoot);
});

// ---------------------------------------------------------------------------

describe("runPrMining (integration)", () => {
  it("returns commitsScanned > 0", () => {
    expect(miningReport.commitsScanned).toBeGreaterThan(0);
  });

  it("finds candidates from fix and decide commits", () => {
    expect(miningReport.candidatesFound).toBeGreaterThanOrEqual(2);
  });

  it("writes proposals to .apex/proposed/", async () => {
    expect(miningReport.proposalsWritten.length).toBeGreaterThan(0);
    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    expect(await fs.pathExists(proposedDir)).toBe(true);
  });

  it("every proposal has a PROPOSED header", async () => {
    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    const files = (await fs.readdir(proposedDir)).filter((f) => f.endsWith(".md"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const content = await fs.readFile(path.join(proposedDir, f), "utf8");
      expect(content.startsWith("<!-- PROPOSED")).toBe(true);
    }
  });

  it("every proposal has valid frontmatter", async () => {
    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    const files = (await fs.readdir(proposedDir)).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const full = path.join(proposedDir, f);
      const content = await fs.readFile(full, "utf8");
      // Strip the PROPOSED comment header before parsing
      const stripped = content.replace(/^<!--[^\n]*-->\s*/, "");
      const parsed = matter(stripped);
      const fm = parsed.data as Record<string, unknown>;
      expect(`${fm.id}.md`).toBe(f);
      validateFrontmatter(fm);
    }
  });

  it("proposal file size is ≤ 16 KiB", async () => {
    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    const files = (await fs.readdir(proposedDir)).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const full = path.join(proposedDir, f);
      const content = await fs.readFile(full, "utf8");
      expect(content.length).toBeLessThanOrEqual(16 * 1024);
    }
  });

  it("dry-run does not create files", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-dry-"));
    try {
      await setupRepo(tmp);
      await writeAndCommit(tmp, "src/foo.ts", "export {};\n", "fix: dry run test");
      const report = await runPrMining(tmp, { dryRun: true, limit: 10 });
      // proposals are reported but not written to disk
      const proposedDir = path.join(tmp, ".apex", "proposed");
      expect(await fs.pathExists(proposedDir)).toBe(false);
      expect(Array.isArray(report.proposalsWritten)).toBe(true);
    } finally {
      await fs.remove(tmp);
    }
  });

  it("re-running does not overwrite existing proposals", async () => {
    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    const files = await fs.readdir(proposedDir);
    const firstFile = files.find((f) => f.endsWith(".md"));
    if (!firstFile) return; // vacuous pass if no proposals

    const filePath = path.join(proposedDir, firstFile);
    const originalContent = "USER EDITED CONTENT";
    await fs.writeFile(filePath, originalContent, "utf8");

    const secondReport = await runPrMining(tempRoot, { limit: 20 });
    expect(secondReport.proposalsSkipped.some((s) => s.path === filePath)).toBe(true);
    expect(await fs.readFile(filePath, "utf8")).toBe(originalContent);

    // Restore the file for subsequent tests
    await fs.writeFile(
      filePath,
      miningReport.proposalsWritten.includes(filePath)
        ? "<!-- PROPOSED — review before moving to .apex/knowledge/ -->\nRESTORED\n"
        : originalContent,
      "utf8",
    );
  });

  it("returns no proposals for non-git directory", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-nongit-"));
    try {
      const report = await runPrMining(tmp, { limit: 10 });
      expect(report.commitsScanned).toBe(0);
      expect(report.candidatesFound).toBe(0);
      expect(report.proposalsWritten).toHaveLength(0);
    } finally {
      await fs.remove(tmp);
    }
  });

  it("prsScanned is 0 when includeReviews is false (default)", () => {
    expect(miningReport.prsScanned).toBe(0);
  });

  it("proposal sources reference commits with valid source kinds", async () => {
    const proposedDir = path.join(tempRoot, ".apex", "proposed");
    const files = (await fs.readdir(proposedDir)).filter((f) => f.endsWith(".md"));
    for (const f of files) {
      const full = path.join(proposedDir, f);
      const rawContent = await fs.readFile(full, "utf8");
      const content = rawContent.replace(/^<!--[^\n]*-->\s*/, "");
      const parsed = matter(content);
      const sources = parsed.data.sources;
      if (!Array.isArray(sources)) continue; // restored/edited files
      for (const s of sources as Array<{ kind: string; ref: string }>) {
        expect(["reflection", "pr", "bootstrap", "correction", "manual"]).toContain(s.kind);
        if (s.kind === "reflection") {
          expect(s.ref).toMatch(/^commit\//);
        }
        if (s.kind === "pr") {
          expect(s.ref).toMatch(/^pr\//);
        }
      }
    }
  });

  it("PROPOSED_HEADER export matches the expected value", () => {
    expect(PROPOSED_HEADER).toBe(
      "<!-- PROPOSED — review before moving to .apex/knowledge/ -->",
    );
  });

  it("mining a repo with only non-signal commits produces 0 candidates", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-prmine-nosig-"));
    try {
      await setupRepo(tmp);
      await writeAndCommit(tmp, "README.md", "# Quiet\n", "feat: initial commit");
      await writeAndCommit(tmp, "src/foo.ts", "export {};\n", "chore: update deps");
      await writeAndCommit(tmp, "src/bar.ts", "export {};\n", "docs: update readme");
      const report = await runPrMining(tmp, { limit: 10 });
      expect(report.candidatesFound).toBe(0);
      expect(report.proposalsWritten).toHaveLength(0);
    } finally {
      await fs.remove(tmp);
    }
  });
});
