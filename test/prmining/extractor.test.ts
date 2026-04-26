// Unit tests for src/prmining/extractor.ts
//
// Pure tests — no I/O, no git calls. Feed in CommitInfo[] and assert candidates.

import { describe, it, expect } from "vitest";
import { extractCandidates } from "../../src/prmining/extractor.js";
import type { CommitInfo, PrInfo } from "../../src/prmining/git.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCommit(
  sha: string,
  subject: string,
  body = "",
  files: string[] = [],
): CommitInfo {
  return {
    sha,
    shortSha: sha.slice(0, 7),
    subject,
    body,
    author: "Test Author",
    date: "2026-04-26T10:00:00Z",
    files,
  };
}

function makePr(
  number: number,
  title: string,
  body = "",
  mergeCommitSha?: string,
): PrInfo {
  return { number, title, body, mergeCommitSha };
}

// ---------------------------------------------------------------------------
// gotcha detection (fix|hotfix|revert|patch prefixes)
// ---------------------------------------------------------------------------

describe("extractCandidates — gotcha detection", () => {
  it("classifies 'fix: ...' commits as gotcha", () => {
    const commits = [makeCommit("aaa1", "fix: handle null pointer in parser")];
    const candidates = extractCandidates(commits);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.kind).toBe("gotcha");
  });

  it("classifies 'hotfix: ...' commits as gotcha", () => {
    const commits = [makeCommit("bbb2", "hotfix: revert bad migration")];
    const candidates = extractCandidates(commits);
    expect(candidates[0]!.kind).toBe("gotcha");
  });

  it("classifies 'revert: ...' commits as gotcha", () => {
    const c = extractCandidates([makeCommit("ccc3", "revert: undo broken API change")]);
    expect(c[0]!.kind).toBe("gotcha");
  });

  it("classifies 'patch: ...' commits as gotcha", () => {
    const c = extractCandidates([makeCommit("ddd4", "patch: fix security issue in auth")]);
    expect(c[0]!.kind).toBe("gotcha");
  });

  it("is case-insensitive for fix prefix", () => {
    const c = extractCandidates([makeCommit("eee5", "Fix: Memory leak in worker")]);
    expect(c[0]!.kind).toBe("gotcha");
  });

  it("does NOT classify 'chore: ...' as gotcha", () => {
    const c = extractCandidates([makeCommit("fff6", "chore: bump deps")]);
    expect(c).toHaveLength(0);
  });

  it("does NOT classify 'feat: ...' as gotcha or decision", () => {
    const c = extractCandidates([makeCommit("ggg7", "feat: add new login page")]);
    expect(c).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// decision detection (decide|adopt|switch to|migrate to|deprecate prefixes)
// ---------------------------------------------------------------------------

describe("extractCandidates — decision detection", () => {
  it("classifies 'decide: ...' commits as decision", () => {
    const c = extractCandidates([makeCommit("hhh8", "decide: adopt zod for validation")]);
    expect(c[0]!.kind).toBe("decision");
  });

  it("classifies 'adopt: ...' commits as decision", () => {
    const c = extractCandidates([makeCommit("iii9", "adopt: vitest over jest")]);
    expect(c[0]!.kind).toBe("decision");
  });

  it("classifies 'switch to ...' commits as decision", () => {
    const c = extractCandidates([makeCommit("jjj0", "switch to pnpm from npm")]);
    expect(c[0]!.kind).toBe("decision");
  });

  it("classifies 'migrate to ...' commits as decision", () => {
    const c = extractCandidates([makeCommit("kkk1", "migrate to postgres from sqlite")]);
    expect(c[0]!.kind).toBe("decision");
  });

  it("classifies 'deprecate: ...' commits as decision", () => {
    const c = extractCandidates([makeCommit("lll2", "deprecate: remove legacy v1 api")]);
    expect(c[0]!.kind).toBe("decision");
  });

  it("is case-insensitive for decision prefix", () => {
    const c = extractCandidates([makeCommit("mmm3", "Adopt: ESM over CJS")]);
    expect(c[0]!.kind).toBe("decision");
  });
});

// ---------------------------------------------------------------------------
// Evidence extraction from body
// ---------------------------------------------------------------------------

describe("extractCandidates — evidence from body", () => {
  it("extracts lines containing 'why' from body", () => {
    const commit = makeCommit(
      "nnn4",
      "fix: crash on empty array",
      "Why: the code assumed length > 0 without checking.",
    );
    const c = extractCandidates([commit]);
    const evidence = c[0]!.evidence;
    expect(evidence.some((e) => e.text.toLowerCase().includes("why"))).toBe(true);
  });

  it("extracts lines containing 'because' from body", () => {
    const commit = makeCommit(
      "ooo5",
      "fix: remove deprecated API",
      "Because the upstream library removed it in v3.",
    );
    const c = extractCandidates([commit]);
    expect(c[0]!.evidence.some((e) => e.text.toLowerCase().includes("because"))).toBe(true);
  });

  it("extracts lines containing 'to avoid' from body", () => {
    const commit = makeCommit(
      "ppp6",
      "fix: add retry logic",
      "Added to avoid transient network failures causing hard errors.",
    );
    const c = extractCandidates([commit]);
    expect(c[0]!.evidence.some((e) => e.text.toLowerCase().includes("to avoid"))).toBe(true);
  });

  it("extracts lines containing 'gotcha' from body", () => {
    const commit = makeCommit(
      "qqq7",
      "fix: gotcha with null session",
      "Note: gotcha — session can be null on first load.",
    );
    const c = extractCandidates([commit]);
    expect(c[0]!.evidence.some((e) => e.text.toLowerCase().includes("gotcha"))).toBe(true);
  });

  it("always includes the subject line as evidence", () => {
    const commit = makeCommit("rrr8", "fix: fix the thingy");
    const c = extractCandidates([commit]);
    expect(c[0]!.evidence[0]!.text).toBe("fix: fix the thingy");
    expect(c[0]!.evidence[0]!.sourceRef).toBe("commit/rrr8");
  });

  it("evidence sourceRef uses 'commit/<sha>' format", () => {
    const commit = makeCommit("sss9", "fix: something");
    const c = extractCandidates([commit]);
    expect(c[0]!.evidence[0]!.sourceRef).toBe("commit/sss9");
  });
});

// ---------------------------------------------------------------------------
// High-signal files
// ---------------------------------------------------------------------------

describe("extractCandidates — high-signal file detection", () => {
  it("marks isHighSignal when CHANGELOG.md is touched", () => {
    const commit = makeCommit(
      "ttt0",
      "fix: update changelog",
      "",
      ["CHANGELOG.md", "src/foo.ts"],
    );
    const c = extractCandidates([commit]);
    expect(c[0]!.isHighSignal).toBe(true);
  });

  it("marks isHighSignal when docs/decisions/*.md is touched", () => {
    const commit = makeCommit(
      "uuu1",
      "decide: adopt monorepo",
      "",
      ["docs/decisions/adopt-monorepo.md"],
    );
    const c = extractCandidates([commit]);
    expect(c[0]!.isHighSignal).toBe(true);
  });

  it("marks isHighSignal when docs/adr/*.md is touched", () => {
    const commit = makeCommit(
      "vvv2",
      "decide: switch to postgres",
      "",
      ["docs/adr/0001-use-postgres.md"],
    );
    const c = extractCandidates([commit]);
    expect(c[0]!.isHighSignal).toBe(true);
  });

  it("marks isHighSignal when ADR-*.md is touched", () => {
    const commit = makeCommit(
      "www3",
      "decide: deprecate v1 api",
      "",
      ["ADR-007-deprecate-v1.md"],
    );
    const c = extractCandidates([commit]);
    expect(c[0]!.isHighSignal).toBe(true);
  });

  it("does NOT set isHighSignal for normal source files", () => {
    const commit = makeCommit("xxx4", "fix: parser crash", "", ["src/parser.ts"]);
    const c = extractCandidates([commit]);
    expect(c[0]!.isHighSignal).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Corroboration / merging
// ---------------------------------------------------------------------------

describe("extractCandidates — merging and corroboration", () => {
  it("merges two commits with the same normalised title into one candidate", () => {
    const c1 = makeCommit("aaa1", "fix: handle null pointer");
    const c2 = makeCommit("bbb2", "fix: handle null pointer");
    const candidates = extractCandidates([c1, c2]);
    // Both normalise to the same title — should be merged
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.corroboratingRefs).toContain("commit/bbb2");
  });

  it("keeps separate candidates for different titles", () => {
    const c1 = makeCommit("aaa1", "fix: handle null in parser");
    const c2 = makeCommit("bbb2", "fix: race condition in worker");
    const candidates = extractCandidates([c1, c2]);
    expect(candidates).toHaveLength(2);
  });

  it("primaryRef uses 'commit/<sha>' format", () => {
    const commit = makeCommit("ccc3", "fix: something");
    const c = extractCandidates([commit]);
    expect(c[0]!.primaryRef).toBe("commit/ccc3");
  });
});

// ---------------------------------------------------------------------------
// PR bodies
// ---------------------------------------------------------------------------

describe("extractCandidates — PR bodies", () => {
  it("classifies a PR with 'fix:' title as gotcha", () => {
    const pr = makePr(99, "fix: login redirect loop");
    const c = extractCandidates([], [pr]);
    expect(c[0]!.kind).toBe("gotcha");
    expect(c[0]!.primaryRef).toBe("pr/99");
  });

  it("classifies a PR with 'adopt:' title as decision", () => {
    const pr = makePr(100, "adopt: eslint v9 flat config");
    const c = extractCandidates([], [pr]);
    expect(c[0]!.kind).toBe("decision");
  });

  it("extracts evidence from PR body lines containing 'because'", () => {
    const pr = makePr(
      101,
      "fix: auth bug",
      "Because the session token was not being refreshed on expiry.",
    );
    const c = extractCandidates([], [pr]);
    expect(c[0]!.evidence.some((e) => e.text.toLowerCase().includes("because"))).toBe(true);
  });

  it("corroborates commit and PR with same normalised title", () => {
    const commit = makeCommit("ddd4", "fix: null session crash");
    const pr = makePr(102, "fix: null session crash");
    const c = extractCandidates([commit], [pr]);
    // Should merge into one candidate
    expect(c).toHaveLength(1);
    const candidate = c[0]!;
    // One of them is primary, the other corroborates
    const allRefs = [candidate.primaryRef, ...candidate.corroboratingRefs];
    expect(allRefs).toContain("commit/ddd4");
    expect(allRefs).toContain("pr/102");
  });

  it("returns empty array for unclassifiable commits", () => {
    const commits = [
      makeCommit("eee5", "chore: update readme"),
      makeCommit("fff6", "feat: add profile page"),
    ];
    const c = extractCandidates(commits);
    expect(c).toHaveLength(0);
  });
});
