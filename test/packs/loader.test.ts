import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import {
  listAvailablePacks,
  loadPack,
  PackLoadError,
  resolvePacksRoot,
} from "../../src/packs/loader.js";
import {
  countEntries,
  validatePackEntryFrontmatter,
} from "../../src/packs/types.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../templates",
);

describe("resolvePacksRoot", () => {
  it("appends /packs to a templates directory", () => {
    expect(resolvePacksRoot("/x/templates")).toBe(path.resolve("/x/templates/packs"));
  });
  it("returns a /packs directory unchanged", () => {
    expect(resolvePacksRoot("/x/templates/packs")).toBe(
      path.resolve("/x/templates/packs"),
    );
  });
  it("appends /templates/packs to an arbitrary root", () => {
    expect(resolvePacksRoot("/x/myproj")).toBe(
      path.resolve("/x/myproj/templates/packs"),
    );
  });
});

describe("listAvailablePacks (bundled)", () => {
  it("discovers nextjs, django, rails by id", async () => {
    const packs = await listAvailablePacks(TEMPLATES_DIR);
    const ids = packs.map((p) => p.id).sort();
    expect(ids).toEqual(["django", "nextjs", "rails"]);
    for (const p of packs) {
      expect(p.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.stack.length).toBeGreaterThan(0);
    }
  });

  it("returns [] when packs root is missing", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-packs-empty-"));
    try {
      const packs = await listAvailablePacks(tmp);
      expect(packs).toEqual([]);
    } finally {
      await fs.remove(tmp);
    }
  });
});

describe("loadPack (bundled packs)", () => {
  for (const id of ["nextjs", "django", "rails"] as const) {
    it(`loads pack:${id} and validates every entry`, async () => {
      const pack = await loadPack(id, { rootOrTemplatesDir: TEMPLATES_DIR });
      expect(pack.manifest.id).toBe(id);
      expect(pack.manifest.version).toMatch(/^\d+\.\d+\.\d+/);
      expect(pack.entries.length).toBeGreaterThanOrEqual(3);
      expect(pack.entries.length).toBeLessThanOrEqual(8);

      // each entry validates against the schema
      for (const e of pack.entries) {
        const v = validatePackEntryFrontmatter(e.frontmatter, e.sourcePath);
        expect(v.ok, v.errors?.join("; ")).toBe(true);
        expect(e.frontmatter.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(e.frontmatter.last_validated >= e.frontmatter.created).toBe(true);
      }

      // counts cover the four types
      const counts = countEntries(pack.entries);
      expect(counts.total).toBe(pack.entries.length);
      const distinct = [
        counts.decisions > 0,
        counts.patterns > 0,
        counts.gotchas > 0,
        counts.conventions > 0,
      ].filter(Boolean).length;
      expect(distinct, "pack should cover ≥ 3 entry types").toBeGreaterThanOrEqual(3);
    });
  }

  it("throws PackLoadError when the pack does not exist", async () => {
    await expect(
      loadPack("does-not-exist", { rootOrTemplatesDir: TEMPLATES_DIR }),
    ).rejects.toBeInstanceOf(PackLoadError);
  });
});

describe("loadPack with synthetic broken pack", () => {
  let tmp: string;
  let packsDir: string;
  let badPack: string;

  beforeAll(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-pack-broken-"));
    packsDir = path.join(tmp, "templates", "packs");
    badPack = path.join(packsDir, "bad");
    await fs.ensureDir(path.join(badPack, "entries"));
  });

  afterAll(async () => {
    await fs.remove(tmp);
  });

  beforeEach(async () => {
    // reset
    await fs.emptyDir(badPack);
    await fs.ensureDir(path.join(badPack, "entries"));
    await fs.writeFile(
      path.join(badPack, "pack.toml"),
      [
        'id = "bad"',
        'version = "1.0.0"',
        'title = "Bad pack"',
        'description = "Synthetic broken pack for tests."',
        'stack = "test"',
      ].join("\n"),
      "utf8",
    );
  });

  it("rejects an entry whose filename stem does not match its id", async () => {
    await fs.writeFile(
      path.join(badPack, "entries", "wrong-name.md"),
      [
        "---",
        "id: actual-id",
        "type: convention",
        "title: Mismatched filename",
        "applies_to: team",
        "confidence: medium",
        "sources:",
        "  - kind: manual",
        "    ref: manual/test",
        "created: 2026-04-26",
        "last_validated: 2026-04-26",
        "rule: Whatever",
        "enforcement: manual",
        "---",
        "",
        "Body.",
      ].join("\n"),
      "utf8",
    );
    await expect(loadPack("bad", { rootOrTemplatesDir: tmp })).rejects.toThrow(
      /filename stem/,
    );
  });

  it("rejects an entry whose frontmatter is missing required fields", async () => {
    await fs.writeFile(
      path.join(badPack, "entries", "missing.md"),
      [
        "---",
        "id: missing",
        "type: convention",
        "title: Missing required fields",
        "applies_to: team",
        "confidence: medium",
        "sources:",
        "  - kind: manual",
        "    ref: manual/test",
        "created: 2026-04-26",
        "last_validated: 2026-04-26",
        // missing `rule` and `enforcement`
        "---",
        "",
        "Body.",
      ].join("\n"),
      "utf8",
    );
    await expect(loadPack("bad", { rootOrTemplatesDir: tmp })).rejects.toBeInstanceOf(
      PackLoadError,
    );
  });

  it("rejects an entry where last_validated < created", async () => {
    await fs.writeFile(
      path.join(badPack, "entries", "out-of-order.md"),
      [
        "---",
        "id: out-of-order",
        "type: convention",
        "title: Dates out of order",
        "applies_to: team",
        "confidence: medium",
        "sources:",
        "  - kind: manual",
        "    ref: manual/test",
        "created: 2026-04-26",
        "last_validated: 2024-01-01",
        "rule: r",
        "enforcement: manual",
        "---",
        "",
        "Body.",
      ].join("\n"),
      "utf8",
    );
    await expect(loadPack("bad", { rootOrTemplatesDir: tmp })).rejects.toThrow(
      /last_validated/,
    );
  });

  it("rejects when manifest id mismatches directory", async () => {
    await fs.writeFile(
      path.join(badPack, "pack.toml"),
      [
        'id = "different"',
        'version = "1.0.0"',
        'title = "Mismatched"',
        'description = "..."',
        'stack = "x"',
      ].join("\n"),
      "utf8",
    );
    await expect(loadPack("bad", { rootOrTemplatesDir: tmp })).rejects.toThrow(
      /does not match directory/,
    );
  });
});
