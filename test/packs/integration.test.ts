import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import matter from "gray-matter";
import yaml from "yaml";
import { applyPack } from "../../src/packs/apply.js";
import { listAvailablePacks, loadPack } from "../../src/packs/loader.js";
import { validateProposal } from "../../src/promote/validate.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../templates",
);

const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateFrontmatter(fm: Record<string, unknown>): void {
  expect(fm["id"]).toMatch(ID_RE);
  expect((fm["id"] as string).length).toBeLessThanOrEqual(64);
  expect(typeof fm["title"]).toBe("string");
  expect((fm["title"] as string).length).toBeLessThanOrEqual(120);
  expect(["decision", "pattern", "gotcha", "convention"]).toContain(fm["type"]);
  expect(["user", "team", "all"]).toContain(fm["applies_to"]);
  expect(["low", "medium", "high"]).toContain(fm["confidence"]);
  expect(Array.isArray(fm["sources"])).toBe(true);
  expect((fm["sources"] as unknown[]).length).toBeGreaterThanOrEqual(1);
  expect(fm["created"]).toMatch(DATE_RE);
  expect(fm["last_validated"]).toMatch(DATE_RE);
  expect((fm["last_validated"] as string) >= (fm["created"] as string)).toBe(true);

  switch (fm["type"]) {
    case "decision":
      expect(fm["decision"]).toBeTruthy();
      expect(fm["rationale"]).toBeTruthy();
      expect(fm["outcome"]).toBeTruthy();
      break;
    case "pattern":
      expect(fm["intent"]).toBeTruthy();
      expect(Array.isArray(fm["applies_when"])).toBe(true);
      break;
    case "gotcha":
      expect(fm["symptom"]).toBeTruthy();
      expect(fm["resolution"]).toBeTruthy();
      break;
    case "convention":
      expect(fm["rule"]).toBeTruthy();
      expect(["manual", "lint", "ci", "hook"]).toContain(fm["enforcement"]);
      break;
  }
}

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-pack-int-"));
});

afterEach(async () => {
  await fs.remove(tmp);
});

describe("packs end-to-end", () => {
  it("listAvailablePacks → loadPack → applyPack chain works for all bundled packs", async () => {
    const packs = await listAvailablePacks(TEMPLATES_DIR);
    expect(packs.length).toBe(3);

    for (const desc of packs) {
      const pack = await loadPack(desc.id, { rootOrTemplatesDir: TEMPLATES_DIR });
      expect(pack.entries.length).toBeGreaterThan(0);

      const result = await applyPack(tmp, desc.id, {
        packsRoot: TEMPLATES_DIR,
      });
      expect(result.written.length).toBe(pack.entries.length);

      // Every written file must validate against the project-wide promote
      // validator — i.e. they are real, promotable proposals.
      for (const w of result.written) {
        const v = await validateProposal(w.targetPath);
        expect(v.valid, JSON.stringify(v.errors)).toBe(true);
        if (v.frontmatter) validateFrontmatter(v.frontmatter);
      }

      // Tear down for the next pack — keeps the test independent.
      await fs.remove(path.join(tmp, ".apex"));
    }
  });

  it("written proposals contain the PROPOSED header line and survive matter parsing", async () => {
    const result = await applyPack(tmp, "nextjs", { packsRoot: TEMPLATES_DIR });
    for (const w of result.written) {
      const raw = await fs.readFile(w.targetPath, "utf8");
      expect(raw.startsWith("<!-- PROPOSED")).toBe(true);
      const stripped = raw.replace(/^<!--[^\n]*-->\s*/, "");
      const parsed = matter(stripped, matterOptions);
      expect(parsed.data).toBeTruthy();
      const fm = parsed.data as Record<string, unknown>;
      expect(`${fm["id"]}.md`).toBe(path.basename(w.targetPath));
    }
  });

  it("dry-run reports counts but writes nothing, even with multiple packs", async () => {
    for (const id of ["nextjs", "django", "rails"] as const) {
      const result = await applyPack(tmp, id, {
        packsRoot: TEMPLATES_DIR,
        dryRun: true,
      });
      expect(result.dryRun).toBe(true);
      expect(result.written.length).toBeGreaterThan(0);
    }
    expect(await fs.pathExists(path.join(tmp, ".apex", "proposed"))).toBe(false);
  });
});
