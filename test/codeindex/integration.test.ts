import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { CodeIndex } from "../../src/codeindex/index.js";
import { apexFindSymbol } from "../../src/codeindex/mcp-tools.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureSrc = path.resolve(here, "../fixtures/codeindex");

async function copyFixture(): Promise<string> {
  const dest = await fsp.mkdtemp(path.join(os.tmpdir(), "apex-codeindex-int-"));
  await fsp.cp(fixtureSrc, dest, { recursive: true });
  await fsp.mkdir(path.join(dest, "node_modules", "fake"), { recursive: true });
  await fsp.writeFile(
    path.join(dest, "node_modules", "fake", "junk.ts"),
    "export function ignored() {}",
    "utf8",
  );
  return dest;
}

describe("CodeIndex integration", () => {
  let root: string;
  let index: CodeIndex;

  beforeAll(async () => {
    root = await copyFixture();
    index = new CodeIndex(root);
    await index.sync();
  }, 30_000);

  afterAll(() => {
    index.close();
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("indexes TS, JS and Python sources", async () => {
    const stats = await index.stats();
    expect(stats.totalFiles).toBeGreaterThanOrEqual(3);
    expect(stats.byLanguage.ts).toBeGreaterThan(0);
    expect(stats.byLanguage.js).toBeGreaterThan(0);
    expect(stats.byLanguage.py).toBeGreaterThan(0);
  });

  it("finds symbols by name", async () => {
    const hits = await index.findSymbol("authHandler", { k: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.symbol).toBe("authHandler");
    expect(hits[0]!.file).toBe("auth/handler.ts");
  });

  it("findByPathHint surfaces auth symbols", async () => {
    const hits = await index.findByPathHint("auth handler", { k: 10 });
    const files = hits.map((h) => h.file);
    expect(files.some((f) => f.includes("auth/handler.ts"))).toBe(true);
  });

  it("respects .gitignore (does not index ignored.ts)", async () => {
    const hits = await index.findSymbol("shouldNotBeIndexed", { k: 5 });
    expect(hits.length).toBe(0);
  });

  it("skips node_modules even when not gitignored", async () => {
    const hits = await index.findSymbol("ignored", { k: 5 });
    const fromNm = hits.filter((h) => h.file.includes("node_modules"));
    expect(fromNm.length).toBe(0);
  });

  it("incremental sync: no updates when nothing changes", async () => {
    const result = await index.sync();
    expect(result.filesUpdated).toBe(0);
  });

  it("apexFindSymbol returns hits with optional path hint", async () => {
    const out = await apexFindSymbol(
      { root },
      { query: "verify", path_hint: "auth", k: 5 },
    );
    expect(out.hits.length).toBeGreaterThan(0);
    expect(out.hits.some((h) => h.symbol === "verify")).toBe(true);
  });

  it("removes symbols when a file is deleted", async () => {
    await fsp.unlink(path.join(root, "utils", "strings.js"));
    const result = await index.sync();
    expect(result.filesRemoved).toBeGreaterThan(0);
    const hits = await index.findSymbol("slugify", { k: 5 });
    expect(hits.length).toBe(0);
  });
});
