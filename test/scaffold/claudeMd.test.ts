import { describe, expect, it } from "vitest";
import {
  mergeIntoExistingClaudeMd,
  renderClaudeMd,
} from "../../src/scaffold/claudeMd.js";
import { renderAllRules, renderStackRules } from "../../src/scaffold/rules.js";
import {
  APEX_MANAGED_BEGIN,
  APEX_MANAGED_END,
  type StackDetection,
} from "../../src/types/shared.js";

const NODE_TS_NEXT: StackDetection = {
  language: "node",
  frameworks: ["next"],
  packageManager: "pnpm",
  testRunner: "vitest",
  lint: ["eslint"],
  format: ["prettier"],
  ci: ["github-actions"],
  hasTypeScript: true,
  rawSignals: {},
};

const VERSION = "0.1.0-phase1";

describe("renderClaudeMd", () => {
  it("renders under 200 lines for a Node/TS/Next.js stack", async () => {
    const md = await renderClaudeMd(NODE_TS_NEXT, VERSION);
    const lineCount = md.split("\n").length;
    expect(lineCount).toBeLessThanOrEqual(200);
    expect(lineCount).toBeGreaterThan(20); // sanity
  });

  it("substitutes every template variable", async () => {
    const md = await renderClaudeMd(NODE_TS_NEXT, VERSION);
    // No leftover `{{VAR}}` tokens.
    expect(md).not.toMatch(/\{\{[A-Z_]+\}\}/);
    // Stack values appear.
    expect(md).toContain("pnpm");
    expect(md).toContain("vitest");
    expect(md).toContain("eslint");
    expect(md).toContain("prettier");
    expect(md).toContain("Node / TypeScript");
    expect(md).toContain(VERSION);
  });

  it("emits all required section markers", async () => {
    const md = await renderClaudeMd(NODE_TS_NEXT, VERSION);
    const requiredSections = [
      "stack",
      "commands",
      "layout",
      "rules-of-the-road",
      "imports",
      "retrieval",
    ];
    for (const s of requiredSections) {
      expect(md).toContain(`<!-- apex:section:${s} -->`);
      expect(md).toContain(`<!-- apex:section:${s}:end -->`);
    }
  });

  it("wraps the managed region in apex:begin / apex:end markers", async () => {
    const md = await renderClaudeMd(NODE_TS_NEXT, VERSION);
    expect(md).toContain(APEX_MANAGED_BEGIN);
    expect(md).toContain(APEX_MANAGED_END);
    expect(md.indexOf(APEX_MANAGED_BEGIN)).toBeLessThan(md.indexOf(APEX_MANAGED_END));
  });

  it("includes @-imports for the .claude/rules files", async () => {
    const md = await renderClaudeMd(NODE_TS_NEXT, VERSION);
    expect(md).toContain("@.claude/rules/00-stack.md");
    expect(md).toContain("@.claude/rules/10-conventions.md");
    expect(md).toContain("@.claude/rules/20-gotchas.md");
  });

  it("renders the Common Commands list using pnpm", async () => {
    const md = await renderClaudeMd(NODE_TS_NEXT, VERSION);
    expect(md).toContain("pnpm install");
    expect(md).toContain("pnpm test");
    // typecheck is included when TS is detected.
    expect(md).toMatch(/pnpm (run )?typecheck/);
  });
});

describe("mergeIntoExistingClaudeMd", () => {
  it("appends the managed block when the user's CLAUDE.md has no markers", async () => {
    const generated = await renderClaudeMd(NODE_TS_NEXT, VERSION);
    const userContent = [
      "# My Project",
      "",
      "Custom intro paragraph the user wrote.",
      "",
      "## Their own section",
      "Some content.",
    ].join("\n");

    const merged = mergeIntoExistingClaudeMd(userContent, generated);

    // User content preserved verbatim.
    expect(merged).toContain("# My Project");
    expect(merged).toContain("Custom intro paragraph the user wrote.");
    expect(merged).toContain("Their own section");
    // Managed block injected.
    expect(merged).toContain(APEX_MANAGED_BEGIN);
    expect(merged).toContain(APEX_MANAGED_END);
    // User content comes before the managed block.
    expect(merged.indexOf("# My Project")).toBeLessThan(
      merged.indexOf(APEX_MANAGED_BEGIN),
    );
  });

  it("replaces the existing managed block in place, preserving surrounding content", async () => {
    const generated = await renderClaudeMd(NODE_TS_NEXT, VERSION);

    const stale = [
      "# My Project",
      "",
      "User intro.",
      "",
      APEX_MANAGED_BEGIN,
      "stale managed content from a prior version",
      APEX_MANAGED_END,
      "",
      "Footer the user added below.",
    ].join("\n");

    const merged = mergeIntoExistingClaudeMd(stale, generated);

    expect(merged).toContain("# My Project");
    expect(merged).toContain("User intro.");
    expect(merged).toContain("Footer the user added below.");
    expect(merged).not.toContain("stale managed content from a prior version");
    // Fresh managed content replaced the old block.
    expect(merged).toContain("## Project Stack");
    expect(merged).toContain("pnpm install");
  });

  it("is idempotent: re-merging the same generated block twice yields the same result", async () => {
    const generated = await renderClaudeMd(NODE_TS_NEXT, VERSION);
    const userContent = [
      "# My Project",
      "",
      "Some prose.",
      "",
      "Trailing footer.",
    ].join("\n");

    const once = mergeIntoExistingClaudeMd(userContent, generated);
    const twice = mergeIntoExistingClaudeMd(once, generated);
    expect(twice).toBe(once);
  });

  it("returns the generated content when the existing file is empty", async () => {
    const generated = await renderClaudeMd(NODE_TS_NEXT, VERSION);
    const merged = mergeIntoExistingClaudeMd("", generated);
    expect(merged).toContain(APEX_MANAGED_BEGIN);
    expect(merged).toContain(APEX_MANAGED_END);
    expect(merged.endsWith("\n")).toBe(true);
  });

  it("round-trips: render -> merge -> re-merge -> user content preserved exactly", async () => {
    const generated = await renderClaudeMd(NODE_TS_NEXT, VERSION);
    const userParagraphs = [
      "# Acme Service",
      "",
      "This service handles checkout for the Acme storefront.",
      "Owners: @platform-team",
      "",
      "## Local dev",
      "Start the dev server with `make dev`.",
      "",
    ].join("\n");

    const first = mergeIntoExistingClaudeMd(userParagraphs, generated);
    const second = mergeIntoExistingClaudeMd(first, generated);

    // User content survives both passes verbatim.
    expect(second).toContain("# Acme Service");
    expect(second).toContain(
      "This service handles checkout for the Acme storefront.",
    );
    expect(second).toContain("Owners: @platform-team");
    expect(second).toContain("Start the dev server with `make dev`.");
    // Idempotent.
    expect(second).toBe(first);
  });
});

describe("renderStackRules", () => {
  it("renders 00-stack.md with stack vars and frontmatter", async () => {
    const stack = await renderStackRules(NODE_TS_NEXT, VERSION);
    expect(stack).toMatch(/^---\n/);
    expect(stack).toContain("status: managed");
    expect(stack).toContain("Node / TypeScript");
    expect(stack).toContain("pnpm");
    expect(stack).toContain("vitest");
    expect(stack).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("renderAllRules returns stack + two stubs with frontmatter", async () => {
    const all = await renderAllRules(NODE_TS_NEXT, VERSION);
    expect(all.map((r) => r.filename)).toEqual([
      "00-stack.md",
      "10-conventions.md",
      "20-gotchas.md",
    ]);
    for (const r of all.slice(1)) {
      expect(r.content).toMatch(/^---\n/);
      expect(r.content).toContain("status: stub");
      expect(r.content).toContain("Populated automatically");
    }
  });
});
