// Phase 5.5 redactor additions: npm tokens, Heroku API keys, Azure AD client
// secrets. Verifies positive matches on real-shaped tokens AND the absence of
// false positives on plain English / unrelated text.

import { describe, expect, it } from "vitest";

import { redactString, patternNames } from "../../src/redactor/index.js";

const RED = (n: string) => `[REDACTED:${n}]`;

describe("redactor — Phase 5.5 additions", () => {
  it("registers the three new patterns by name", () => {
    const names = patternNames();
    expect(names).toContain("npm-token");
    expect(names).toContain("heroku-api-key");
    expect(names).toContain("azure-client-secret");
  });

  describe("npm-token", () => {
    it("redacts a real-shaped npm_ token (36 chars after prefix)", () => {
      // npm_ + 36 base62 chars. Built at runtime so static scanners don't flag.
      const tok = "npm_" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789".slice(0, 36);
      const out = redactString(`registry login: ${tok}`);
      expect(out).toContain(RED("npm-token"));
      expect(out).not.toContain(tok);
    });

    it("does not match shorter strings starting with npm_", () => {
      // 20 chars after `npm_` — too short to match.
      const out = redactString("not a token: npm_abcdefg1234567890123");
      expect(out).not.toContain(RED("npm-token"));
    });

    it("passes through plain English mentioning npm", () => {
      const out = redactString("Run npm install to fetch dependencies.");
      expect(out).toBe("Run npm install to fetch dependencies.");
    });
  });

  describe("heroku-api-key", () => {
    it("redacts a HRKU- token", () => {
      // Split literal so GitHub secret-scanning doesn't fingerprint the
      // fixture as a real Heroku token. Runtime value matches the regex.
      const tok = "HRKU" + "-abcdef12-3456-7890-abcd-ef1234567890";
      const out = redactString(`Heroku api key: ${tok}`);
      expect(out).toContain(RED("heroku-api-key"));
      expect(out).not.toContain(tok);
    });

    it("does not match unrelated dashed strings", () => {
      const out = redactString("Token: abcdef12-3456-7890-abcd-ef1234567890");
      expect(out).not.toContain(RED("heroku-api-key"));
    });

    it("passes through plain English mentioning Heroku", () => {
      const out = redactString(
        "Heroku is one cloud platform among many we considered.",
      );
      expect(out).not.toContain(RED("heroku-api-key"));
    });
  });

  describe("azure-client-secret", () => {
    it("redacts a client_secret assignment", () => {
      // 40-char Azure-shape secret built at runtime.
      const secret = "Abc.123~_-XyZ" + "0123456789ABCDEFGHIJabcdefghij";
      const out = redactString(`client_secret=${secret}`);
      expect(out).toContain(RED("azure-client-secret"));
      expect(out).toContain("client_secret"); // cue preserved for debug
      expect(out).not.toContain(secret);
    });

    it("matches with quoted JSON-style separator", () => {
      const secret = "Abc.123~_-XyZ" + "0123456789ABCDEFGHIJabcdefghij";
      const out = redactString(`"client_secret": "${secret}"`);
      expect(out).toContain(RED("azure-client-secret"));
    });

    it("matches with hyphenated `client-secret` form", () => {
      const secret = "Abc.123~_-XyZ" + "0123456789ABCDEFGHIJabcdefghij";
      const out = redactString(`client-secret: ${secret}`);
      expect(out).toContain(RED("azure-client-secret"));
    });

    it("does not flag English prose mentioning client secret", () => {
      const out = redactString(
        "The client secret should be rotated quarterly.",
      );
      expect(out).not.toContain(RED("azure-client-secret"));
    });

    it("does not flag short values", () => {
      // 10-char value — far below 34-char minimum.
      const out = redactString("client_secret=shortone1");
      expect(out).not.toContain(RED("azure-client-secret"));
    });
  });

  describe("idempotency on additions", () => {
    it("redact(redact(x)) === redact(x) for combined Phase 5.5 fixtures", () => {
      const input = [
        "npm_" + "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789".slice(0, 36),
        "HRKU" + "-abcdef12-3456-7890-abcd-ef1234567890",
        "client_secret=" +
          ("Abc.123~_-XyZ" + "0123456789ABCDEFGHIJabcdefghij"),
      ].join("\n");
      const once = redactString(input);
      const twice = redactString(once);
      expect(twice).toBe(once);
    });
  });
});
