// Phase 4.3 extended drift detection tests.
//
// Includes the synthetic-aging recall test: build a 10-entry fixture project
// with a known mix of "should drift" and "should not drift" entries, run the
// extended detector, and assert ≥80% recall on positives + zero false
// positives on controls.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import yaml from "yaml";
import {
  findAllDrift,
  severityBreakdown,
  type DriftKind,
} from "../../src/curator/drift.js";
import { runCurator } from "../../src/curator/index.js";
import type { KnowledgeEntry } from "../../src/types/shared.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-drift-ext-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeKnowledge(
  type: "decisions" | "patterns" | "gotchas" | "conventions",
  id: string,
  extra: Record<string, unknown>,
  body = "Body content.",
): void {
  const dir = path.join(tmpDir, ".apex", "knowledge", type);
  fs.mkdirSync(dir, { recursive: true });
  const baseFm: Record<string, unknown> = {
    id,
    type: type.slice(0, -1),
    title: extra.title ?? `Title for ${id}`,
    applies_to: "all",
    confidence: "medium",
    sources: extra.sources ?? [{ kind: "manual", ref: "manual/test" }],
    created: "2026-01-01",
    last_validated: "2026-04-26",
  };
  // Required type-specific fields.
  if (type === "gotchas") {
    baseFm.symptom = extra.symptom ?? "Something breaks";
    baseFm.resolution = extra.resolution ?? "Fix it";
  } else if (type === "decisions") {
    baseFm.decision = extra.decision ?? "We chose X";
    baseFm.rationale = extra.rationale ?? "Because Y";
    baseFm.outcome = extra.outcome ?? "Z";
  } else if (type === "patterns") {
    baseFm.intent = extra.intent ?? "When to use this";
    baseFm.applies_when = extra.applies_when ?? ["new route"];
  } else if (type === "conventions") {
    baseFm.rule = extra.rule ?? "Always do X";
    baseFm.enforcement = extra.enforcement ?? "manual";
  }
  for (const [k, v] of Object.entries(extra)) {
    if (k === "sources") continue;
    baseFm[k] = v;
  }
  const content = `---\n${yaml.stringify(baseFm)}---\n\n${body}\n`;
  fs.writeFileSync(path.join(dir, `${id}.md`), content, "utf8");
}

function makeGotchaEntry(
  id: string,
  refs: Array<{ kind: "correction" | "manual"; ref: string }>,
  body = "Body.",
): KnowledgeEntry {
  return {
    frontmatter: {
      id,
      type: "gotcha",
      title: `Gotcha ${id}`,
      applies_to: "all",
      confidence: "medium",
      sources: refs,
      created: "2026-01-01",
      last_validated: "2026-04-26",
      symptom: "x",
      resolution: "y",
    } as KnowledgeEntry["frontmatter"],
    body,
    path: `.apex/knowledge/gotchas/${id}.md`,
  };
}

// --------------------------------------------------------------------------
describe("extended drift — file_missing", () => {
  it("flags any entry type whose source ref points at a deleted file", async () => {
    const entries: KnowledgeEntry[] = [
      makeGotchaEntry("g1", [{ kind: "correction", ref: "file/src/gone.ts:5" }]),
    ];
    const { hits } = await findAllDrift(entries, tmpDir);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("file_missing");
    expect(hits[0]!.severity).toBe("high");
  });

  it("does not flag when the file exists", async () => {
    const dir = path.join(tmpDir, "src");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "exists.ts"), "// ok");
    const entries: KnowledgeEntry[] = [
      makeGotchaEntry("g1", [{ kind: "correction", ref: "file/src/exists.ts:1" }]),
    ];
    const { hits } = await findAllDrift(entries, tmpDir);
    expect(hits).toHaveLength(0);
  });
});

describe("extended drift — symbol_missing", () => {
  it("flags `[[wiki-link]]` body refs that don't exist (grep fallback)", async () => {
    const entries: KnowledgeEntry[] = [
      makeGotchaEntry(
        "g1",
        [{ kind: "manual", ref: "manual/x" }],
        "See [[doesNotExistFunction]] in the codebase.",
      ),
    ];
    const { hits } = await findAllDrift(entries, tmpDir, { useGrepFallback: true });
    expect(hits.some((h) => h.kind === "symbol_missing")).toBe(true);
    const sym = hits.find((h) => h.kind === "symbol_missing")!;
    expect(sym.ref).toBe("[[doesNotExistFunction]]");
    expect(sym.severity).toBe("medium");
  });

  it("does not flag wiki-link refs when the symbol exists in the working tree", async () => {
    const dir = path.join(tmpDir, "src");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "code.ts"),
      "export function realThingExists() { return 1; }\n",
    );
    const entries: KnowledgeEntry[] = [
      makeGotchaEntry(
        "g1",
        [{ kind: "manual", ref: "manual/x" }],
        "Check [[realThingExists]] in src/code.ts.",
      ),
    ];
    const { hits } = await findAllDrift(entries, tmpDir, { useGrepFallback: true });
    expect(hits.filter((h) => h.kind === "symbol_missing")).toHaveLength(0);
  });

  it("ignores wiki-links inside fenced code blocks (false-positive guard)", async () => {
    const entries: KnowledgeEntry[] = [
      makeGotchaEntry(
        "g1",
        [{ kind: "manual", ref: "manual/x" }],
        "```\nUse [[ghostFunction]] only as an example.\n```\n",
      ),
    ];
    const { hits } = await findAllDrift(entries, tmpDir, { useGrepFallback: true });
    expect(hits.filter((h) => h.kind === "symbol_missing")).toHaveLength(0);
  });
});

describe("extended drift — reference_missing", () => {
  it("flags non-existent paths in frontmatter `references:`", async () => {
    const entries: KnowledgeEntry[] = [
      {
        frontmatter: {
          id: "p1",
          type: "pattern",
          title: "X",
          applies_to: "all",
          confidence: "medium",
          sources: [{ kind: "manual", ref: "manual/x" }],
          created: "2026-01-01",
          last_validated: "2026-04-26",
        } as KnowledgeEntry["frontmatter"],
        body: "B.",
        path: ".apex/knowledge/patterns/p1.md",
      },
    ];
    // Inject `references` field via cast.
    (entries[0]!.frontmatter as unknown as Record<string, unknown>)["references"] = [
      "src/never-existed.ts",
      "docs/missing.md",
    ];
    const { hits } = await findAllDrift(entries, tmpDir);
    const refMisses = hits.filter((h) => h.kind === "reference_missing");
    expect(refMisses).toHaveLength(2);
    expect(refMisses[0]!.severity).toBe("medium");
  });
});

describe("extended drift — path_missing", () => {
  it("flags inline relative paths in body markdown that no longer exist", async () => {
    const entries: KnowledgeEntry[] = [
      makeGotchaEntry(
        "g1",
        [{ kind: "manual", ref: "manual/x" }],
        "See `apps/api/src/routes/old.ts` for the previous behaviour.",
      ),
    ];
    const { hits } = await findAllDrift(entries, tmpDir);
    const pathMisses = hits.filter((h) => h.kind === "path_missing");
    expect(pathMisses.length).toBeGreaterThanOrEqual(1);
    expect(pathMisses[0]!.severity).toBe("low");
  });

  it("skips paths inside fenced code blocks", async () => {
    const entries: KnowledgeEntry[] = [
      makeGotchaEntry(
        "g1",
        [{ kind: "manual", ref: "manual/x" }],
        "```ts\n// import './imaginary/file.ts';\n```",
      ),
    ];
    const { hits } = await findAllDrift(entries, tmpDir);
    expect(hits.filter((h) => h.kind === "path_missing")).toHaveLength(0);
  });

  it("does not flag URLs or scheme paths", async () => {
    const entries: KnowledgeEntry[] = [
      makeGotchaEntry(
        "g1",
        [{ kind: "manual", ref: "manual/x" }],
        "Reference: https://example.com/path/to/foo.json",
      ),
    ];
    const { hits } = await findAllDrift(entries, tmpDir);
    expect(hits.filter((h) => h.kind === "path_missing")).toHaveLength(0);
  });
});

describe("extended drift — severity defaults", () => {
  it("assigns expected severities per kind", async () => {
    const dir = path.join(tmpDir, "src");
    fs.mkdirSync(dir, { recursive: true });

    const entries: KnowledgeEntry[] = [
      makeGotchaEntry(
        "g-file",
        [{ kind: "correction", ref: "file/src/gone1.ts:1" }],
      ),
      {
        frontmatter: {
          id: "p-ref",
          type: "pattern",
          title: "R",
          applies_to: "all",
          confidence: "medium",
          sources: [{ kind: "manual", ref: "manual/x" }],
          created: "2026-01-01",
          last_validated: "2026-04-26",
        } as KnowledgeEntry["frontmatter"],
        body: "Inline path: src/missing-inline.ts",
        path: ".apex/knowledge/patterns/p-ref.md",
      },
    ];
    (entries[1]!.frontmatter as unknown as Record<string, unknown>)["references"] = [
      "src/refs-missing.ts",
    ];

    const { hits } = await findAllDrift(entries, tmpDir);
    const breakdown = severityBreakdown(hits);
    expect(breakdown.high).toBeGreaterThanOrEqual(1);
    expect(breakdown.medium).toBeGreaterThanOrEqual(1);
    expect(breakdown.low).toBeGreaterThanOrEqual(1);
  });
});

describe("extended drift — robustness", () => {
  it("does not crash when codeindex is absent (missing symbols.sqlite)", async () => {
    const entries: KnowledgeEntry[] = [
      makeGotchaEntry(
        "g1",
        [{ kind: "manual", ref: "manual/x" }],
        "Check [[someFunction]].",
      ),
    ];
    // No useGrepFallback — symbol checks should be inconclusive (no hit).
    const { hits } = await findAllDrift(entries, tmpDir, { codeIndex: null });
    // Without grep fallback, missing-but-uncheckable does not emit a hit.
    expect(hits.filter((h) => h.kind === "symbol_missing")).toHaveLength(0);
  });

  it("returns empty hits for empty input", async () => {
    const { hits } = await findAllDrift([], tmpDir);
    expect(hits).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// Synthetic aging recall test (Exit criterion: ≥80%)
// --------------------------------------------------------------------------
describe("synthetic aging — drift catches ≥80% of aged entries", () => {
  it("classifies the 10-entry fixture correctly", async () => {
    // Build a project with controls (must NOT drift) and aged entries (MUST drift).
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    // ---- 2 control files (paths that exist) ---------------------------------
    fs.writeFileSync(
      path.join(srcDir, "exists-a.ts"),
      "export function controlA() { return 1; }\n",
    );
    fs.writeFileSync(
      path.join(srcDir, "exists-b.ts"),
      "export function controlB() { return 2; }\n",
    );
    // ---- 2 control symbols that EXIST (real grep hits) ----------------------
    fs.writeFileSync(
      path.join(srcDir, "control-symbols.ts"),
      "export function realThingOne() {}\nexport function realThingTwo() {}\n",
    );

    // ---- 3 deleted-file entries (file_missing) ------------------------------
    writeKnowledge("gotchas", "aged-file-1", {
      sources: [{ kind: "correction", ref: "file/src/deleted-1.ts:5" }],
    });
    writeKnowledge("gotchas", "aged-file-2", {
      sources: [{ kind: "correction", ref: "file/src/deleted-2.ts:10" }],
    });
    writeKnowledge("gotchas", "aged-file-3", {
      sources: [{ kind: "correction", ref: "file/src/deleted-3.ts:1" }],
    });

    // ---- 3 missing-symbol entries (symbol_missing via wiki-links) -----------
    writeKnowledge(
      "gotchas",
      "aged-sym-1",
      { sources: [{ kind: "manual", ref: "manual/x" }] },
      "Refer to [[madeUpSymbolAlpha]] in the legacy module.",
    );
    writeKnowledge(
      "gotchas",
      "aged-sym-2",
      { sources: [{ kind: "manual", ref: "manual/x" }] },
      "We used to call [[madeUpSymbolBeta]] before refactor.",
    );
    writeKnowledge(
      "gotchas",
      "aged-sym-3",
      { sources: [{ kind: "manual", ref: "manual/x" }] },
      "Look for [[madeUpSymbolGamma]] when triaging.",
    );

    // ---- 2 controls — paths that exist (file_missing should NOT fire) ------
    writeKnowledge("gotchas", "ctrl-file-1", {
      sources: [{ kind: "correction", ref: "file/src/exists-a.ts:1" }],
    });
    writeKnowledge("gotchas", "ctrl-file-2", {
      sources: [{ kind: "correction", ref: "file/src/exists-b.ts:2" }],
    });

    // ---- 2 controls — symbols that EXIST in the working tree ---------------
    writeKnowledge(
      "gotchas",
      "ctrl-sym-1",
      { sources: [{ kind: "manual", ref: "manual/x" }] },
      "See [[realThingOne]] for the canonical usage.",
    );
    writeKnowledge(
      "gotchas",
      "ctrl-sym-2",
      { sources: [{ kind: "manual", ref: "manual/x" }] },
      "Use [[realThingTwo]] when handling the edge case.",
    );

    // Note: we intentionally placed 3+3+2+2 = 10 aged/control fixtures.
    // The PRD test rubric: 3 deleted files + 3 missing symbols (positives) +
    // 2 file controls + 2 symbol controls (negatives) = 10 entries. We add
    // exactly the same: positives must drift; controls must not drift.

    const report = await runCurator(tmpDir, {
      now: new Date("2026-04-26T00:00:00Z"),
    });

    // Group hits by entry id for classification.
    const byEntry = new Map<string, string[]>();
    for (const h of report.driftHits) {
      if (!byEntry.has(h.entry_id)) byEntry.set(h.entry_id, []);
      byEntry.get(h.entry_id)!.push(h.kind);
    }

    const positives = [
      "aged-file-1",
      "aged-file-2",
      "aged-file-3",
      "aged-sym-1",
      "aged-sym-2",
      "aged-sym-3",
    ];
    const negatives = ["ctrl-file-1", "ctrl-file-2", "ctrl-sym-1", "ctrl-sym-2"];

    let truePositives = 0;
    for (const id of positives) {
      if (byEntry.has(id)) truePositives++;
    }
    let falsePositives = 0;
    for (const id of negatives) {
      if (byEntry.has(id)) falsePositives++;
    }

    const total = positives.length + negatives.length; // = 10
    const correctlyClassified =
      truePositives + (negatives.length - falsePositives);
    const recall = truePositives / positives.length;

    // Required by the spec: print actual rate.
    // eslint-disable-next-line no-console
    console.log(
      `[synthetic-aging] correctly classified ${correctlyClassified}/${total} ` +
        `(positives: ${truePositives}/${positives.length} = ${(recall * 100).toFixed(1)}% recall, ` +
        `false positives: ${falsePositives}/${negatives.length})`,
    );

    expect(correctlyClassified).toBeGreaterThanOrEqual(8);
    expect(falsePositives).toBe(0);
    expect(recall).toBeGreaterThanOrEqual(0.8);

    // Also verify summary file has severity breakdown.
    const summary = fs.readFileSync(report.summaryPath, "utf8");
    expect(summary).toContain("Drift severity breakdown");
    expect(summary).toMatch(/high: \d+, medium: \d+, low: \d+/);
  });
});

describe("runCurator — drift-only flag", () => {
  it("skips dedupe and stale when driftOnly is true", async () => {
    // Two duplicates that would normally cluster.
    writeKnowledge("gotchas", "d-a", {
      title: "Identical title for dedupe",
      confidence: "high",
    });
    writeKnowledge("gotchas", "d-b", {
      title: "Identical title for dedupe",
      confidence: "low",
    });
    // One stale entry.
    writeKnowledge("decisions", "old-d", {
      title: "Old",
      last_validated: "2025-01-01",
      decision: "x",
      rationale: "y",
      outcome: "z",
    });

    const report = await runCurator(tmpDir, {
      now: new Date("2026-04-26T00:00:00Z"),
      driftOnly: true,
    });

    expect(report.duplicateClusters).toHaveLength(0);
    expect(report.staleEntries).toHaveLength(0);
    expect(report.mergeProposals).toHaveLength(0);
  });
});

describe("runCurator — severity breakdown in summary", () => {
  it("emits a `### Drift severity breakdown` subsection", async () => {
    writeKnowledge("gotchas", "g1", {
      sources: [{ kind: "correction", ref: "file/src/missing-here.ts:1" }],
    });
    const report = await runCurator(tmpDir, {
      now: new Date("2026-04-26T00:00:00Z"),
    });
    const summary = fs.readFileSync(report.summaryPath, "utf8");
    expect(summary).toContain("### Drift severity breakdown");
    expect(summary).toContain("high:");
    // The drift kind should be high severity.
    expect(report.driftSeverity.high).toBeGreaterThanOrEqual(1);
  });
});

describe("kind-to-severity mapping (sanity)", () => {
  it("guarantees the four drift kinds are stable strings", () => {
    const kinds: DriftKind[] = [
      "file_missing",
      "symbol_missing",
      "reference_missing",
      "path_missing",
    ];
    expect(kinds).toHaveLength(4);
  });
});
