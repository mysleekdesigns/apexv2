import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadSyntheticTasks } from "../../src/eval/tasks.js";

const TEMPLATE_DIR = path.resolve("templates/.apex/eval");

describe("loadSyntheticTasks (templates)", () => {
  it("loads node-typescript fixtures", async () => {
    const tasks = await loadSyntheticTasks({
      stack: "node-typescript",
      tasksDir: TEMPLATE_DIR,
    });
    expect(tasks.length).toBeGreaterThanOrEqual(10);
    for (const t of tasks) {
      expect(t.frontmatter.stack).toBe("node-typescript");
      expect(t.frontmatter.kind).toBe("synthetic");
      expect(t.frontmatter.prompts.length).toBeGreaterThan(0);
      expect(t.frontmatter.success_predicates.length).toBeGreaterThan(0);
    }
  });

  it("loads python fixtures", async () => {
    const tasks = await loadSyntheticTasks({
      stack: "python",
      tasksDir: TEMPLATE_DIR,
    });
    expect(tasks.length).toBeGreaterThanOrEqual(10);
    for (const t of tasks) {
      expect(t.frontmatter.stack).toBe("python");
    }
  });

  it("loads nextjs fixtures", async () => {
    const tasks = await loadSyntheticTasks({
      stack: "nextjs",
      tasksDir: TEMPLATE_DIR,
    });
    expect(tasks.length).toBeGreaterThanOrEqual(10);
    for (const t of tasks) {
      expect(t.frontmatter.stack).toBe("nextjs");
    }
  });

  it("loads all stacks when stack is omitted", async () => {
    const tasks = await loadSyntheticTasks({ tasksDir: TEMPLATE_DIR });
    const stacks = new Set(tasks.map((t) => t.frontmatter.stack));
    expect(stacks.size).toBe(3);
    expect(tasks.length).toBeGreaterThanOrEqual(30);
  });
});

describe("loadSyntheticTasks (validation)", () => {
  function makeFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-eval-tasks-"));
    fs.mkdirSync(path.join(root, "node-typescript"), { recursive: true });
    return root;
  }

  it("warns and skips a file with mismatched id", async () => {
    const root = makeFixture();
    fs.writeFileSync(
      path.join(root, "node-typescript", "ts-good.md"),
      `---
id: ts-good
stack: node-typescript
kind: synthetic
title: ok
prompts:
  - "Do a thing"
success_predicates:
  - kind: file_exists
    ref: a.ts
---
body
`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "node-typescript", "ts-bad.md"),
      `---
id: not-the-filename
stack: node-typescript
kind: synthetic
title: bad
prompts:
  - "p"
success_predicates:
  - kind: file_exists
    ref: a.ts
---
body
`,
      "utf8",
    );
    const warnings: string[] = [];
    const tasks = await loadSyntheticTasks({
      tasksDir: root,
      stack: "node-typescript",
      onWarn: (m) => warnings.push(m),
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.frontmatter.id).toBe("ts-good");
    expect(warnings.some((w) => w.includes("ts-bad.md"))).toBe(true);
  });

  it("rejects unknown predicate kinds", async () => {
    const root = makeFixture();
    fs.writeFileSync(
      path.join(root, "node-typescript", "ts-bad-pred.md"),
      `---
id: ts-bad-pred
stack: node-typescript
kind: synthetic
title: bad pred
prompts:
  - "p"
success_predicates:
  - kind: nope
    ref: a.ts
---
body
`,
      "utf8",
    );
    const warnings: string[] = [];
    const tasks = await loadSyntheticTasks({
      tasksDir: root,
      stack: "node-typescript",
      onWarn: (m) => warnings.push(m),
    });
    expect(tasks).toHaveLength(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("returns empty when stack dir is missing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-eval-empty-"));
    const tasks = await loadSyntheticTasks({ tasksDir: root, stack: "nextjs" });
    expect(tasks).toEqual([]);
  });
});
