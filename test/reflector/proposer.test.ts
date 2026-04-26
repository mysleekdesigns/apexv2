import { describe, it, expect } from "vitest";
import { proposeFromEpisodes } from "../../src/reflector/proposer.js";
import type { EpisodeSignals } from "../../src/reflector/signals.js";
import type { FailureLine, CorrectionLine, ToolLine } from "../../src/reflector/signals.js";
import type { EpisodeMeta } from "../../src/types/shared.js";

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function makeMeta(episodeId: string): EpisodeMeta {
  return {
    schema_version: 1,
    episode_id: episodeId,
    session_id: "sess-test",
    started_at: "2026-04-26T14:32:11Z",
    ended_at: "2026-04-26T15:19:42Z",
    model: "claude-opus-4-7",
    claude_code_version: "2.4.1",
    repo_head_sha: "a1b2c3d",
    repo_branch: "main",
    cwd: "/tmp/test",
    hooks_fired_count: {
      session_start: 1,
      user_prompt_submit: 3,
      post_tool_use: 5,
      post_tool_use_failure: 1,
      pre_compact: 0,
      session_end: 1,
    },
  };
}

function makeFailure(turn: number, sig: string, toolName = "Bash"): FailureLine {
  return {
    schema_version: 1,
    ts: new Date().toISOString(),
    turn,
    tool_call_id: `tc_${turn}`,
    tool_name: toolName,
    exit_code: 1,
    error: `error: ${sig}`,
    error_signature: sig,
    stderr_excerpt: null,
  };
}

function makeCorrection(turn: number, text: string): CorrectionLine {
  return {
    schema_version: 1,
    ts: new Date().toISOString(),
    turn,
    kind: "correction",
    evidence_ref: `prompts.jsonl#L${turn}`,
    target_entry_id: null,
    user_text: text,
    claude_action_summary: "Claude did something wrong",
  };
}

function makeTool(turn: number, exitCode: number): ToolLine {
  return {
    schema_version: 1,
    ts: new Date().toISOString(),
    turn,
    tool_call_id: `tc_tool_${turn}`,
    tool_name: "Bash",
    exit_code: exitCode,
    error: exitCode !== 0 ? "error" : null,
  };
}

function makeEpisode(
  episodeId: string,
  failures: FailureLine[],
  corrections: CorrectionLine[],
  tools: ToolLine[] = [],
): EpisodeSignals {
  return { episodeId, failures, corrections, tools, meta: makeMeta(episodeId) };
}

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

describe("proposeFromEpisodes — repeated failures → gotcha", () => {
  it("proposes a gotcha when the same error_signature appears ≥2 times across episodes", () => {
    const sig = "expected cursor to be undefined";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [makeFailure(1, sig)], []);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [makeFailure(2, sig)], []);

    const drafts = proposeFromEpisodes([ep1, ep2], new Set());
    const gotcha = drafts.find((d) => d.frontmatter.type === "gotcha");
    expect(gotcha).toBeDefined();
    expect((gotcha!.frontmatter as Record<string, unknown>).symptom).toBeTruthy();
    expect((gotcha!.frontmatter as Record<string, unknown>).resolution).toBeTruthy();
  });

  it("does NOT propose a gotcha for a single occurrence", () => {
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [makeFailure(1, "unique-sig")], []);
    const drafts = proposeFromEpisodes([ep1], new Set());
    const gotcha = drafts.find(
      (d) =>
        d.frontmatter.type === "gotcha" &&
        (d.frontmatter as Record<string, unknown>).error_signature === "unique-sig",
    );
    expect(gotcha).toBeUndefined();
  });

  it("sets confidence: medium when the signature appears ≥3 times", () => {
    const sig = "recurring-three-times";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [makeFailure(1, sig)], []);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [makeFailure(2, sig)], []);
    const ep3 = makeEpisode("2026-04-26-1200-cccc", [makeFailure(3, sig)], []);

    const drafts = proposeFromEpisodes([ep1, ep2, ep3], new Set());
    const gotcha = drafts.find(
      (d) => (d.frontmatter as Record<string, unknown>).error_signature === sig,
    );
    expect(gotcha).toBeDefined();
    expect(gotcha!.frontmatter.confidence).toBe("medium");
  });

  it("sets confidence: low when the signature appears exactly 2 times", () => {
    const sig = "two-occurrences";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [makeFailure(1, sig)], []);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [makeFailure(2, sig)], []);

    const drafts = proposeFromEpisodes([ep1, ep2], new Set());
    const gotcha = drafts.find(
      (d) => (d.frontmatter as Record<string, unknown>).error_signature === sig,
    );
    expect(gotcha).toBeDefined();
    expect(gotcha!.frontmatter.confidence).toBe("low");
  });

  it("each gotcha source uses kind: reflection", () => {
    const sig = "test-signature";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [makeFailure(1, sig)], []);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [makeFailure(2, sig)], []);

    const drafts = proposeFromEpisodes([ep1, ep2], new Set());
    const gotcha = drafts.find(
      (d) => (d.frontmatter as Record<string, unknown>).error_signature === sig,
    );
    expect(gotcha).toBeDefined();
    for (const src of gotcha!.frontmatter.sources) {
      expect(src.kind).toBe("reflection");
    }
  });

  it("drops candidates with no error_signature (no grounding)", () => {
    const noSigFailure: FailureLine = {
      schema_version: 1,
      ts: new Date().toISOString(),
      turn: 1,
      tool_call_id: "tc_1",
      tool_name: "Bash",
      exit_code: 1,
      error: "some error",
      error_signature: null,
      stderr_excerpt: null,
    };
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [noSigFailure], []);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [noSigFailure], []);

    const drafts = proposeFromEpisodes([ep1, ep2], new Set());
    // No gotcha should be proposed since error_signature is null
    expect(drafts.filter((d) => d.frontmatter.type === "gotcha")).toHaveLength(0);
  });

  it("gotcha frontmatter passes validation", () => {
    const sig = "validate-me-sig";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [makeFailure(1, sig)], []);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [makeFailure(2, sig)], []);

    const drafts = proposeFromEpisodes([ep1, ep2], new Set());
    for (const d of drafts) {
      validateFrontmatter(d.frontmatter as Record<string, unknown>);
    }
  });
});

describe("proposeFromEpisodes — repeated corrections → convention", () => {
  it("proposes a convention when the same normalised correction text appears ≥2 times", () => {
    const text = "Use .optional() not .default(undefined)";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [], [makeCorrection(1, text)]);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [], [makeCorrection(2, text)]);

    const drafts = proposeFromEpisodes([ep1, ep2], new Set());
    const convention = drafts.find((d) => d.frontmatter.type === "convention");
    expect(convention).toBeDefined();
    expect((convention!.frontmatter as Record<string, unknown>).rule).toBeTruthy();
    expect((convention!.frontmatter as Record<string, unknown>).enforcement).toBe("manual");
  });

  it("normalises correction text (case + whitespace) before deduplication", () => {
    const ep1 = makeEpisode(
      "2026-04-26-1000-aaaa",
      [],
      [makeCorrection(1, "Use pnpm, not npm")],
    );
    const ep2 = makeEpisode(
      "2026-04-26-1100-bbbb",
      [],
      [makeCorrection(2, "  USE PNPM,  NOT NPM  ")],
    );

    const drafts = proposeFromEpisodes([ep1, ep2], new Set());
    const conventions = drafts.filter((d) => d.frontmatter.type === "convention");
    // Should be treated as the same correction
    expect(conventions).toHaveLength(1);
  });

  it("does NOT propose a convention for a single correction occurrence", () => {
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [], [makeCorrection(1, "unique correction text abc")]);
    const drafts = proposeFromEpisodes([ep1], new Set());
    const conventions = drafts.filter((d) => d.frontmatter.type === "convention");
    expect(conventions).toHaveLength(0);
  });

  it("ignores non-correction kinds (thumbs_up, confirmation, etc.)", () => {
    const thumbsUp: CorrectionLine = {
      schema_version: 1,
      ts: new Date().toISOString(),
      turn: 1,
      kind: "thumbs_up",
      evidence_ref: "prompts.jsonl#L1",
      user_text: "great work",
    };
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [], [thumbsUp]);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [], [thumbsUp]);

    const drafts = proposeFromEpisodes([ep1, ep2], new Set());
    const conventions = drafts.filter((d) => d.frontmatter.type === "convention");
    expect(conventions).toHaveLength(0);
  });

  it("sets confidence: medium when ≥3 distinct episodes have the correction", () => {
    const text = "always use async/await";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [], [makeCorrection(1, text)]);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [], [makeCorrection(2, text)]);
    const ep3 = makeEpisode("2026-04-26-1200-cccc", [], [makeCorrection(3, text)]);

    const drafts = proposeFromEpisodes([ep1, ep2, ep3], new Set());
    const convention = drafts.find((d) => d.frontmatter.type === "convention");
    expect(convention).toBeDefined();
    expect(convention!.frontmatter.confidence).toBe("medium");
  });

  it("convention sources use kind: reflection", () => {
    const text = "prefer const over let";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [], [makeCorrection(1, text)]);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [], [makeCorrection(2, text)]);

    const drafts = proposeFromEpisodes([ep1, ep2], new Set());
    const convention = drafts.find((d) => d.frontmatter.type === "convention");
    expect(convention).toBeDefined();
    for (const src of convention!.frontmatter.sources) {
      expect(src.kind).toBe("reflection");
    }
  });

  it("convention frontmatter passes validation", () => {
    const text = "validate convention text";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [], [makeCorrection(1, text)]);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [], [makeCorrection(2, text)]);

    const drafts = proposeFromEpisodes([ep1, ep2], new Set());
    for (const d of drafts) {
      validateFrontmatter(d.frontmatter as Record<string, unknown>);
    }
  });
});

describe("proposeFromEpisodes — no-grounding drop rule", () => {
  it("returns empty array when there are no repeated signals at all", () => {
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [], []);
    const drafts = proposeFromEpisodes([ep1], new Set());
    expect(drafts).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(proposeFromEpisodes([], new Set())).toHaveLength(0);
  });
});

describe("proposeFromEpisodes — deduplication", () => {
  it("does not produce duplicate ids", () => {
    const sig = "dup-sig";
    const text = "dup correction text please do not duplicate";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [makeFailure(1, sig)], [makeCorrection(1, text)]);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [makeFailure(2, sig)], [makeCorrection(2, text)]);
    const ep3 = makeEpisode("2026-04-26-1200-cccc", [makeFailure(3, sig)], [makeCorrection(3, text)]);

    const drafts = proposeFromEpisodes([ep1, ep2, ep3], new Set());
    const ids = drafts.map((d) => d.frontmatter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("proposeFromEpisodes — resolved-failure detection", () => {
  it("proposes a candidate-resolution when failure absent from recent N episodes with successful tools", () => {
    const sig = "old-recurring-failure";
    // Older episodes have the failure
    const old1 = makeEpisode("2026-04-25-1000-aaaa", [makeFailure(1, sig)], [], [makeTool(2, 0)]);
    const old2 = makeEpisode("2026-04-25-1100-bbbb", [makeFailure(1, sig)], [], [makeTool(2, 0)]);
    // Recent episodes (N=3) do NOT have the failure but have successful tools
    const rec1 = makeEpisode("2026-04-26-1000-cccc", [], [], [makeTool(1, 0)]);
    const rec2 = makeEpisode("2026-04-26-1100-dddd", [], [], [makeTool(1, 0)]);
    const rec3 = makeEpisode("2026-04-26-1200-eeee", [], [], [makeTool(1, 0)]);

    // List must be newest-first (as returned by listRecentEpisodes)
    const allEpisodes = [rec3, rec2, rec1, old2, old1];
    const drafts = proposeFromEpisodes(allEpisodes, new Set(), { resolvedN: 3 });
    const resolutionCandidate = drafts.find(
      (d) =>
        d.frontmatter.tags?.includes("candidate-resolution") ||
        (d.frontmatter as Record<string, unknown>).resolved_at !== undefined,
    );
    expect(resolutionCandidate).toBeDefined();
  });

  it("does NOT propose resolution when failure still appears in recent episodes", () => {
    const sig = "still-failing";
    const ep1 = makeEpisode("2026-04-26-1000-aaaa", [makeFailure(1, sig)], [], [makeTool(2, 0)]);
    const ep2 = makeEpisode("2026-04-26-1100-bbbb", [makeFailure(1, sig)], [], [makeTool(2, 0)]);
    const rec1 = makeEpisode("2026-04-26-1200-cccc", [makeFailure(1, sig)], [], [makeTool(2, 0)]);

    const allEpisodes = [rec1, ep2, ep1];
    const drafts = proposeFromEpisodes(allEpisodes, new Set(), { resolvedN: 3 });
    const resolutionCandidate = drafts.find(
      (d) =>
        d.frontmatter.tags?.includes("candidate-resolution") &&
        (d.frontmatter as Record<string, unknown>).error_signature === sig,
    );
    expect(resolutionCandidate).toBeUndefined();
  });
});
