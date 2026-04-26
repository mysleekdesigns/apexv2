import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "yaml";
import matter from "gray-matter";
import { promoteProposal } from "../../src/promote/move.js";
import { autoPromoteAll, findProposalById } from "../../src/promote/index.js";
import { validateProposal } from "../../src/promote/validate.js";
import { saveConfig } from "../../src/config/index.js";
import type { ApexConfig } from "../../src/config/index.js";

const TODAY = new Date().toISOString().slice(0, 10);

async function makeTempRoot(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "apex-promote-test-"));
  await fs.mkdir(path.join(base, ".apex", "proposed"), { recursive: true });
  for (const dir of ["gotchas", "conventions", "decisions", "patterns"]) {
    await fs.mkdir(path.join(base, ".apex", "knowledge", dir), { recursive: true });
  }
  return base;
}

async function cleanupRoot(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string) => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object) => yaml.stringify(o),
    },
  },
};

function makeGotchaContent(id = "test-gotcha", extras: Record<string, unknown> = {}): string {
  const fm: Record<string, unknown> = {
    id,
    type: "gotcha",
    title: "Test gotcha",
    applies_to: "all",
    confidence: "low",
    sources: [
      { kind: "bootstrap", ref: "episode/2026-04-20/turn-1" },
      { kind: "reflection", ref: "episode/2026-04-21/turn-2" },
    ],
    created: TODAY,
    last_validated: TODAY,
    symptom: "Something breaks",
    resolution: "Fix it",
    ...extras,
  };
  const fmYaml = yaml.stringify(fm, { lineWidth: 0 }).trimEnd();
  return `---\n${fmYaml}\n---\n\nBody content.\n`;
}

function makeConventionContent(id = "test-convention"): string {
  const fm: Record<string, unknown> = {
    id,
    type: "convention",
    title: "Test convention",
    applies_to: "all",
    confidence: "low",
    sources: [
      { kind: "bootstrap", ref: "a" },
      { kind: "manual", ref: "b" },
    ],
    created: TODAY,
    last_validated: TODAY,
    rule: "Always do X",
    enforcement: "manual",
  };
  const fmYaml = yaml.stringify(fm, { lineWidth: 0 }).trimEnd();
  return `---\n${fmYaml}\n---\n\nConvention body.\n`;
}

// ---- Core promotion tests ----

describe("promoteProposal — basic promotion", () => {
  let root: string;
  beforeEach(async () => { root = await makeTempRoot(); });
  afterEach(async () => { await cleanupRoot(root); });

  it("moves proposal to correct destination and removes source", async () => {
    const proposalPath = path.join(root, ".apex", "proposed", "test-gotcha.md");
    await fs.writeFile(proposalPath, makeGotchaContent("test-gotcha"), "utf8");

    const result = await promoteProposal(root, proposalPath);

    expect(result.status).toBe("promoted");
    const expectedDest = path.join(root, ".apex", "knowledge", "gotchas", "test-gotcha.md");
    expect(result.destPath).toBe(expectedDest);

    // Destination file now exists.
    const destStat = await fs.stat(expectedDest);
    expect(destStat.isFile()).toBe(true);

    // Source file was removed.
    await expect(fs.access(proposalPath)).rejects.toThrow();
  });

  it("promotes a convention to conventions/ directory", async () => {
    const proposalPath = path.join(root, ".apex", "proposed", "test-convention.md");
    await fs.writeFile(proposalPath, makeConventionContent("test-convention"), "utf8");

    const result = await promoteProposal(root, proposalPath);
    expect(result.status).toBe("promoted");
    expect(result.destPath).toContain("conventions");
    expect(result.destPath).toContain("test-convention.md");
  });

  it("updates last_validated to today on promote", async () => {
    const pastDate = "2026-01-01";
    // created must be <= last_validated, so set both to pastDate in the proposal.
    const content = makeGotchaContent("test-gotcha", {
      created: pastDate,
      last_validated: pastDate,
    });
    const proposalPath = path.join(root, ".apex", "proposed", "test-gotcha.md");
    await fs.writeFile(proposalPath, content, "utf8");

    const result = await promoteProposal(root, proposalPath);
    expect(result.status).toBe("promoted");

    const destContent = await fs.readFile(result.destPath!, "utf8");
    const parsed = matter(destContent, matterOptions);
    expect(parsed.data["last_validated"]).toBe(TODAY);
  });

  it("strips the PROPOSED header before writing to destination", async () => {
    const withHeader =
      "<!-- PROPOSED — review before moving to .apex/knowledge/ -->\n" +
      makeGotchaContent("test-gotcha");
    const proposalPath = path.join(root, ".apex", "proposed", "test-gotcha.md");
    await fs.writeFile(proposalPath, withHeader, "utf8");

    const result = await promoteProposal(root, proposalPath);
    expect(result.status).toBe("promoted");

    const destContent = await fs.readFile(result.destPath!, "utf8");
    expect(destContent).not.toContain("<!-- PROPOSED");
  });

  it("preserves the body content in the destination file", async () => {
    const proposalPath = path.join(root, ".apex", "proposed", "test-gotcha.md");
    await fs.writeFile(proposalPath, makeGotchaContent("test-gotcha"), "utf8");

    const result = await promoteProposal(root, proposalPath);
    const destContent = await fs.readFile(result.destPath!, "utf8");
    expect(destContent).toContain("Body content.");
  });
});

// ---- Conflict / force tests ----

describe("promoteProposal — conflict and force", () => {
  let root: string;
  beforeEach(async () => { root = await makeTempRoot(); });
  afterEach(async () => { await cleanupRoot(root); });

  it("refuses to overwrite existing destination by default", async () => {
    const id = "existing-gotcha";
    const content = makeGotchaContent(id);
    const proposalPath = path.join(root, ".apex", "proposed", `${id}.md`);
    const destPath = path.join(root, ".apex", "knowledge", "gotchas", `${id}.md`);

    await fs.writeFile(proposalPath, content, "utf8");
    await fs.writeFile(destPath, content, "utf8");

    const result = await promoteProposal(root, proposalPath);
    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/destination exists/i);

    // Source file should still exist.
    const srcStat = await fs.stat(proposalPath);
    expect(srcStat.isFile()).toBe(true);
  });

  it("overwrites existing destination when force === true", async () => {
    const id = "force-overwrite";
    const originalContent = makeGotchaContent(id);
    const proposalPath = path.join(root, ".apex", "proposed", `${id}.md`);
    const destPath = path.join(root, ".apex", "knowledge", "gotchas", `${id}.md`);

    await fs.writeFile(proposalPath, originalContent, "utf8");
    // Write a different file at destination.
    await fs.writeFile(destPath, "Old content", "utf8");

    const result = await promoteProposal(root, proposalPath, { force: true });
    expect(result.status).toBe("promoted");

    const newContent = await fs.readFile(destPath, "utf8");
    expect(newContent).toContain("force-overwrite"); // id from the proposal frontmatter
    expect(newContent).not.toBe("Old content");
  });
});

// ---- Validation failure tests ----

describe("promoteProposal — validation failure", () => {
  let root: string;
  beforeEach(async () => { root = await makeTempRoot(); });
  afterEach(async () => { await cleanupRoot(root); });

  it("returns error status when frontmatter is invalid", async () => {
    const bad = "Not a valid proposal.\n";
    const proposalPath = path.join(root, ".apex", "proposed", "bad-proposal.md");
    await fs.writeFile(proposalPath, bad, "utf8");

    const result = await promoteProposal(root, proposalPath);
    expect(result.status).toBe("error");
    expect(result.reason).toBeDefined();
  });

  it("returns error status when required field is missing", async () => {
    const missingSymptom = makeGotchaContent("no-symptom").replace(/^symptom:.*$/m, "");
    const proposalPath = path.join(root, ".apex", "proposed", "no-symptom.md");
    await fs.writeFile(proposalPath, missingSymptom, "utf8");

    const result = await promoteProposal(root, proposalPath);
    expect(result.status).toBe("error");
    expect(result.reason).toMatch(/symptom/i);
  });
});

// ---- validateProposal (file-based) tests ----

describe("validateProposal", () => {
  let root: string;
  beforeEach(async () => { root = await makeTempRoot(); });
  afterEach(async () => { await cleanupRoot(root); });

  it("validates a well-formed proposal file", async () => {
    const proposalPath = path.join(root, ".apex", "proposed", "valid.md");
    await fs.writeFile(proposalPath, makeGotchaContent("valid"), "utf8");
    const result = await validateProposal(proposalPath);
    expect(result.valid).toBe(true);
  });

  it("returns an error for a missing file", async () => {
    const result = await validateProposal("/nonexistent/path/missing.md");
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toMatch(/could not read/i);
  });
});

// ---- autoPromoteAll tests ----

describe("autoPromoteAll", () => {
  let root: string;
  beforeEach(async () => { root = await makeTempRoot(); });
  afterEach(async () => { await cleanupRoot(root); });

  it("promotes eligible proposals and queues ineligible ones", async () => {
    // Eligible: 2 sources.
    await fs.writeFile(
      path.join(root, ".apex", "proposed", "eligible.md"),
      makeGotchaContent("eligible"),
      "utf8",
    );
    // Ineligible: only 1 source (below threshold of 2).
    await fs.writeFile(
      path.join(root, ".apex", "proposed", "ineligible.md"),
      makeGotchaContent("ineligible", {
        sources: [{ kind: "bootstrap", ref: "a" }],
      }),
      "utf8",
    );

    const config: ApexConfig = { auto_merge: { enabled: true, threshold: 2, require_no_conflict: true, min_confidence: "low" } };
    await saveConfig(root, config);

    const report = await autoPromoteAll(root);

    expect(report.promoted.length).toBe(1);
    expect(report.promoted[0].status).toBe("promoted");
    expect(report.promoted[0].proposalPath).toContain("eligible.md");

    expect(report.queued.length).toBe(1);
    expect(report.queued[0].proposalPath).toContain("ineligible.md");
  });

  it("returns empty when auto_merge.enabled is false", async () => {
    await fs.writeFile(
      path.join(root, ".apex", "proposed", "some-entry.md"),
      makeGotchaContent("some-entry"),
      "utf8",
    );

    const config: ApexConfig = { auto_merge: { enabled: false, threshold: 1, require_no_conflict: true, min_confidence: "low" } };
    await saveConfig(root, config);

    const report = await autoPromoteAll(root);
    expect(report.promoted).toHaveLength(0);
    expect(report.queued).toHaveLength(0);
  });
});

// ---- findProposalById tests ----

describe("findProposalById", () => {
  let root: string;
  beforeEach(async () => { root = await makeTempRoot(); });
  afterEach(async () => { await cleanupRoot(root); });

  it("finds a proposal by id", async () => {
    await fs.writeFile(
      path.join(root, ".apex", "proposed", "my-gotcha.md"),
      makeGotchaContent("my-gotcha"),
      "utf8",
    );
    const found = await findProposalById(root, "my-gotcha");
    expect(found).not.toBeNull();
    expect(found!).toContain("my-gotcha.md");
  });

  it("returns null when not found", async () => {
    const found = await findProposalById(root, "nonexistent-id");
    expect(found).toBeNull();
  });

  it("finds a file with leading underscore by stripping it", async () => {
    await fs.writeFile(
      path.join(root, ".apex", "proposed", "_my-gotcha.md"),
      makeGotchaContent("my-gotcha"),
      "utf8",
    );
    const found = await findProposalById(root, "my-gotcha");
    expect(found).not.toBeNull();
  });
});
