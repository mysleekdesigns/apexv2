// Tests for `apex link` lifecycle.
//
// Builds two tmpdir repos: one is the "current" repo where we run `apex link`,
// the other is the sibling whose `.apex/knowledge/` we want to include.
// Asserts:
//   - link creates symlink + manifest entry
//   - --list reads back from the manifest
//   - unlink removes both
//   - linking a target without `.apex/knowledge/` is refused
//   - linking the same name twice is refused

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  linkRepo,
  unlinkRepo,
  listLinks,
  loadManifest,
  defaultLinkName,
  LinkError,
} from "../../src/monorepo/link.js";

let tmpRoot: string;
let primary: string;
let sibling: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apex-monorepo-link-"));
  primary = path.join(tmpRoot, "primary");
  sibling = path.join(tmpRoot, "sibling");
  fs.mkdirSync(primary, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function makeKnowledgeDir(repo: string): void {
  fs.mkdirSync(path.join(repo, ".apex", "knowledge", "decisions"), { recursive: true });
}

describe("apex link / unlink / --list lifecycle", () => {
  it("creates a symlink and writes a manifest entry", async () => {
    makeKnowledgeDir(sibling);
    const record = await linkRepo(primary, sibling, { now: () => "2026-04-26T00:00:00.000Z" });

    expect(record.name).toBe("sibling");
    expect(record.target).toBe(path.resolve(sibling));

    // Symlink exists and resolves to the sibling's knowledge dir.
    const symlinkPath = path.join(primary, ".apex", "links", "sibling");
    expect(fs.existsSync(symlinkPath)).toBe(true);
    const resolved = fs.realpathSync(symlinkPath);
    expect(resolved).toBe(fs.realpathSync(path.join(sibling, ".apex", "knowledge")));

    // Manifest contains the record.
    const manifest = await loadManifest(primary);
    expect(manifest.links).toHaveLength(1);
    expect(manifest.links[0]?.name).toBe("sibling");
    expect(manifest.links[0]?.created).toBe("2026-04-26T00:00:00.000Z");
  });

  it("--list returns manifest entries with health status", async () => {
    makeKnowledgeDir(sibling);
    await linkRepo(primary, sibling, { now: () => "2026-04-26T00:00:00.000Z" });

    const list = await listLinks(primary);
    expect(list).toHaveLength(1);
    expect(list[0]?.symlinkExists).toBe(true);
    expect(list[0]?.targetReachable).toBe(true);
  });

  it("--list flags broken symlink and unreachable target", async () => {
    makeKnowledgeDir(sibling);
    await linkRepo(primary, sibling, { now: () => "2026-04-26T00:00:00.000Z" });

    // Delete the actual sibling knowledge dir; symlink dangles.
    fs.rmSync(path.join(sibling, ".apex"), { recursive: true, force: true });

    const list = await listLinks(primary);
    expect(list[0]?.targetReachable).toBe(false);
    // Symlink itself still exists (lstat-wise) even though target is gone.
    expect(list[0]?.symlinkExists).toBe(true);
  });

  it("unlink removes symlink AND manifest entry", async () => {
    makeKnowledgeDir(sibling);
    await linkRepo(primary, sibling, { now: () => "2026-04-26T00:00:00.000Z" });
    const removed = await unlinkRepo(primary, "sibling");
    expect(removed).toBe(true);

    const symlinkPath = path.join(primary, ".apex", "links", "sibling");
    expect(fs.existsSync(symlinkPath)).toBe(false);
    const manifest = await loadManifest(primary);
    expect(manifest.links).toHaveLength(0);
  });

  it("unlink for unknown name is a no-op (returns false)", async () => {
    const removed = await unlinkRepo(primary, "ghost");
    expect(removed).toBe(false);
  });

  it("refuses to link a target without .apex/knowledge/", async () => {
    // Sibling has nothing — no `.apex/`.
    await expect(linkRepo(primary, sibling)).rejects.toBeInstanceOf(LinkError);
  });

  it("refuses to link the same name twice", async () => {
    makeKnowledgeDir(sibling);
    await linkRepo(primary, sibling, { now: () => "2026-04-26T00:00:00.000Z" });
    await expect(
      linkRepo(primary, sibling, { now: () => "2026-04-26T00:00:00.000Z" }),
    ).rejects.toBeInstanceOf(LinkError);
  });

  it("supports custom link name via --name option", async () => {
    makeKnowledgeDir(sibling);
    const record = await linkRepo(primary, sibling, {
      name: "shared-libs",
      now: () => "2026-04-26T00:00:00.000Z",
    });
    expect(record.name).toBe("shared-libs");
    expect(fs.existsSync(path.join(primary, ".apex", "links", "shared-libs"))).toBe(true);
  });

  it("rejects link names with path separators", async () => {
    makeKnowledgeDir(sibling);
    await expect(
      linkRepo(primary, sibling, { name: "evil/name" }),
    ).rejects.toBeInstanceOf(LinkError);
  });

  it("defaultLinkName is the basename of the target", () => {
    expect(defaultLinkName("/tmp/some/path/my-repo")).toBe("my-repo");
  });
});
