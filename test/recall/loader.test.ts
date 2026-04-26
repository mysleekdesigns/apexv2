import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadKnowledgeWithWarnings } from "../../src/recall/loader.js";

function setupFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-loader-"));
  const src = path.resolve("test/fixtures/knowledge");
  const dest = path.join(root, ".apex", "knowledge");
  fs.mkdirSync(dest, { recursive: true });
  for (const sub of ["decisions", "patterns", "gotchas", "conventions"]) {
    fs.mkdirSync(path.join(dest, sub), { recursive: true });
    const dir = path.join(src, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      fs.copyFileSync(path.join(dir, f), path.join(dest, sub, f));
    }
  }
  return root;
}

describe("loadKnowledge", () => {
  let root: string;
  let warnings: string[];

  beforeEach(() => {
    root = setupFixture();
    warnings = [];
  });

  it("loads the full fixture set (3 of each type)", async () => {
    const { entries } = await loadKnowledgeWithWarnings(root, {
      onWarn: (m) => warnings.push(m),
    });
    expect(entries).toHaveLength(12);
    const byType = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.frontmatter.type] = (acc[e.frontmatter.type] ?? 0) + 1;
      return acc;
    }, {});
    expect(byType["decision"]).toBe(3);
    expect(byType["pattern"]).toBe(3);
    expect(byType["gotcha"]).toBe(3);
    expect(byType["convention"]).toBe(3);
    expect(warnings).toHaveLength(0);
  });

  it("returns repo-relative paths", async () => {
    const { entries } = await loadKnowledgeWithWarnings(root, {
      onWarn: (m) => warnings.push(m),
    });
    for (const e of entries) {
      expect(path.isAbsolute(e.path)).toBe(false);
      expect(e.path.startsWith(".apex/knowledge/")).toBe(true);
    }
  });

  it("skips invalid entries with a warning", async () => {
    // Drop a malformed file into conventions/
    const bad = path.join(
      root,
      ".apex",
      "knowledge",
      "conventions",
      "broken.md",
    );
    fs.writeFileSync(bad, "---\nid: broken\n---\nno required fields\n", "utf8");

    // Drop one with mismatched id
    const mismatch = path.join(
      root,
      ".apex",
      "knowledge",
      "patterns",
      "mismatch-id.md",
    );
    fs.writeFileSync(
      mismatch,
      `---
id: not-the-filename
type: pattern
title: bad id
applies_to: all
confidence: high
sources:
  - kind: manual
    ref: manual/test
created: 2026-01-01
last_validated: 2026-04-01
intent: nope
applies_when:
  - never
---
body
`,
      "utf8",
    );

    const { entries, warnings: warns } = await loadKnowledgeWithWarnings(root, {
      onWarn: (m) => warnings.push(m),
    });
    expect(entries).toHaveLength(12); // same as before; both invalid skipped
    expect(warns.length).toBeGreaterThanOrEqual(2);
    expect(warns.some((w) => w.includes("broken.md"))).toBe(true);
    expect(warns.some((w) => w.includes("mismatch-id.md"))).toBe(true);
  });

  it("returns empty array when the dir is missing", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "apex-empty-"));
    const { entries, warnings: warns } = await loadKnowledgeWithWarnings(empty);
    expect(entries).toEqual([]);
    expect(warns).toEqual([]);
  });
});
