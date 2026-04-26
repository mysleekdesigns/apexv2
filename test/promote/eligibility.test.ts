import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import yaml from "yaml";
import { findEligible } from "../../src/promote/eligibility.js";
import { getDefaults } from "../../src/config/index.js";
import type { ApexConfig } from "../../src/config/index.js";

const TODAY = new Date().toISOString().slice(0, 10);

async function makeTempRoot(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "apex-eligibility-test-"));
  await fs.mkdir(path.join(base, ".apex", "proposed"), { recursive: true });
  await fs.mkdir(path.join(base, ".apex", "knowledge", "gotchas"), { recursive: true });
  await fs.mkdir(path.join(base, ".apex", "knowledge", "conventions"), { recursive: true });
  await fs.mkdir(path.join(base, ".apex", "knowledge", "decisions"), { recursive: true });
  await fs.mkdir(path.join(base, ".apex", "knowledge", "patterns"), { recursive: true });
  return base;
}

async function cleanupRoot(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

function makeProposalContent(
  overrides: Record<string, unknown> = {},
  type: "gotcha" | "convention" | "decision" | "pattern" = "gotcha",
): string {
  const baseFields: Record<string, unknown> = {
    id: "test-gotcha",
    type,
    title: "Test entry",
    applies_to: "all",
    confidence: "low",
    sources: [
      { kind: "bootstrap", ref: "episode/2026-04-20/turn-1" },
      { kind: "reflection", ref: "episode/2026-04-21/turn-2" },
    ],
    created: TODAY,
    last_validated: TODAY,
    ...(type === "gotcha"
      ? { symptom: "Something breaks", resolution: "Fix it" }
      : type === "convention"
        ? { rule: "Always do X", enforcement: "manual" }
        : type === "decision"
          ? { decision: "Use X", rationale: "Because", outcome: "Works" }
          : { intent: "Reuse this", applies_when: ["when X"] }),
    ...overrides,
  };

  const fmYaml = yaml.stringify(baseFields, { lineWidth: 0 }).trimEnd();
  return `---\n${fmYaml}\n---\n\nBody here.\n`;
}

async function writeProposal(
  root: string,
  id: string,
  content: string,
): Promise<string> {
  const p = path.join(root, ".apex", "proposed", `${id}.md`);
  await fs.writeFile(p, content, "utf8");
  return p;
}

async function writeKnowledge(
  root: string,
  typeDir: string,
  id: string,
  content: string,
): Promise<void> {
  const p = path.join(root, ".apex", "knowledge", typeDir, `${id}.md`);
  await fs.writeFile(p, content, "utf8");
}

describe("findEligible — threshold rule", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("marks eligible when sources.length >= threshold", async () => {
    const content = makeProposalContent({
      id: "my-gotcha",
      sources: [
        { kind: "bootstrap", ref: "a" },
        { kind: "reflection", ref: "b" },
      ],
    });
    await writeProposal(root, "my-gotcha", content);

    const config = getDefaults(); // threshold = 2
    const results = await findEligible(root, config);
    expect(results).toHaveLength(1);
    expect(results[0].eligible).toBe(true);
  });

  it("marks ineligible when sources.length < threshold", async () => {
    const content = makeProposalContent({
      id: "my-gotcha",
      sources: [{ kind: "bootstrap", ref: "a" }], // only 1
    });
    await writeProposal(root, "my-gotcha", content);

    const config = getDefaults(); // threshold = 2
    const results = await findEligible(root, config);
    expect(results[0].eligible).toBe(false);
    expect(results[0].reason).toMatch(/threshold/i);
  });

  it("marks eligible when threshold is 1 and sources.length === 1", async () => {
    const content = makeProposalContent({
      id: "my-gotcha",
      sources: [{ kind: "bootstrap", ref: "a" }],
    });
    await writeProposal(root, "my-gotcha", content);

    const config: ApexConfig = {
      ...getDefaults(),
      auto_merge: { ...getDefaults().auto_merge, threshold: 1 },
    };
    const results = await findEligible(root, config);
    expect(results[0].eligible).toBe(true);
  });
});

describe("findEligible — confidence rule", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("marks ineligible when confidence is below min_confidence", async () => {
    const content = makeProposalContent({ id: "low-conf", confidence: "low" });
    await writeProposal(root, "low-conf", content);

    const config: ApexConfig = {
      ...getDefaults(),
      auto_merge: { ...getDefaults().auto_merge, min_confidence: "medium" },
    };
    const results = await findEligible(root, config);
    expect(results[0].eligible).toBe(false);
    expect(results[0].reason).toMatch(/confidence/i);
  });

  it("marks eligible when confidence matches min_confidence exactly", async () => {
    const content = makeProposalContent({ id: "medium-conf", confidence: "medium" });
    await writeProposal(root, "medium-conf", content);

    const config: ApexConfig = {
      ...getDefaults(),
      auto_merge: { ...getDefaults().auto_merge, min_confidence: "medium" },
    };
    const results = await findEligible(root, config);
    expect(results[0].eligible).toBe(true);
  });

  it("marks eligible when confidence is above min_confidence", async () => {
    const content = makeProposalContent({ id: "high-conf", confidence: "high" });
    await writeProposal(root, "high-conf", content);

    const config: ApexConfig = {
      ...getDefaults(),
      auto_merge: { ...getDefaults().auto_merge, min_confidence: "low" },
    };
    const results = await findEligible(root, config);
    expect(results[0].eligible).toBe(true);
  });
});

describe("findEligible — conflict rule (require_no_conflict)", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("marks ineligible when the destination already exists", async () => {
    const content = makeProposalContent({ id: "existing-entry" });
    await writeProposal(root, "existing-entry", content);
    // Write a conflicting file in knowledge/gotchas/.
    await writeKnowledge(root, "gotchas", "existing-entry", content);

    const config = getDefaults();
    const results = await findEligible(root, config);
    expect(results[0].eligible).toBe(false);
    expect(results[0].reason).toMatch(/already exists/i);
  });

  it("marks ineligible when an existing entry supersedes this id", async () => {
    const proposalContent = makeProposalContent({ id: "old-gotcha" });
    await writeProposal(root, "old-gotcha", proposalContent);

    // Write a knowledge entry that supersedes "old-gotcha".
    const superseder = makeProposalContent({
      id: "new-gotcha",
      supersedes: ["old-gotcha"],
    });
    await writeKnowledge(root, "gotchas", "new-gotcha", superseder);

    const config = getDefaults();
    const results = await findEligible(root, config);
    const result = results.find((r) => r.proposalPath.includes("old-gotcha"))!;
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/supersedes/i);
  });

  it("ignores conflict when require_no_conflict is false", async () => {
    const content = makeProposalContent({ id: "existing-entry" });
    await writeProposal(root, "existing-entry", content);
    await writeKnowledge(root, "gotchas", "existing-entry", content);

    const config: ApexConfig = {
      ...getDefaults(),
      auto_merge: { ...getDefaults().auto_merge, require_no_conflict: false },
    };
    const results = await findEligible(root, config);
    // Still can be blocked by threshold but not by conflict.
    const conflictBlocked = results.find((r) =>
      r.reason?.includes("already exists"),
    );
    expect(conflictBlocked).toBeUndefined();
  });
});

describe("findEligible — misc", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("returns empty array when proposed/ directory does not exist", async () => {
    await fs.rm(path.join(root, ".apex", "proposed"), { recursive: true, force: true });
    const config = getDefaults();
    const results = await findEligible(root, config);
    expect(results).toHaveLength(0);
  });

  it("skips files starting with underscore", async () => {
    const content = makeProposalContent({ id: "pending-stack" });
    const p = path.join(root, ".apex", "proposed", "_pending-stack.md");
    await fs.writeFile(p, content, "utf8");
    const config = getDefaults();
    const results = await findEligible(root, config);
    expect(results).toHaveLength(0);
  });

  it("marks ineligible with invalid frontmatter", async () => {
    await writeProposal(root, "bad-file", "Not a valid frontmatter file.\n");
    const config = getDefaults();
    const results = await findEligible(root, config);
    expect(results[0].eligible).toBe(false);
    expect(results[0].reason).toMatch(/frontmatter/i);
  });

  it("reports per-proposal reasons", async () => {
    // One eligible, one not.
    const eligible = makeProposalContent({
      id: "eligible-one",
      sources: [
        { kind: "bootstrap", ref: "a" },
        { kind: "reflection", ref: "b" },
      ],
    });
    const notEligible = makeProposalContent({
      id: "not-eligible",
      sources: [{ kind: "bootstrap", ref: "a" }],
    });
    await writeProposal(root, "eligible-one", eligible);
    await writeProposal(root, "not-eligible", notEligible);

    const config = getDefaults();
    const results = await findEligible(root, config);
    expect(results).toHaveLength(2);
    const e = results.find((r) => r.proposalPath.includes("eligible-one"))!;
    const n = results.find((r) => r.proposalPath.includes("not-eligible"))!;
    expect(e.eligible).toBe(true);
    expect(n.eligible).toBe(false);
    expect(n.reason).toBeDefined();
  });

  it("strips the PROPOSED header before validating", async () => {
    const fmContent = makeProposalContent({ id: "with-header" });
    const withHeader =
      "<!-- PROPOSED — review before moving to .apex/knowledge/ -->\n" + fmContent;
    await writeProposal(root, "with-header", withHeader);

    const config = getDefaults();
    const results = await findEligible(root, config);
    expect(results[0].eligible).toBe(true);
  });
});
