import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import matter from "gray-matter";
import yaml from "yaml";
import { applyPack } from "../../src/packs/apply.js";

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

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "apex-pack-apply-"));
});

afterEach(async () => {
  await fs.remove(tmp);
});

describe("applyPack", () => {
  it("writes every pack entry into .apex/proposed/ with PROPOSED header", async () => {
    const result = await applyPack(tmp, "nextjs", { packsRoot: TEMPLATES_DIR });
    expect(result.dryRun).toBe(false);
    expect(result.skipped).toEqual([]);
    expect(result.written.length).toBeGreaterThanOrEqual(3);

    for (const w of result.written) {
      const exists = await fs.pathExists(w.targetPath);
      expect(exists, w.targetPath).toBe(true);
      const raw = await fs.readFile(w.targetPath, "utf8");
      expect(raw.startsWith("<!-- PROPOSED")).toBe(true);
      expect(raw.length).toBeLessThanOrEqual(16 * 1024);
    }
  });

  it("stamps `created` and `last_validated` to today's date", async () => {
    const today = "2026-04-26";
    const result = await applyPack(tmp, "rails", {
      packsRoot: TEMPLATES_DIR,
      today,
    });
    expect(result.written.length).toBeGreaterThan(0);
    for (const w of result.written) {
      const raw = await fs.readFile(w.targetPath, "utf8");
      const stripped = raw.replace(/^<!--[^\n]*-->\s*/, "");
      const fm = matter(stripped, matterOptions).data as Record<string, unknown>;
      expect(fm["created"]).toBe(today);
      expect(fm["last_validated"]).toBe(today);
    }
  });

  it("injects `pack:<id>@<version>` as the first bootstrap source", async () => {
    const result = await applyPack(tmp, "django", { packsRoot: TEMPLATES_DIR });
    for (const w of result.written) {
      const raw = await fs.readFile(w.targetPath, "utf8");
      const stripped = raw.replace(/^<!--[^\n]*-->\s*/, "");
      const fm = matter(stripped, matterOptions).data as {
        sources: Array<{ kind: string; ref: string }>;
      };
      expect(fm.sources.length).toBeGreaterThanOrEqual(1);
      expect(fm.sources[0]).toEqual({
        kind: "bootstrap",
        ref: "pack:django@1.0.0",
      });
    }
  });

  it("dry-run does not write any files", async () => {
    const result = await applyPack(tmp, "nextjs", {
      packsRoot: TEMPLATES_DIR,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.written.length).toBeGreaterThan(0);
    expect(await fs.pathExists(path.join(tmp, ".apex", "proposed"))).toBe(false);
  });

  it("is idempotent — second apply skips existing proposals", async () => {
    const first = await applyPack(tmp, "nextjs", { packsRoot: TEMPLATES_DIR });
    const second = await applyPack(tmp, "nextjs", { packsRoot: TEMPLATES_DIR });
    expect(second.written.length).toBe(0);
    expect(second.skipped.length).toBe(first.written.length);
    for (const s of second.skipped) {
      expect(s.reason).toMatch(/already exists/);
    }
  });

  it("skips proposals whose id already exists in .apex/knowledge/<type>s/", async () => {
    // Pre-seed knowledge/conventions with an id that the rails pack provides.
    const knowledgeDir = path.join(tmp, ".apex", "knowledge", "conventions");
    await fs.ensureDir(knowledgeDir);
    await fs.writeFile(
      path.join(knowledgeDir, "rails-strong-parameters.md"),
      "stub",
      "utf8",
    );

    const result = await applyPack(tmp, "rails", { packsRoot: TEMPLATES_DIR });
    const skippedIds = result.skipped.map((s) => s.id);
    expect(skippedIds).toContain("rails-strong-parameters");
    const reason = result.skipped.find((s) => s.id === "rails-strong-parameters")
      ?.reason;
    expect(reason).toMatch(/knowledge/);
    // Other entries should still be written.
    expect(result.written.length).toBeGreaterThan(0);
  });

  it("re-running with --dry-run after a real apply reports skips, not writes", async () => {
    await applyPack(tmp, "django", { packsRoot: TEMPLATES_DIR });
    const second = await applyPack(tmp, "django", {
      packsRoot: TEMPLATES_DIR,
      dryRun: true,
    });
    expect(second.dryRun).toBe(true);
    expect(second.written.length).toBe(0);
    expect(second.skipped.length).toBeGreaterThan(0);
  });

  it("propagates load errors when the pack id is unknown", async () => {
    await expect(
      applyPack(tmp, "no-such-pack", { packsRoot: TEMPLATES_DIR }),
    ).rejects.toThrow();
  });
});
