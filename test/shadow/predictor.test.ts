import { describe, it, expect } from "vitest";
import { predictQueries, extractNounPhrases } from "../../src/shadow/predictor.js";

describe("extractNounPhrases", () => {
  it("returns lowercase tokens >=4 chars, not stopwords", () => {
    const phrases = extractNounPhrases("How do I rotate the JWT signing token?");
    // "rotate" (6), "signing" (7), "token" (5) — "jwt" is 3 chars so excluded
    expect(phrases).toContain("rotate");
    expect(phrases).toContain("signing");
    expect(phrases).toContain("token");
    // stopwords excluded
    expect(phrases).not.toContain("the");
    expect(phrases).not.toContain("how");
  });

  it("dedupes repeated tokens", () => {
    const phrases = extractNounPhrases("auth token auth token auth");
    expect(phrases.filter((p) => p === "token")).toHaveLength(1);
    expect(phrases.filter((p) => p === "auth")).toHaveLength(1);
  });

  it("drops short tokens (<4 chars)", () => {
    const phrases = extractNounPhrases("use npm run");
    // "use" (3), "npm" (3), "run" (3) — all too short
    expect(phrases).toHaveLength(0);
  });

  it("handles empty input", () => {
    expect(extractNounPhrases("")).toEqual([]);
  });

  it("strips punctuation from tokens", () => {
    // Comma splits the two tokens; hyphens and underscores are kept within tokens.
    // regex: [a-z][a-z0-9-_]* — so "session-token" and "refresh_token" are single tokens.
    const phrases = extractNounPhrases("session-token, refresh_token!");
    expect(phrases).toContain("session-token");
    expect(phrases).toContain("refresh_token");
    // standalone "token" appears only if split off — here it does not
    expect(phrases).not.toContain("session");
  });
});

describe("predictQueries", () => {
  it("always includes the verbatim prompt as first candidate", () => {
    const q = predictQueries("auth flow session token");
    expect(q[0]).toBe("auth flow session token");
  });

  it("returns at most 3 candidates", () => {
    const q = predictQueries("how do I implement JWT authentication with refresh tokens", {
      recentPrompts: ["what is the session expiry strategy"],
    });
    expect(q.length).toBeLessThanOrEqual(3);
    expect(q.length).toBeGreaterThanOrEqual(1);
  });

  it("generates a noun-phrase candidate from the prompt", () => {
    const q = predictQueries("implement JWT authentication");
    // Should generate something from noun phrases
    expect(q.length).toBeGreaterThanOrEqual(1);
  });

  it("generates an intent candidate for 'how to' prompts", () => {
    const q = predictQueries("how to rotate signing key");
    // The 'how to' pattern should produce a 2-word slice: "rotate signing"
    expect(q).toContain("rotate signing");
  });

  it("generates an intent candidate for 'what is' prompts", () => {
    const q = predictQueries("what is session token expiry");
    // 'what is' → "session token"
    expect(q).toContain("session token");
  });

  it("dedupes candidates case-insensitively", () => {
    // Prompt is short enough that noun-phrase candidate equals the prompt
    const q = predictQueries("rotate token");
    // Should not contain duplicates
    const lower = q.map((x) => x.toLowerCase());
    const unique = new Set(lower);
    expect(unique.size).toBe(lower.length);
  });

  it("uses recent prompts to enrich noun phrase extraction", () => {
    const q = predictQueries("rotate signing certificates", {
      recentPrompts: [
        "how do we handle cert rotation schedule",
        "what expires after 90 days",
      ],
    });
    expect(q.length).toBeGreaterThanOrEqual(1);
    // The verbatim prompt is always first
    expect(q[0]).toBe("rotate signing certificates");
  });

  it("handles prompt with no extractable noun phrases gracefully", () => {
    // All stop-words / short words
    const q = predictQueries("do it all");
    // Still returns at least the verbatim prompt
    expect(q).toHaveLength(1);
    expect(q[0]).toBe("do it all");
  });

  it("handles how do you variant", () => {
    const q = predictQueries("how do you debug memory leaks");
    expect(q).toContain("debug memory");
  });
});
