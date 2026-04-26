import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { findDriftEntries } from "../../src/curator/drift.js";
import type { KnowledgeEntry } from "../../src/types/shared.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-drift-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeGotcha(id: string, refs: string[]): KnowledgeEntry {
  return {
    frontmatter: {
      id,
      type: "gotcha",
      title: `Gotcha ${id}`,
      applies_to: "all",
      confidence: "medium",
      sources: refs.map((ref) => ({ kind: "correction" as const, ref })),
      created: "2026-01-01",
      last_validated: "2026-04-01",
      symptom: "Something breaks",
      resolution: "Fix it like this",
    },
    body: "Body text.",
    path: `.apex/knowledge/gotchas/${id}.md`,
  };
}

function makeDecision(id: string, refs: string[]): KnowledgeEntry {
  return {
    frontmatter: {
      id,
      type: "decision",
      title: `Decision ${id}`,
      applies_to: "all",
      confidence: "high",
      sources: refs.map((ref) => ({ kind: "manual" as const, ref })),
      created: "2026-01-01",
      last_validated: "2026-04-01",
      decision: "We decided X",
      rationale: "Because Y",
      outcome: "Z happened",
    },
    body: "Body text.",
    path: `.apex/knowledge/decisions/${id}.md`,
  };
}

describe("findDriftEntries", () => {
  it("returns empty array for empty input", () => {
    expect(findDriftEntries([], tmpDir)).toEqual([]);
  });

  it("does not flag gotchas with no file/ refs", () => {
    const entry = makeGotcha("no-file-ref", ["episode/abc/turn-1", "pr/42"]);
    expect(findDriftEntries([entry], tmpDir)).toHaveLength(0);
  });

  it("does not flag gotchas when the referenced file exists", () => {
    // Create the file
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "index.ts"), "// content", "utf8");

    const entry = makeGotcha("existing-file-ref", ["file/src/index.ts:42"]);
    expect(findDriftEntries([entry], tmpDir)).toHaveLength(0);
  });

  it("flags gotchas when the referenced file does not exist", () => {
    const entry = makeGotcha("missing-file-ref", ["file/src/deleted.ts:10"]);
    const result = findDriftEntries([entry], tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.entry.frontmatter.id).toBe("missing-file-ref");
    expect(result[0]!.ref).toBe("file/src/deleted.ts:10");
    expect(result[0]!.missingPath).toBe("src/deleted.ts");
  });

  it("does not flag non-gotcha entries (only gotchas are checked)", () => {
    const decision = makeDecision("decision-missing-file", ["file/src/gone.ts:5"]);
    expect(findDriftEntries([decision], tmpDir)).toHaveLength(0);
  });

  it("handles file/ refs without a line number", () => {
    const entry = makeGotcha("no-line-ref", ["file/src/missing-no-line.ts"]);
    const result = findDriftEntries([entry], tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.missingPath).toBe("src/missing-no-line.ts");
  });

  it("only reports once per entry even if multiple refs are missing", () => {
    const entry = makeGotcha("multi-missing", [
      "file/src/gone-a.ts:1",
      "file/src/gone-b.ts:2",
    ]);
    const result = findDriftEntries([entry], tmpDir);
    // Only one DriftEntry per knowledge entry
    expect(result).toHaveLength(1);
    expect(result[0]!.ref).toBe("file/src/gone-a.ts:1");
  });

  it("only flags the missing file, not the present one", () => {
    // Create one file but not the other
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "present.ts"), "// ok", "utf8");

    const entry = makeGotcha("mixed-refs", [
      "file/src/present.ts:1",
      "file/src/absent.ts:2",
    ]);
    const result = findDriftEntries([entry], tmpDir);
    // present.ts exists so first ref is ok; absent.ts triggers drift
    expect(result).toHaveLength(1);
    expect(result[0]!.missingPath).toBe("src/absent.ts");
  });

  it("handles nested paths correctly", () => {
    const entry = makeGotcha("nested-missing", ["file/apps/web/src/utils/helper.ts:99"]);
    const result = findDriftEntries([entry], tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.missingPath).toBe("apps/web/src/utils/helper.ts");
  });

  it("does not flag gotchas with only episode or git refs", () => {
    const entry = makeGotcha("no-drift", [
      "episode/2026-03-01-1000-abcd/turn-4",
      "git/abc1234",
    ]);
    expect(findDriftEntries([entry], tmpDir)).toHaveLength(0);
  });
});
