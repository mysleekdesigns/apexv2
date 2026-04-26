// Integration tests for runCurator over a full tmpdir.
//
// Each test builds its own isolated tmpdir with knowledge files and episodes,
// then asserts summary file content and merge proposal files.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import yaml from "yaml";
import { runCurator } from "../../src/curator/index.js";
import type { RetrievalLine } from "../../src/episode/writer.js";

// ---------- helpers -----------------------------------------------------------

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-curator-int-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeKnowledgeFile(
  root: string,
  type: "decisions" | "patterns" | "gotchas" | "conventions",
  id: string,
  extra: Record<string, unknown>,
  body = "Body content for this entry.",
): void {
  const dir = path.join(root, ".apex", "knowledge", type);
  fs.mkdirSync(dir, { recursive: true });
  const frontmatter = {
    id,
    type: type.slice(0, -1), // remove trailing 's' for singular type name
    title: extra.title ?? `Title for ${id}`,
    applies_to: "all",
    confidence: "medium",
    sources: [{ kind: "manual", ref: "manual/test" }],
    created: "2026-01-01",
    last_validated: "2026-04-26",
    ...extra,
  };
  const content = `---\n${yaml.stringify(frontmatter)}---\n\n${body}\n`;
  fs.writeFileSync(path.join(dir, `${id}.md`), content, "utf8");
}

function writeGotchaFile(
  root: string,
  id: string,
  extra: Record<string, unknown>,
  body = "Body content.",
): void {
  const dir = path.join(root, ".apex", "knowledge", "gotchas");
  fs.mkdirSync(dir, { recursive: true });
  const frontmatter = {
    id,
    type: "gotcha",
    title: extra.title ?? `Gotcha ${id}`,
    applies_to: "all",
    confidence: "medium",
    sources: extra.sources ?? [{ kind: "manual", ref: "manual/test" }],
    created: "2026-01-01",
    last_validated: extra.last_validated ?? "2026-04-26",
    symptom: extra.symptom ?? "Something breaks",
    resolution: extra.resolution ?? "Fix it",
    ...extra,
  };
  const content = `---\n${yaml.stringify(frontmatter)}---\n\n${body}\n`;
  fs.writeFileSync(path.join(dir, `${id}.md`), content, "utf8");
}

function writeRetrievalLine(root: string, episodeId: string, line: RetrievalLine): void {
  const dir = path.join(root, ".apex", "episodes", episodeId);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, "retrievals.jsonl"),
    JSON.stringify(line) + "\n",
    "utf8",
  );
}

const FIXED_NOW = new Date("2026-04-26T12:00:00Z");

// ---------- tests -------------------------------------------------------------

describe("runCurator — empty knowledge base", () => {
  it("produces a valid zero-everything summary without errors", async () => {
    const report = await runCurator(tmpDir, { now: FIXED_NOW });

    expect(report.duplicateClusters).toHaveLength(0);
    expect(report.staleEntries).toHaveLength(0);
    expect(report.driftEntries).toHaveLength(0);
    expect(report.mergeProposals).toHaveLength(0);

    // Summary file should have been written
    const summaryPath = path.join(tmpDir, ".apex", "curation", "2026-04-26.md");
    expect(fs.existsSync(summaryPath)).toBe(true);
    expect(report.summaryPath).toBe(summaryPath);

    const content = fs.readFileSync(summaryPath, "utf8");
    expect(content).toContain("2026-04-26");
    expect(content).toContain("Duplicate clusters");
    expect(content).toContain("Stale entries");
    expect(content).toContain("Drift candidates");
    expect(content).toContain("None.");
  });
});

describe("runCurator — duplicate detection", () => {
  it("detects duplicate entries and writes merge proposal when confidences differ", async () => {
    // Two gotchas with identical titles, different confidence
    writeGotchaFile(tmpDir, "gotcha-high", {
      title: "Forgetting to await db transaction causes silent data loss",
      confidence: "high",
    });
    writeGotchaFile(tmpDir, "gotcha-low", {
      title: "Forgetting to await db transaction causes silent data loss",
      confidence: "low",
    });

    const report = await runCurator(tmpDir, { now: FIXED_NOW });

    expect(report.duplicateClusters).toHaveLength(1);
    expect(report.duplicateClusters[0]!.proposeMerge).toBe(true);
    expect(report.duplicateClusters[0]!.keepId).toBe("gotcha-high");
    expect(report.duplicateClusters[0]!.discardId).toBe("gotcha-low");

    // Merge proposal file written
    expect(report.mergeProposals).toHaveLength(1);
    const proposalPath = report.mergeProposals[0]!;
    expect(path.basename(proposalPath)).toBe("_merge-gotcha-low-into-gotcha-high.md");
    expect(fs.existsSync(proposalPath)).toBe(true);

    const proposalContent = fs.readFileSync(proposalPath, "utf8");
    expect(proposalContent).toContain("<!-- PROPOSED");
    expect(proposalContent).toContain("gotcha-low");
    expect(proposalContent).toContain("gotcha-high");

    // Summary mentions the cluster
    const summaryContent = fs.readFileSync(report.summaryPath, "utf8");
    expect(summaryContent).toContain("gotcha-high");
    expect(summaryContent).toContain("gotcha-low");
  });

  it("does not write merge proposal for same-confidence duplicates, but notes them in summary", async () => {
    writeGotchaFile(tmpDir, "dupe-a", {
      title: "Always validate all user inputs at every API endpoint boundary layer",
      confidence: "medium",
    });
    writeGotchaFile(tmpDir, "dupe-b", {
      title: "Always validate all user inputs at every API endpoint boundary layer",
      confidence: "medium",
    });

    const report = await runCurator(tmpDir, { now: FIXED_NOW });

    expect(report.duplicateClusters).toHaveLength(1);
    expect(report.duplicateClusters[0]!.proposeMerge).toBe(false);
    expect(report.mergeProposals).toHaveLength(0);

    const summaryContent = fs.readFileSync(report.summaryPath, "utf8");
    expect(summaryContent).toContain("DUPLICATE CLUSTER");
  });
});

describe("runCurator — stale detection", () => {
  it("flags entries older than staleDays with no recent retrieval", async () => {
    // last_validated = 60 days before FIXED_NOW
    writeKnowledgeFile(
      tmpDir,
      "decisions",
      "old-decision",
      {
        type: "decision",
        title: "Old decision",
        last_validated: "2026-02-25",
        decision: "We chose X",
        rationale: "Because Y",
        outcome: "Z",
      },
    );

    const report = await runCurator(tmpDir, { now: FIXED_NOW, staleDays: 30 });
    expect(report.staleEntries).toHaveLength(1);
    expect(report.staleEntries[0]!.entry.frontmatter.id).toBe("old-decision");
    expect(report.staleEntries[0]!.daysSinceValidated).toBeGreaterThan(30);

    const summaryContent = fs.readFileSync(report.summaryPath, "utf8");
    expect(summaryContent).toContain("old-decision");
    expect(summaryContent).toContain("verified: false");
  });

  it("does not flag entries with recent retrieval even if last_validated is old", async () => {
    writeKnowledgeFile(
      tmpDir,
      "decisions",
      "retrieved-recently",
      {
        type: "decision",
        title: "Recently retrieved decision",
        last_validated: "2026-01-01",
        decision: "We chose A",
        rationale: "Reason",
        outcome: "Good",
      },
    );

    // Write a recent retrieval (5 days ago)
    writeRetrievalLine(tmpDir, "ep-001", {
      schema_version: 1,
      ts: "2026-04-21T10:00:00Z",
      turn: 1,
      entry_id: "retrieved-recently",
      entry_type: "decision",
      rank: 1,
      score: 0.95,
      surfaced: true,
    });

    const report = await runCurator(tmpDir, { now: FIXED_NOW, staleDays: 30 });
    expect(report.staleEntries).toHaveLength(0);
  });
});

describe("runCurator — drift detection", () => {
  it("flags gotchas with missing file/ refs in summary", async () => {
    writeGotchaFile(
      tmpDir,
      "drift-gotcha",
      {
        sources: [
          { kind: "correction", ref: "file/src/deleted-file.ts:42" },
        ],
      },
    );
    // src/deleted-file.ts does NOT exist in tmpDir

    const report = await runCurator(tmpDir, { now: FIXED_NOW });

    expect(report.driftEntries).toHaveLength(1);
    expect(report.driftEntries[0]!.entry.frontmatter.id).toBe("drift-gotcha");
    expect(report.driftEntries[0]!.missingPath).toBe("src/deleted-file.ts");

    const summaryContent = fs.readFileSync(report.summaryPath, "utf8");
    expect(summaryContent).toContain("drift-gotcha");
    expect(summaryContent).toContain("src/deleted-file.ts");
  });

  it("does not flag gotchas when the referenced file exists", async () => {
    // Create the file
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "present.ts"), "// present", "utf8");

    writeGotchaFile(
      tmpDir,
      "clean-gotcha",
      {
        sources: [{ kind: "correction", ref: "file/src/present.ts:10" }],
      },
    );

    const report = await runCurator(tmpDir, { now: FIXED_NOW });
    expect(report.driftEntries).toHaveLength(0);
  });
});

describe("runCurator — dry-run mode", () => {
  it("does not write any files in dry-run mode", async () => {
    writeGotchaFile(tmpDir, "dry-high", {
      title: "Forgetting to await db transaction causes silent data loss",
      confidence: "high",
    });
    writeGotchaFile(tmpDir, "dry-low", {
      title: "Forgetting to await db transaction causes silent data loss",
      confidence: "low",
    });

    const report = await runCurator(tmpDir, { now: FIXED_NOW, dryRun: true });

    // Report is returned but no files written
    expect(report.duplicateClusters).toHaveLength(1);
    expect(report.mergeProposals).toHaveLength(1); // paths computed but...

    // ...no actual files on disk
    const summaryPath = path.join(tmpDir, ".apex", "curation", "2026-04-26.md");
    expect(fs.existsSync(summaryPath)).toBe(false);

    const proposalPath = report.mergeProposals[0]!;
    expect(fs.existsSync(proposalPath)).toBe(false);
  });
});

describe("runCurator — re-run overwrites summary", () => {
  it("overwrites the same-day summary on re-run", async () => {
    const report1 = await runCurator(tmpDir, { now: FIXED_NOW });
    const content1 = fs.readFileSync(report1.summaryPath, "utf8");

    // Add an entry between runs
    writeGotchaFile(tmpDir, "new-gotcha", {
      last_validated: "2026-01-01",
    });

    const report2 = await runCurator(tmpDir, { now: FIXED_NOW, staleDays: 30 });
    const content2 = fs.readFileSync(report2.summaryPath, "utf8");

    expect(report1.summaryPath).toBe(report2.summaryPath);
    // Content should be different since second run sees the new gotcha
    expect(content2).not.toBe(content1);
    expect(content2).toContain("new-gotcha");
  });
});

describe("runCurator — tally section", () => {
  it("summary contains a tally table", async () => {
    const report = await runCurator(tmpDir, { now: FIXED_NOW });
    const content = fs.readFileSync(report.summaryPath, "utf8");
    expect(content).toContain("## Tally");
    expect(content).toContain("Duplicate clusters");
    expect(content).toContain("Stale entries");
    expect(content).toContain("Drift candidates");
  });
});
