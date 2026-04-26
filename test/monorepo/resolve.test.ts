// Tests for per-package override resolution.
//
// These tests exercise the pure merge logic with hand-crafted entry lists,
// plus an integration test that loads from disk via the loader and asserts
// package overrides root.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import yaml from "yaml";
import {
  resolveKnowledgeForPath,
  mergeKnowledge,
  findContainingPackage,
} from "../../src/monorepo/resolve.js";
import { detectMonorepo } from "../../src/monorepo/discover.js";
import { loadMonorepoKnowledge } from "../../src/monorepo/loader.js";
import type { KnowledgeEntry } from "../../src/types/shared.js";
import type { PackageInfo } from "../../src/monorepo/discover.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apex-monorepo-resolve-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeEntry(id: string, body: string): KnowledgeEntry {
  return {
    frontmatter: {
      id,
      type: "convention",
      title: `Title ${id}`,
      applies_to: "all",
      confidence: "medium",
      sources: [{ kind: "manual", ref: "manual/test" }],
      created: "2026-01-01",
      last_validated: "2026-04-26",
    },
    body,
    path: `.apex/knowledge/conventions/${id}.md`,
  };
}

function writeKnowledgeFile(
  root: string,
  id: string,
  title: string,
  body: string,
): void {
  const dir = path.join(root, ".apex", "knowledge", "conventions");
  fs.mkdirSync(dir, { recursive: true });
  const fm = {
    id,
    type: "convention",
    title,
    applies_to: "all",
    confidence: "medium",
    sources: [{ kind: "manual", ref: "manual/test" }],
    created: "2026-01-01",
    last_validated: "2026-04-26",
    rule: "test rule",
    enforcement: "manual",
  };
  fs.writeFileSync(
    path.join(dir, `${id}.md`),
    `---\n${yaml.stringify(fm)}---\n\n${body}\n`,
    "utf8",
  );
}

describe("mergeKnowledge", () => {
  it("returns root entries unchanged when no package entries", () => {
    const root = [makeEntry("a", "ra"), makeEntry("b", "rb")];
    const out = mergeKnowledge(root, []);
    expect(out.mergedIds).toEqual(["a", "b"]);
    expect(out.overriddenIds).toEqual([]);
    expect(out.merged.map((e) => e.body)).toEqual(["ra", "rb"]);
  });

  it("package entries override root entries by id", () => {
    const rootList = [makeEntry("a", "root-a"), makeEntry("b", "root-b")];
    const pkgList = [makeEntry("a", "pkg-a"), makeEntry("c", "pkg-c")];
    const out = mergeKnowledge(rootList, pkgList);
    expect(out.mergedIds).toEqual(["a", "b", "c"]);
    expect(out.overriddenIds).toEqual(["a"]);
    expect(out.merged.find((e) => e.frontmatter.id === "a")?.body).toBe("pkg-a");
    expect(out.merged.find((e) => e.frontmatter.id === "b")?.body).toBe("root-b");
    expect(out.merged.find((e) => e.frontmatter.id === "c")?.body).toBe("pkg-c");
  });
});

describe("findContainingPackage", () => {
  it("returns null when path is outside any package", () => {
    const pkgs: PackageInfo[] = [
      { name: "foo", path: "/repo/packages/foo", apexDir: null },
    ];
    expect(findContainingPackage("/repo", "/repo/scripts/x.ts", pkgs)).toBeNull();
  });

  it("matches the package containing the file", () => {
    const pkgs: PackageInfo[] = [
      { name: "foo", path: "/repo/packages/foo", apexDir: null },
      { name: "bar", path: "/repo/packages/bar", apexDir: null },
    ];
    const m = findContainingPackage("/repo", "/repo/packages/foo/src/x.ts", pkgs);
    expect(m?.name).toBe("foo");
  });

  it("avoids prefix collisions between sibling packages", () => {
    // `packages/foo` should NOT match a file in `packages/foo-bar`.
    const pkgs: PackageInfo[] = [
      { name: "foo", path: "/repo/packages/foo", apexDir: null },
      { name: "foo-bar", path: "/repo/packages/foo-bar", apexDir: null },
    ];
    const m = findContainingPackage("/repo", "/repo/packages/foo-bar/src/x.ts", pkgs);
    expect(m?.name).toBe("foo-bar");
  });

  it("picks the most specific (longest-prefix) package for nested layouts", () => {
    const pkgs: PackageInfo[] = [
      { name: "outer", path: "/repo/packages", apexDir: null },
      { name: "inner", path: "/repo/packages/inner", apexDir: null },
    ];
    const m = findContainingPackage("/repo", "/repo/packages/inner/src/x.ts", pkgs);
    expect(m?.name).toBe("inner");
  });
});

describe("resolveKnowledgeForPath (integration with loader)", () => {
  it("merges root + package entries with package overriding by id", async () => {
    // Build a pnpm monorepo: root + packages/foo, both have knowledge.
    fs.writeFileSync(
      path.join(tmpDir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n",
      "utf8",
    );
    fs.mkdirSync(path.join(tmpDir, "packages/foo"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "packages/foo/package.json"),
      JSON.stringify({ name: "foo" }),
      "utf8",
    );

    // Root knowledge: `shared-rule` (will be overridden) + `root-only`.
    writeKnowledgeFile(tmpDir, "shared-rule", "Root version", "root body");
    writeKnowledgeFile(tmpDir, "root-only", "Root only", "root only body");

    // Package knowledge: `shared-rule` (override) + `pkg-only`.
    const pkgRoot = path.join(tmpDir, "packages/foo");
    writeKnowledgeFile(pkgRoot, "shared-rule", "Package version", "pkg body");
    writeKnowledgeFile(pkgRoot, "pkg-only", "Pkg only", "pkg only body");

    const info = await detectMonorepo(tmpDir);
    expect(info).not.toBeNull();
    const knowledge = await loadMonorepoKnowledge(info!);

    const filePath = path.join(tmpDir, "packages/foo/src/x.ts");
    const resolved = resolveKnowledgeForPath(
      info!.root,
      filePath,
      knowledge.rootEntries,
      info!.packages,
      knowledge.packageEntriesByPath,
    );

    expect(resolved.matchedPackage?.name).toBe("foo");
    expect(resolved.mergedIds.sort()).toEqual(["pkg-only", "root-only", "shared-rule"]);
    expect(resolved.overriddenIds).toEqual(["shared-rule"]);
    const shared = resolved.merged.find((e) => e.frontmatter.id === "shared-rule");
    expect(shared?.frontmatter.title).toBe("Package version");
    expect(shared?.body).toBe("pkg body");
  });

  it("falls back to root-only entries for files outside any package", async () => {
    fs.writeFileSync(
      path.join(tmpDir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n",
      "utf8",
    );
    fs.mkdirSync(path.join(tmpDir, "packages/foo"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "packages/foo/package.json"),
      JSON.stringify({ name: "foo" }),
      "utf8",
    );
    writeKnowledgeFile(tmpDir, "root-rule", "Root", "root body");

    const info = await detectMonorepo(tmpDir);
    const knowledge = await loadMonorepoKnowledge(info!);

    const filePath = path.join(tmpDir, "scripts/build.ts");
    const resolved = resolveKnowledgeForPath(
      info!.root,
      filePath,
      knowledge.rootEntries,
      info!.packages,
      knowledge.packageEntriesByPath,
    );
    expect(resolved.matchedPackage).toBeNull();
    expect(resolved.mergedIds).toEqual(["root-rule"]);
    expect(resolved.overriddenIds).toEqual([]);
  });
});
