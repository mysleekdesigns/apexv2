// Unit tests for src/prmining/proposer.ts
//
// Pure tests — feed in Candidate objects and assert frontmatter + body shape.
// Validates redaction was applied.

import { describe, it, expect } from "vitest";
import { proposeCandidates } from "../../src/prmining/proposer.js";
import type { Candidate } from "../../src/prmining/extractor.js";

// ---------------------------------------------------------------------------
// Helpers / validators
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
}

function makeGotchaCandidate(
  title = "Fix: null pointer in parser",
  primaryRef = "commit/abc1234",
  overrides: Partial<Candidate> = {},
): Candidate {
  return {
    kind: "gotcha",
    title,
    primaryRef,
    corroboratingRefs: [],
    evidence: [{ text: title, sourceRef: primaryRef }],
    files: ["src/parser.ts"],
    isHighSignal: false,
    ...overrides,
  };
}

function makeDecisionCandidate(
  title = "Decision: adopt zod for validation",
  primaryRef = "commit/def5678",
  overrides: Partial<Candidate> = {},
): Candidate {
  return {
    kind: "decision",
    title,
    primaryRef,
    corroboratingRefs: [],
    evidence: [{ text: title, sourceRef: primaryRef }],
    files: [],
    isHighSignal: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Gotcha proposals
// ---------------------------------------------------------------------------

describe("proposeCandidates — gotcha proposals", () => {
  it("produces a gotcha DraftEntry for a gotcha candidate", () => {
    const drafts = proposeCandidates([makeGotchaCandidate()]);
    expect(drafts).toHaveLength(1);
    const fm = drafts[0]!.frontmatter as Record<string, unknown>;
    expect(fm.type).toBe("gotcha");
  });

  it("gotcha frontmatter has symptom and resolution fields", () => {
    const drafts = proposeCandidates([makeGotchaCandidate()]);
    const fm = drafts[0]!.frontmatter as Record<string, unknown>;
    expect(typeof fm.symptom).toBe("string");
    expect((fm.symptom as string).length).toBeGreaterThan(0);
    expect(typeof fm.resolution).toBe("string");
    expect((fm.resolution as string).length).toBeGreaterThan(0);
  });

  it("gotcha frontmatter passes full validation", () => {
    const drafts = proposeCandidates([makeGotchaCandidate()]);
    validateFrontmatter(drafts[0]!.frontmatter as Record<string, unknown>);
  });

  it("gotcha ID starts with 'prmine-gotcha-'", () => {
    const drafts = proposeCandidates([makeGotchaCandidate()]);
    expect(drafts[0]!.frontmatter.id).toMatch(/^prmine-gotcha-/);
  });

  it("gotcha sources use 'reflection' kind for commit refs", () => {
    const drafts = proposeCandidates([makeGotchaCandidate()]);
    const sources = drafts[0]!.frontmatter.sources;
    expect(sources.every((s) => s.kind === "reflection")).toBe(true);
  });

  it("gotcha sources use 'pr' kind for pr refs", () => {
    const candidate = makeGotchaCandidate("Fix: login bug", "pr/99");
    const drafts = proposeCandidates([candidate]);
    expect(drafts[0]!.frontmatter.sources[0]!.kind).toBe("pr");
  });

  it("body includes the primary ref", () => {
    const drafts = proposeCandidates([makeGotchaCandidate("Fix: thing", "commit/abc1234")]);
    expect(drafts[0]!.body).toContain("commit/abc1234");
  });

  it("body includes file names", () => {
    const candidate = makeGotchaCandidate("Fix: crash", "commit/aaa", {
      files: ["src/parser.ts", "src/worker.ts"],
    });
    const drafts = proposeCandidates([candidate]);
    expect(drafts[0]!.body).toContain("src/parser.ts");
  });

  it("body includes corroborating refs when present", () => {
    const candidate = makeGotchaCandidate("Fix: crash", "commit/aaa", {
      corroboratingRefs: ["commit/bbb", "commit/ccc"],
    });
    const drafts = proposeCandidates([candidate]);
    expect(drafts[0]!.body).toContain("commit/bbb");
  });
});

// ---------------------------------------------------------------------------
// Decision proposals
// ---------------------------------------------------------------------------

describe("proposeCandidates — decision proposals", () => {
  it("produces a decision DraftEntry for a decision candidate", () => {
    const drafts = proposeCandidates([makeDecisionCandidate()]);
    expect(drafts[0]!.frontmatter.type).toBe("decision");
  });

  it("decision frontmatter has decision, rationale, outcome fields", () => {
    const drafts = proposeCandidates([makeDecisionCandidate()]);
    const fm = drafts[0]!.frontmatter as Record<string, unknown>;
    expect(typeof fm.decision).toBe("string");
    expect(typeof fm.rationale).toBe("string");
    expect(fm.outcome).toBe("pending");
  });

  it("decision frontmatter passes full validation", () => {
    const drafts = proposeCandidates([makeDecisionCandidate()]);
    validateFrontmatter(drafts[0]!.frontmatter as Record<string, unknown>);
  });

  it("decision ID starts with 'prmine-decision-'", () => {
    const drafts = proposeCandidates([makeDecisionCandidate()]);
    expect(drafts[0]!.frontmatter.id).toMatch(/^prmine-decision-/);
  });

  it("decision body contains Context and Decision sections", () => {
    const drafts = proposeCandidates([makeDecisionCandidate()]);
    expect(drafts[0]!.body).toContain("## Context");
    expect(drafts[0]!.body).toContain("## Decision");
  });

  it("decision body contains Consequences section", () => {
    const drafts = proposeCandidates([makeDecisionCandidate()]);
    expect(drafts[0]!.body).toContain("## Consequences");
  });
});

// ---------------------------------------------------------------------------
// Confidence rules
// ---------------------------------------------------------------------------

describe("proposeCandidates — confidence rules", () => {
  it("sets confidence: low for single-occurrence candidate", () => {
    const candidate = makeGotchaCandidate("Fix: crash", "commit/aaa", {
      corroboratingRefs: [],
      isHighSignal: false,
    });
    const drafts = proposeCandidates([candidate]);
    expect(drafts[0]!.frontmatter.confidence).toBe("low");
  });

  it("sets confidence: medium when ≥2 independent sources (primary + corroboration)", () => {
    const candidate = makeGotchaCandidate("Fix: crash", "commit/aaa", {
      corroboratingRefs: ["commit/bbb"],
      isHighSignal: false,
    });
    const drafts = proposeCandidates([candidate]);
    expect(drafts[0]!.frontmatter.confidence).toBe("medium");
  });

  it("sets confidence: medium when isHighSignal is true (ADR/CHANGELOG touched)", () => {
    const candidate = makeGotchaCandidate("Fix: crash", "commit/aaa", {
      corroboratingRefs: [],
      isHighSignal: true,
    });
    const drafts = proposeCandidates([candidate]);
    expect(drafts[0]!.frontmatter.confidence).toBe("medium");
  });

  it("never sets confidence: high", () => {
    const candidates: Candidate[] = [
      makeGotchaCandidate("Fix: thing 1", "commit/a", {
        corroboratingRefs: ["commit/b", "commit/c", "commit/d"],
        isHighSignal: true,
      }),
      makeDecisionCandidate("Decision: adopt pnpm", "commit/e", {
        corroboratingRefs: ["commit/f", "commit/g"],
        isHighSignal: true,
      }),
    ];
    const drafts = proposeCandidates(candidates);
    for (const d of drafts) {
      expect(d.frontmatter.confidence).not.toBe("high");
    }
  });
});

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

describe("proposeCandidates — redaction", () => {
  it("redacts AWS access keys in title", () => {
    const fakeKey = "AKIAIOSFODNN7EXAMPLE"; // fake 20-char AKIA key
    const candidate = makeGotchaCandidate(
      `Fix: leak with key ${fakeKey}`,
      "commit/aaa",
    );
    const drafts = proposeCandidates([candidate]);
    const fm = drafts[0]!.frontmatter as Record<string, unknown>;
    expect(fm.title).not.toContain(fakeKey);
    expect(fm.title).toContain("[REDACTED");
  });

  it("redacts AWS access keys in body evidence", () => {
    const fakeKey = "AKIAIOSFODNN7EXAMPLE";
    const candidate = makeGotchaCandidate("Fix: something", "commit/aaa", {
      evidence: [
        { text: `Why: we removed key ${fakeKey} from config`, sourceRef: "commit/aaa" },
      ],
    });
    const drafts = proposeCandidates([candidate]);
    expect(drafts[0]!.body).not.toContain(fakeKey);
    expect(drafts[0]!.body).toContain("[REDACTED");
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

describe("proposeCandidates — deduplication", () => {
  it("does not produce duplicate IDs", () => {
    const c1 = makeGotchaCandidate("Fix: null crash", "commit/aaa");
    const c2 = makeGotchaCandidate("Fix: null crash", "commit/bbb");
    const drafts = proposeCandidates([c1, c2]);
    const ids = drafts.map((d) => d.frontmatter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns empty array for empty input", () => {
    expect(proposeCandidates([])).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Source grounding — drop rule
// ---------------------------------------------------------------------------

describe("proposeCandidates — source grounding", () => {
  it("drops candidates with no primaryRef", () => {
    const candidate: Candidate = {
      kind: "gotcha",
      title: "Fix: something",
      primaryRef: "", // empty — should be dropped
      corroboratingRefs: [],
      evidence: [],
      files: [],
      isHighSignal: false,
    };
    const drafts = proposeCandidates([candidate]);
    expect(drafts).toHaveLength(0);
  });
});
