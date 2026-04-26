import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import yaml from "yaml";
import {
  buildReviewModel,
  renderMarkdown,
  renderJson,
  type ReviewModel,
} from "../../src/review/diff.js";
import { runReview } from "../../src/review/cli.js";

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-review-"));
  // Seed minimal .apex layout.
  await fs.ensureDir(path.join(tmp, ".apex", "proposed"));
  await fs.ensureDir(path.join(tmp, ".apex", "knowledge", "decisions"));
  await fs.ensureDir(path.join(tmp, ".apex", "knowledge", "patterns"));
  await fs.ensureDir(path.join(tmp, ".apex", "knowledge", "gotchas"));
  await fs.ensureDir(path.join(tmp, ".apex", "knowledge", "conventions"));
});

afterEach(async () => {
  await fs.remove(tmp).catch(() => {});
});

function writeProposal(
  id: string,
  type: "decision" | "pattern" | "gotcha" | "convention",
  extra: Record<string, unknown> = {},
  body = "Body content for proposal.",
): string {
  const proposed = path.join(tmp, ".apex", "proposed");
  const fm: Record<string, unknown> = {
    id,
    type,
    title: `Title of ${id}`,
    applies_to: "all",
    confidence: "medium",
    sources: [
      { kind: "manual", ref: "manual/test-1" },
      { kind: "manual", ref: "manual/test-2" },
    ],
    created: "2026-04-01",
    last_validated: "2026-04-26",
    ...extra,
  };
  // Add per-type required fields.
  if (type === "decision") {
    fm["decision"] = "Make a choice.";
    fm["rationale"] = "Reasoning.";
    fm["outcome"] = "Pending.";
  } else if (type === "pattern") {
    fm["intent"] = "Avoid duplication.";
    fm["applies_when"] = ["When adding a route"];
  } else if (type === "gotcha") {
    fm["symptom"] = "Symptom string.";
    fm["resolution"] = "Resolution string.";
  } else if (type === "convention") {
    fm["rule"] = "Always do X.";
    fm["enforcement"] = "manual";
  }
  const file = path.join(proposed, `${id}.md`);
  const content = `<!-- PROPOSED -->\n---\n${yaml.stringify(fm)}---\n\n${body}\n`;
  fs.writeFileSync(file, content, "utf8");
  return file;
}

describe("buildReviewModel", () => {
  it("returns an empty model when nothing is proposed", async () => {
    const m = await buildReviewModel({ root: tmp });
    expect(m.proposals).toEqual([]);
    expect(m.promoted).toEqual([]);
    expect(m.queued).toEqual([]);
    expect(m.lintRequested).toBe(false);
  });

  it("classifies proposals as promoted vs queued via findEligible", async () => {
    writeProposal("ok-decision", "decision");
    writeProposal("low-conf", "convention", { confidence: "low" });
    // proposal with only 1 source — below threshold (default 2).
    writeProposal("thin", "convention", {
      sources: [{ kind: "manual", ref: "manual/only-one" }],
    });
    const m = await buildReviewModel({ root: tmp });
    expect(m.proposals.length).toBe(3);
    const ids = m.proposals.map((p) => p.id).sort();
    expect(ids).toEqual(["low-conf", "ok-decision", "thin"]);
    const promotedIds = m.promoted.map((p) => p.id);
    expect(promotedIds).toContain("ok-decision");
    expect(promotedIds).not.toContain("thin");
  });

  it("ignores files starting with underscore (e.g. _pending-stack.md)", async () => {
    writeProposal("real", "convention");
    fs.writeFileSync(
      path.join(tmp, ".apex", "proposed", "_pending-stack.md"),
      "<!-- PROPOSED -->\nignored\n",
    );
    const m = await buildReviewModel({ root: tmp });
    expect(m.proposals.map((p) => p.id)).toEqual(["real"]);
  });

  it("populates lint warnings only when lint=true", async () => {
    fs.writeFileSync(
      path.join(tmp, ".apex", "knowledge", "conventions", "bad.md"),
      "---\nid: bad\ntype: convention\napplies_to: nope\n---\nbody\n",
    );
    const m1 = await buildReviewModel({ root: tmp });
    expect(m1.lint).toEqual([]);
    expect(m1.lintRequested).toBe(false);
    const m2 = await buildReviewModel({ root: tmp, lint: true });
    expect(m2.lintRequested).toBe(true);
    expect(m2.lint.length).toBeGreaterThan(0);
  });
});

describe("renderMarkdown", () => {
  it("renders an empty-state message when no proposals", async () => {
    const m = await buildReviewModel({ root: tmp });
    const md = renderMarkdown(m);
    expect(md).toContain("APEX knowledge review");
    expect(md).toContain("No pending proposals");
  });

  it("renders summary table and per-type promoted sections", async () => {
    writeProposal("d1", "decision");
    writeProposal("p1", "pattern");
    writeProposal("c1", "convention");
    const m = await buildReviewModel({ root: tmp });
    const md = renderMarkdown(m);
    expect(md).toContain("## Summary");
    expect(md).toContain("Would promote");
    expect(md).toMatch(/### Decisions \(1\)/);
    expect(md).toMatch(/### Patterns \(1\)/);
    expect(md).toMatch(/### Conventions \(1\)/);
    expect(md).toContain("`d1`");
  });

  it("renders queued section with per-row reason", async () => {
    writeProposal("thin", "convention", {
      sources: [{ kind: "manual", ref: "manual/only-one" }],
    });
    const m = await buildReviewModel({ root: tmp });
    const md = renderMarkdown(m);
    expect(md).toContain("Queued for review");
    expect(md).toContain("`thin`");
    expect(md).toMatch(/below threshold/);
  });

  it("includes lint section when lint requested", async () => {
    fs.writeFileSync(
      path.join(tmp, ".apex", "knowledge", "conventions", "bad.md"),
      "---\nid: bad\ntype: convention\napplies_to: nope\n---\nbody\n",
    );
    const m = await buildReviewModel({ root: tmp, lint: true });
    const md = renderMarkdown(m);
    expect(md).toContain("## Lint");
    expect(md).toContain("`bad`");
  });

  it("escapes pipe characters in titles", async () => {
    writeProposal("piped", "convention", { title: "left | right" });
    const m = await buildReviewModel({ root: tmp });
    const md = renderMarkdown(m);
    expect(md).toContain("left \\| right");
  });
});

describe("renderJson", () => {
  it("returns counts and proposal entries", async () => {
    writeProposal("ok", "convention");
    const m = await buildReviewModel({ root: tmp });
    const j = renderJson(m);
    expect(j.total).toBe(1);
    expect(j.promoted + j.queued).toBe(1);
    expect(j.proposals[0]!.id).toBe("ok");
  });
});

describe("runReview (CLI glue)", () => {
  it("returns Markdown by default", async () => {
    writeProposal("ok", "convention");
    const r = await runReview({ cwd: tmp });
    expect(r.rendered).toContain("# APEX knowledge review");
    expect(r.json).toBeUndefined();
  });

  it("returns JSON when --json", async () => {
    writeProposal("ok", "convention");
    const r = await runReview({ cwd: tmp, json: true });
    expect(r.json).toBeDefined();
    const parsed = JSON.parse(r.rendered) as { total: number };
    expect(parsed.total).toBe(1);
  });

  it("writes to --out when provided", async () => {
    writeProposal("ok", "convention");
    const r = await runReview({ cwd: tmp, out: "review.md" });
    expect(r.writtenTo).toBe(path.resolve(tmp, "review.md"));
    const content = await fs.readFile(r.writtenTo!, "utf8");
    expect(content).toContain("APEX knowledge review");
  });

  it("typeof model.proposals matches what was on disk", async () => {
    writeProposal("a", "decision");
    writeProposal("b", "pattern");
    const r = await runReview({ cwd: tmp });
    const model: ReviewModel = r.model;
    expect(model.proposals.map((p) => p.type).sort()).toEqual([
      "decision",
      "pattern",
    ]);
  });
});
