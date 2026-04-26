import { describe, it, expect } from "vitest";
import { validateFrontmatter, stripProposedHeader } from "../../src/promote/validate.js";

const TODAY = new Date().toISOString().slice(0, 10);

// --- Happy-path fixtures ---

const VALID_GOTCHA = `---
id: "test-gotcha"
type: "gotcha"
title: "Test gotcha entry"
applies_to: "all"
confidence: "low"
sources:
  - kind: "bootstrap"
    ref: "episode/2026-04-20/turn-1"
created: "${TODAY}"
last_validated: "${TODAY}"
symptom: "Something breaks"
resolution: "Do the right thing"
---

Body content here.
`;

const VALID_CONVENTION = `---
id: "test-convention"
type: "convention"
title: "Test convention entry"
applies_to: "all"
confidence: "medium"
sources:
  - kind: "manual"
    ref: "manual/author"
created: "2026-01-01"
last_validated: "2026-04-01"
rule: "Always do this"
enforcement: "lint"
---

Convention body.
`;

const VALID_DECISION = `---
id: "use-pnpm"
type: "decision"
title: "Use pnpm as package manager"
applies_to: "team"
confidence: "high"
sources:
  - kind: "bootstrap"
    ref: "file/package.json:1"
  - kind: "reflection"
    ref: "episode/2026-04-22/turn-3"
created: "2026-04-22"
last_validated: "2026-04-25"
decision: "Use pnpm exclusively"
rationale: "Faster installs, stricter dependency management"
outcome: "CI is 30% faster"
---

Decision body.
`;

const VALID_PATTERN = `---
id: "zod-validation"
type: "pattern"
title: "Validate inputs with Zod"
applies_to: "team"
confidence: "medium"
sources:
  - kind: "bootstrap"
    ref: "file/src/routes/users.ts:14"
created: "2026-04-02"
last_validated: "2026-04-25"
intent: "Reject malformed inputs at the boundary"
applies_when:
  - "Adding a new POST route"
  - "Refactoring routes with any casts"
---

Pattern body.
`;

describe("validateFrontmatter — happy paths", () => {
  it("validates a valid gotcha", () => {
    const result = validateFrontmatter(VALID_GOTCHA);
    expect(result.valid).toBe(true);
    expect(result.frontmatter?.["id"]).toBe("test-gotcha");
    expect(result.frontmatter?.["type"]).toBe("gotcha");
    expect(result.body).toBe("Body content here.");
  });

  it("validates a valid convention", () => {
    const result = validateFrontmatter(VALID_CONVENTION);
    expect(result.valid).toBe(true);
    expect(result.frontmatter?.["type"]).toBe("convention");
  });

  it("validates a valid decision", () => {
    const result = validateFrontmatter(VALID_DECISION);
    expect(result.valid).toBe(true);
    expect(result.frontmatter?.["decision"]).toBe("Use pnpm exclusively");
    expect(result.frontmatter?.["rationale"]).toBeDefined();
    expect(result.frontmatter?.["outcome"]).toBeDefined();
  });

  it("validates a valid pattern", () => {
    const result = validateFrontmatter(VALID_PATTERN);
    expect(result.valid).toBe(true);
    expect(result.frontmatter?.["intent"]).toBeDefined();
    const appliesWhen = result.frontmatter?.["applies_when"] as string[];
    expect(Array.isArray(appliesWhen)).toBe(true);
    expect(appliesWhen.length).toBeGreaterThanOrEqual(1);
  });

  it("returns the body trimmed", () => {
    const result = validateFrontmatter(VALID_GOTCHA);
    expect(result.valid).toBe(true);
    expect(result.body).toBe("Body content here.");
  });
});

describe("validateFrontmatter — sad paths", () => {
  it("rejects missing frontmatter", () => {
    const result = validateFrontmatter("No frontmatter here.");
    expect(result.valid).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it("rejects invalid type", () => {
    const bad = VALID_GOTCHA.replace('type: "gotcha"', 'type: "unknown-type"');
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toMatch(/type/i);
  });

  it("rejects missing required gotcha field: symptom", () => {
    const bad = VALID_GOTCHA.replace(/^symptom:.*$/m, "");
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toMatch(/symptom/i);
  });

  it("rejects missing required gotcha field: resolution", () => {
    const bad = VALID_GOTCHA.replace(/^resolution:.*$/m, "");
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects missing required decision fields", () => {
    const bad = VALID_DECISION.replace(/^decision:.*$/m, "");
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toMatch(/decision/i);
  });

  it("rejects missing required pattern field: applies_when", () => {
    const bad = VALID_PATTERN.replace(/^applies_when:[\s\S]*?(?=\n---)/m, "");
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects missing required convention field: rule", () => {
    const bad = VALID_CONVENTION.replace(/^rule:.*$/m, "");
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toMatch(/rule/i);
  });

  it("rejects missing required convention field: enforcement", () => {
    const bad = VALID_CONVENTION.replace(/^enforcement:.*$/m, "");
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects invalid confidence value", () => {
    const bad = VALID_GOTCHA.replace('confidence: "low"', 'confidence: "extreme"');
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toMatch(/confidence/i);
  });

  it("rejects invalid id (uppercase)", () => {
    const bad = VALID_GOTCHA.replace('id: "test-gotcha"', 'id: "Test-Gotcha"');
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
  });

  it("rejects empty sources array", () => {
    const bad = VALID_GOTCHA.replace(
      /^sources:[\s\S]*?(?=created:)/m,
      "sources: []\n",
    );
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toMatch(/sources/i);
  });

  it("rejects last_validated before created", () => {
    const bad = VALID_GOTCHA
      .replace(`created: "${TODAY}"`, 'created: "2026-04-25"')
      .replace(`last_validated: "${TODAY}"`, 'last_validated: "2026-04-01"');
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toMatch(/last_validated/i);
  });

  it("rejects invalid date format", () => {
    const bad = VALID_GOTCHA.replace(`created: "${TODAY}"`, 'created: "26-04-2026"');
    const result = validateFrontmatter(bad);
    expect(result.valid).toBe(false);
  });

  it("includes the file path in error messages when provided", () => {
    const result = validateFrontmatter("no frontmatter", "/some/path/to/file.md");
    expect(result.valid).toBe(false);
    expect(result.errors!.join(" ")).toContain("/some/path/to/file.md");
  });
});

describe("stripProposedHeader", () => {
  it("strips the PROPOSED header line", () => {
    const withHeader =
      "<!-- PROPOSED — review before moving to .apex/knowledge/ -->\n---\nid: foo\n---\n\nbody\n";
    const stripped = stripProposedHeader(withHeader);
    expect(stripped.startsWith("---")).toBe(true);
  });

  it("is a no-op when header is absent", () => {
    const noHeader = "---\nid: foo\n---\n\nbody\n";
    const result = stripProposedHeader(noHeader);
    expect(result).toBe(noHeader);
  });

  it("handles reflector-style header with dashes", () => {
    const withHeader =
      "<!-- PROPOSED — auto-generated by reflector -->\n---\nid: bar\n---\n";
    const stripped = stripProposedHeader(withHeader);
    expect(stripped.startsWith("---")).toBe(true);
  });
});
