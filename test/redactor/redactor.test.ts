// Redactor unit tests. Asserts every Phase 1 default-on pattern from
// specs/redactor-design.md §2 redacts; non-matches pass through; idempotent.

import { describe, expect, it } from "vitest";

import { redact, redactString, PATTERNS } from "../../src/redactor/index.js";

const RED = (n: string) => `[REDACTED:${n}]`;

describe("redactor — pattern coverage", () => {
  it("aws-access-key — replaces a 20-char AKIA token", () => {
    const out = redactString("My access key is AKIA1234567890ABCDEF and that's it.");
    expect(out).toContain(RED("aws-access-key"));
    expect(out).not.toContain("AKIA1234567890ABCDEF");
  });

  it("aws-access-key — handles a token wrapped across a newline (T9)", () => {
    const wrapped = `{"key": "AKIA12345\n67890ABCDEF"}`;
    const out = redactString(wrapped);
    expect(out).toContain(RED("aws-access-key"));
    expect(out).not.toContain("AKIA12345");
  });

  it("aws-secret-key — proximity guard masks a 40-char token near the cue", () => {
    const input = `aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY12`;
    const out = redactString(input);
    expect(out).toContain(RED("aws-secret-key"));
  });

  it("aws-secret-key — no proximity, no redaction (commit-SHA-style 40-char token)", () => {
    // 40 hex chars unrelated to AWS: must pass through.
    const input = `commit abcdef0123456789abcdef0123456789abcdef01 fixed the bug`;
    const out = redactString(input);
    expect(out).toContain("abcdef0123456789abcdef0123456789abcdef01");
    expect(out).not.toContain(RED("aws-secret-key"));
  });

  it("gh-pat — classic ghp_ token", () => {
    const tok = "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
    expect(redactString(`Token: ${tok}`)).toContain(RED("gh-pat"));
  });

  it("gh-pat — covers gho/ghu/ghs/ghr prefixes", () => {
    for (const prefix of ["gho", "ghu", "ghs", "ghr"]) {
      const tok = `${prefix}_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789`;
      expect(redactString(tok)).toContain(RED("gh-pat"));
    }
  });

  it("gitlab-pat — glpat- token", () => {
    expect(redactString("glpat-xxxxxxxxxxxxxxxxxxxx")).toContain(
      RED("gitlab-pat"),
    );
  });

  it("slack-token — xoxb token", () => {
    expect(redactString("xoxb-1234567890-AbCdEfGhIj")).toContain(
      RED("slack-token"),
    );
  });

  it("slack-webhook URL", () => {
    const url =
      "https://hooks.slack.com/services/T01ABCDEF/B01ABCDEF/abcdef0123456789";
    expect(redactString(url)).toContain(RED("slack-webhook"));
  });

  it("discord-webhook URL", () => {
    const url =
      "https://discord.com/api/webhooks/123456789012345678/abcdef-_AbCdEfGhIj";
    expect(redactString(url)).toContain(RED("discord-webhook"));
  });

  it("jwt — three-segment eyJ token", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4f";
    expect(redactString(`Authorization: Bearer ${jwt}`)).toContain(RED("jwt"));
  });

  it("pem-private-key — full BEGIN..END block collapses to a single marker", () => {
    const block = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAFwAAAAdz",
      "c2gtcnNhAAAAAwEAAQAAAQEAumVQ...",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");
    const out = redactString(`error: ${block}`);
    expect(out).toContain(RED("pem-private-key"));
    expect(out).not.toContain("BEGIN OPENSSH");
  });

  it("openai-key — sk- token", () => {
    expect(
      redactString("OPENAI key: sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"),
    ).toContain(RED("openai-key"));
  });

  it("anthropic-key — sk-ant- token", () => {
    const tok = "sk-ant-" + "a".repeat(96);
    expect(redactString(tok)).toContain(RED("anthropic-key"));
  });

  it("openai-key does NOT match anthropic prefix", () => {
    const tok = "sk-ant-" + "a".repeat(96);
    const out = redactString(tok);
    expect(out).not.toContain(RED("openai-key"));
  });

  it("stripe-key (live and test)", () => {
    // Built at runtime so static secret scanners don't flag this fixture.
    const body = "AbCdEfGhIjKlMnOpQrStUvWxYz12";
    expect(redactString("stripe " + "sk_" + "live_" + body)).toContain(RED("stripe-key"));
    expect(redactString("stripe " + "pk_" + "test_" + body)).toContain(RED("stripe-key"));
  });

  it("google-api-key — AIza prefix", () => {
    // Google API keys are 39 chars total: AIza + 35 char body.
    const body = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789".slice(0, 35);
    const key = "AIza" + body;
    expect(redactString(`gkey=${key}`)).toContain(RED("google-api-key"));
  });

  it("db-url-with-creds — postgres URL with userinfo", () => {
    const url = "postgres://app:hunter2@db.internal:5432/prod";
    expect(redactString(`Connect string: ${url}`)).toContain(
      RED("db-url-with-creds"),
    );
  });

  it("db-url-with-creds — mongodb+srv with creds", () => {
    const url = "mongodb+srv://u:p@cluster0.example.net/db";
    expect(redactString(url)).toContain(RED("db-url-with-creds"));
  });

  it("basic-auth-url — generic https user:pass@host", () => {
    const url = "https://alice:secret123@api.example.com/v1/x";
    expect(redactString(url)).toContain(RED("basic-auth-url"));
  });

  it("env-assignment — masks the value but keeps the key visible", () => {
    const out = redactString(`API_KEY=sk_abc123def456ghi789`);
    expect(out).toMatch(/^API_KEY=\[REDACTED:env-assignment\]$/m);
    expect(out).not.toContain("sk_abc123def456ghi789");
  });

  it("env-assignment — covers export and quoted forms", () => {
    const out = redactString(
      [
        `export DB_PASSWORD="hunter2-very-long-pw"`,
        `MY_GITHUB_TOKEN=ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789`,
      ].join("\n"),
    );
    expect(out).toContain(RED("env-assignment"));
    expect(out).toContain("DB_PASSWORD");
    expect(out).toContain("MY_GITHUB_TOKEN");
    expect(out).not.toContain("hunter2-very-long-pw");
  });

  it("generic-api-key — masks long token after a key/bearer cue", () => {
    const out = redactString(
      `Authorization: Bearer ${"A".repeat(40)}xyz`,
    );
    expect(out).toContain(RED("generic-api-key"));
    expect(out).not.toContain("A".repeat(40) + "xyz");
  });

  it("generic-api-key — does not mask short or unrelated strings", () => {
    const input = "the bearer arrived at noon";
    expect(redactString(input)).toBe(input);
  });
});

describe("redactor — non-matches pass through", () => {
  it("plain English text is unchanged", () => {
    const s = "The quick brown fox jumps over the lazy dog.";
    expect(redactString(s)).toBe(s);
  });

  it("commit-SHA-style 40-char hex without proximity is unchanged", () => {
    const s = "commit abcdef0123456789abcdef0123456789abcdef01";
    expect(redactString(s)).toBe(s);
  });

  it("file paths and code identifiers are unchanged", () => {
    const s = "see src/redactor/index.ts function redactString()";
    expect(redactString(s)).toBe(s);
  });

  it("empty string", () => {
    expect(redactString("")).toBe("");
  });
});

describe("redactor — idempotency", () => {
  const cases = [
    "AKIA1234567890ABCDEF",
    "ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "OPENAI_API_KEY=sk-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789",
    "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4f",
    "postgres://app:hunter2@db.internal:5432/prod",
    "Plain text with no secrets at all.",
    `-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----`,
  ];
  for (const input of cases) {
    it(`redact(redact(x)) == redact(x): ${JSON.stringify(input.slice(0, 40))}`, () => {
      const once = redactString(input);
      const twice = redactString(once);
      expect(twice).toBe(once);
    });
  }
});

describe("redactor — object/array walk", () => {
  it("redacts string fields in nested objects", () => {
    const o = {
      cmd: "curl -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4f' x",
      meta: {
        akia: "AKIA1234567890ABCDEF",
        notes: ["plain", "AKIA1234567890ABCDEF"],
      },
      n: 42,
      flag: true,
      empty: null,
    };
    const r = redact(o) as typeof o;
    expect(JSON.stringify(r)).toContain(RED("jwt"));
    expect(JSON.stringify(r)).toContain(RED("aws-access-key"));
    expect(r.n).toBe(42);
    expect(r.flag).toBe(true);
    expect(r.empty).toBeNull();
  });

  it("preserves the structural shape (keys + types)", () => {
    const o = { a: "AKIA1234567890ABCDEF", b: { c: 1, d: ["x", "y"] } };
    const r = redact(o) as typeof o;
    expect(Object.keys(r)).toEqual(["a", "b"]);
    expect(Object.keys(r.b)).toEqual(["c", "d"]);
    expect(Array.isArray(r.b.d)).toBe(true);
    expect(r.b.d).toHaveLength(2);
  });
});

describe("redactor — pattern catalog metadata", () => {
  it("exposes the catalog with stable names", () => {
    expect(PATTERNS.length).toBeGreaterThan(0);
    const names = PATTERNS.map((p) => p.name);
    for (const required of [
      "aws-access-key",
      "gh-pat",
      "jwt",
      "pem-private-key",
      "env-assignment",
      "basic-auth-url",
      "generic-api-key",
    ]) {
      expect(names).toContain(required);
    }
  });
});
