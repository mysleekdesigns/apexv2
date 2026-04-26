// Table-driven tests for the feedback detection helpers exported from hook.ts.
// Covers isCorrection, isConfirmation, and isThumbs.

import { describe, expect, it } from "vitest";

import {
  isConfirmation,
  isCorrection,
  isThumbs,
} from "../../src/cli/commands/hook.js";

// ---------- isCorrection ------------------------------------------------------

describe("isCorrection", () => {
  const positives: string[] = [
    "no, use .optional() instead",
    "Nope, that's wrong",
    "don't do that",
    "Stop, that's not right",
    "actually, use Map<>",
    "use pnpm instead of npm",
    "NO that is wrong",
    "  no trailing space  ",
  ];

  const negatives: string[] = [
    "",
    "   ",
    "Add a paginated /api/projects route.",
    "Run the tests.",
    "Looks good, commit.",
    "yes please",
    "lgtm",
    "/apex-thumbs-up some-id",
  ];

  for (const p of positives) {
    it(`matches: ${JSON.stringify(p)}`, () => {
      expect(isCorrection(p)).toBe(true);
    });
  }

  for (const n of negatives) {
    it(`does not match: ${JSON.stringify(n)}`, () => {
      expect(isCorrection(n)).toBe(false);
    });
  }
});

// ---------- isConfirmation ----------------------------------------------------

describe("isConfirmation", () => {
  const positives: string[] = [
    "yes",
    "yes please",
    "Yes, go ahead",
    "yep",
    "Yep that's fine",
    "yeah",
    "Yeah exactly",
    "exactly",
    "Exactly right",
    "perfect",
    "Perfect, ship it",
    "that's right",
    "That's right, thanks",
    "that's correct",
    "that's it",
    "right",
    "Right, proceed",
    "correct",
    "Correct.",
    "do that",
    "Do that please",
    "go ahead",
    "Go ahead with it",
    "ship it",
    "looks good",
    "Looks good to me",
    "lgtm",
    "LGTM",
    "👍",
    "👍 merge it",
    "  yes  ",
  ];

  const negatives: string[] = [
    "",
    "   ",
    // not a leading affirmation
    "Add a route.",
    "Run the tests.",
    "no, that's wrong",
    // "right" must be a word boundary — ensure "rightward" doesn't match
    "rightward",
    // corrections take precedence in handlePromptSubmit but the regex itself
    // should not match words from CORRECTION_REGEX
    "actually, do it",
    "nope",
    "/apex-thumbs-up some-id",
    // "yes" not at the start
    "I say yes",
  ];

  for (const p of positives) {
    it(`matches: ${JSON.stringify(p)}`, () => {
      expect(isConfirmation(p)).toBe(true);
    });
  }

  for (const n of negatives) {
    it(`does not match: ${JSON.stringify(n)}`, () => {
      expect(isConfirmation(n)).toBe(false);
    });
  }
});

// ---------- isThumbs ----------------------------------------------------------

describe("isThumbs", () => {
  it("returns thumbs_up with entry_id for a valid up command", () => {
    expect(isThumbs("/apex-thumbs-up gh-pnpm-not-npm")).toEqual({
      kind: "thumbs_up",
      entry_id: "gh-pnpm-not-npm",
    });
  });

  it("returns thumbs_down with entry_id for a valid down command", () => {
    expect(isThumbs("/apex-thumbs-down use-zod-for-validation")).toEqual({
      kind: "thumbs_down",
      entry_id: "use-zod-for-validation",
    });
  });

  it("handles a single-segment id", () => {
    expect(isThumbs("/apex-thumbs-up abc123")).toEqual({
      kind: "thumbs_up",
      entry_id: "abc123",
    });
  });

  it("is case-insensitive for the command keyword", () => {
    const r = isThumbs("/apex-thumbs-UP some-entry");
    expect(r?.kind).toBe("thumbs_up");
  });

  it("trims leading/trailing whitespace before matching", () => {
    expect(isThumbs("  /apex-thumbs-down foo-bar  ")).toEqual({
      kind: "thumbs_down",
      entry_id: "foo-bar",
    });
  });

  it("returns null for empty string", () => {
    expect(isThumbs("")).toBeNull();
  });

  it("returns null for whitespace only", () => {
    expect(isThumbs("   ")).toBeNull();
  });

  it("returns null when id is missing", () => {
    expect(isThumbs("/apex-thumbs-up")).toBeNull();
    expect(isThumbs("/apex-thumbs-up ")).toBeNull();
  });

  it("returns null for an unknown polarity", () => {
    expect(isThumbs("/apex-thumbs-sideways some-id")).toBeNull();
  });

  it("returns the id as-typed (regex is case-insensitive end-to-end)", () => {
    // The i flag covers the whole pattern so mixed-case IDs are accepted;
    // APEX recall always emits lowercase IDs but we don't reject user typos.
    const r = isThumbs("/apex-thumbs-up SomeEntry");
    expect(r).not.toBeNull();
    expect(r?.entry_id).toBe("SomeEntry");
  });

  it("returns null for arbitrary prompts", () => {
    expect(isThumbs("Run the tests.")).toBeNull();
    expect(isThumbs("no, use pnpm")).toBeNull();
    expect(isThumbs("yes")).toBeNull();
  });
});
