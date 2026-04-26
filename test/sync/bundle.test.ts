import { describe, it, expect } from "vitest";
import { pack, unpack } from "../../src/sync/bundle.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

async function makeTempRoot(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "apex-bundle-test-"));
  // Create knowledge subdirectories
  for (const dir of ["decisions", "patterns", "gotchas", "conventions"]) {
    await fs.mkdir(path.join(base, ".apex", "knowledge", dir), { recursive: true });
  }
  await fs.mkdir(path.join(base, ".apex", "proposed"), { recursive: true });
  return base;
}

async function cleanupRoot(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

describe("bundle: pack + unpack round-trip", () => {
  it("recovers byte-identical content for 3 knowledge files", async () => {
    const root = await makeTempRoot();
    try {
      // Write 3 fixture files in different knowledge subdirs
      const fixtures = [
        {
          rel: path.join(".apex", "knowledge", "decisions", "decision-alpha.md"),
          content: "# Decision Alpha\n\nThis is the first decision.\n",
        },
        {
          rel: path.join(".apex", "knowledge", "patterns", "pattern-beta.md"),
          content: "# Pattern Beta\n\nSome pattern content with unicode: é à ü\n",
        },
        {
          rel: path.join(".apex", "knowledge", "gotchas", "gotcha-gamma.md"),
          content: "# Gotcha Gamma\n\nBinary-safe: \x00\x01\x02\x03\n",
        },
      ];

      for (const f of fixtures) {
        await fs.writeFile(path.join(root, f.rel), f.content, "utf8");
      }

      // Pack
      const packed = await pack(root);

      // Unpack
      const manifest = await unpack(packed);

      expect(manifest.version).toBe(1);
      expect(typeof manifest.created).toBe("string");
      expect(manifest.files).toHaveLength(3);

      // Verify byte-identical recovery for each file
      for (const f of fixtures) {
        const bundlePath = f.rel
          .replace(path.join(".apex") + path.sep, "")
          .replace(/\\/g, "/");

        const found = manifest.files.find((mf) => mf.path === bundlePath);
        expect(found, `file not found in manifest: ${bundlePath}`).toBeDefined();

        const recovered = Buffer.from(found!.content_base64, "base64").toString("utf8");
        expect(recovered).toBe(f.content);
      }
    } finally {
      await cleanupRoot(root);
    }
  });

  it("includes proposed files when includeProposed is true", async () => {
    const root = await makeTempRoot();
    try {
      await fs.writeFile(
        path.join(root, ".apex", "proposed", "proposal-one.md"),
        "# Proposal\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(root, ".apex", "knowledge", "decisions", "dec.md"),
        "# Dec\n",
        "utf8",
      );

      const packed = await pack(root, { includeProposed: true });
      const manifest = await unpack(packed);

      const paths = manifest.files.map((f) => f.path);
      expect(paths.some((p) => p.startsWith("proposed/"))).toBe(true);
      expect(paths.some((p) => p.startsWith("knowledge/"))).toBe(true);
      expect(manifest.files.length).toBeGreaterThanOrEqual(2);
    } finally {
      await cleanupRoot(root);
    }
  });

  it("excludes proposed files when includeProposed is false (default)", async () => {
    const root = await makeTempRoot();
    try {
      await fs.writeFile(
        path.join(root, ".apex", "proposed", "proposal-one.md"),
        "# Proposal\n",
        "utf8",
      );
      await fs.writeFile(
        path.join(root, ".apex", "knowledge", "decisions", "dec.md"),
        "# Dec\n",
        "utf8",
      );

      const packed = await pack(root);
      const manifest = await unpack(packed);

      const paths = manifest.files.map((f) => f.path);
      expect(paths.some((p) => p.startsWith("proposed/"))).toBe(false);
      expect(paths.some((p) => p.startsWith("knowledge/"))).toBe(true);
    } finally {
      await cleanupRoot(root);
    }
  });

  it("returns empty files array when knowledge dir does not exist", async () => {
    const root = await makeTempRoot();
    try {
      // Remove the knowledge dir
      await fs.rm(path.join(root, ".apex", "knowledge"), { recursive: true, force: true });

      const packed = await pack(root);
      const manifest = await unpack(packed);

      expect(manifest.files).toHaveLength(0);
    } finally {
      await cleanupRoot(root);
    }
  });

  it("throws on corrupt gzip data", async () => {
    const corrupted = Buffer.from("not gzip data at all");
    await expect(unpack(corrupted)).rejects.toThrow(/decompression failed/);
  });

  it("throws on valid gzip but invalid JSON", async () => {
    const { promisify } = await import("node:util");
    const zlib = await import("node:zlib");
    const gzip = promisify(zlib.gzip);
    const buf = await gzip(Buffer.from("not json"));
    await expect(unpack(buf)).rejects.toThrow(/JSON parse failed/);
  });
});
