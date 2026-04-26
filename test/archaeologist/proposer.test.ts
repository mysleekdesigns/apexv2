import { describe, it, expect } from "vitest";
import { proposeDrafts, pendingStackBody } from "../../src/archaeologist/proposer.js";
import type {
  CiSignal,
  GitLogSignal,
  OpenPrsSignal,
  ReadmeSignal,
  Signal,
  TestRunnerSignal,
  TopImportsSignal,
} from "../../src/archaeologist/signals.js";
import type { StackDetection } from "../../src/types/shared.js";

const detection: StackDetection = {
  language: "node",
  frameworks: ["next"],
  packageManager: "pnpm",
  testRunner: "vitest",
  lint: ["eslint"],
  format: ["prettier"],
  ci: ["github-actions"],
  hasTypeScript: true,
  rawSignals: { "package.json": "present" },
};

const gl: GitLogSignal = {
  kind: "git-log",
  available: true,
  commitCount: 100,
  topAuthors: [{ name: "Alice", email: "a@b.com", commits: 60 }],
  topKeywords: [{ word: "auth", count: 5 }],
  conventionalPrefixes: [
    { prefix: "feat", count: 30 },
    { prefix: "fix", count: 20 },
    { prefix: "chore", count: 10 },
  ],
  recentCommits: [
    { sha: "aaa1111", author: "Alice", subject: "feat: add login" },
    { sha: "bbb2222", author: "Alice", subject: "fix: avoid null deref" },
    { sha: "ccc3333", author: "Alice", subject: "fix: race in worker" },
    { sha: "ddd4444", author: "Alice", subject: "fix: typo in config" },
    { sha: "eee5555", author: "Alice", subject: "fix: stale cache" },
    { sha: "fff6666", author: "Alice", subject: "fix: bad date format" },
  ],
};

const rs: ReadmeSignal = {
  kind: "readme",
  available: true,
  path: "README.md",
  h1: "My Project",
  gettingStarted: { startLine: 5, body: "pnpm install" },
  stackMentions: ["TypeScript", "pnpm"],
};

const ts: TestRunnerSignal = {
  kind: "test-runner",
  available: true,
  runner: "vitest",
  testFiles: ["src/foo.test.ts", "src/bar.test.ts"],
  testDirs: ["src"],
};

const ti: TopImportsSignal = {
  kind: "top-imports",
  available: true,
  language: "node",
  ranked: [
    { pkg: "zod", count: 8 },
    { pkg: "fs-extra", count: 4 },
    { pkg: "kleur", count: 2 },
  ],
};

const ci: CiSignal = {
  kind: "ci",
  available: true,
  workflows: [
    {
      file: ".github/workflows/ci.yml",
      steps: ["pnpm lint", "pnpm test", "pnpm build", "Setup pnpm"],
    },
  ],
};

const prs: OpenPrsSignal = {
  kind: "open-prs",
  available: true,
  prs: [{ number: 12, title: "Add caching layer", body: "Caching for the API" }],
};

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidFm(fm: Record<string, unknown>): void {
  expect(fm.id).toMatch(ID_RE);
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

describe("proposeDrafts", () => {
  it("produces drafts with valid frontmatter", () => {
    const signals: Signal[] = [gl, rs, ts, ti, ci, prs];
    const drafts = proposeDrafts(signals, detection);
    expect(drafts.length).toBeGreaterThan(0);
    for (const d of drafts) {
      isValidFm(d.frontmatter);
      expect(typeof d.body).toBe("string");
      expect(d.body.length).toBeGreaterThan(0);
    }
  });

  it("enforces required fields per type", () => {
    const drafts = proposeDrafts([gl, rs, ts, ti, ci, prs], detection);
    for (const d of drafts) {
      const fm = d.frontmatter as Record<string, unknown>;
      switch (fm.type) {
        case "decision":
          expect(fm.decision).toBeDefined();
          expect(fm.rationale).toBeDefined();
          expect(fm.outcome).toBeDefined();
          break;
        case "pattern":
          expect(fm.intent).toBeDefined();
          expect(Array.isArray(fm.applies_when)).toBe(true);
          expect((fm.applies_when as unknown[]).length).toBeGreaterThanOrEqual(1);
          break;
        case "gotcha":
          expect(fm.symptom).toBeDefined();
          expect(fm.resolution).toBeDefined();
          break;
        case "convention":
          expect(fm.rule).toBeDefined();
          expect(["manual", "lint", "ci", "hook"]).toContain(fm.enforcement);
          break;
      }
    }
  });

  it("sets confidence: low across the board", () => {
    const drafts = proposeDrafts([gl, rs, ts, ti, ci, prs], detection);
    for (const d of drafts) expect(d.frontmatter.confidence).toBe("low");
  });

  it("includes a package-manager convention and a test-runner convention", () => {
    const drafts = proposeDrafts([gl, rs, ts, ti, ci, prs], detection);
    const ids = drafts.map((d) => d.frontmatter.id);
    expect(ids).toEqual(expect.arrayContaining(["pm-use-pnpm", "test-runner-vitest"]));
  });

  it("emits a recurring-fix gotcha when fix commits dominate", () => {
    const drafts = proposeDrafts([gl, rs, ts, ti, ci, prs], detection);
    const gotcha = drafts.find((d) => d.frontmatter.id === "recurring-fix-area");
    expect(gotcha).toBeDefined();
    expect(gotcha!.frontmatter.type).toBe("gotcha");
  });

  it("does not duplicate ids", () => {
    const drafts = proposeDrafts([gl, rs, ts, ti, ci, prs], detection);
    const ids = drafts.map((d) => d.frontmatter.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("pendingStackBody", () => {
  it("produces a non-empty markdown summary", () => {
    const md = pendingStackBody(detection, [gl, rs, ts, ti, ci, prs]);
    expect(md).toContain("# Pending stack summary");
    expect(md).toContain("`node`");
    expect(md).toContain("`pnpm`");
    expect(md).toContain("`vitest`");
  });
});
