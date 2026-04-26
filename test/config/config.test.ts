import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, getDefaults } from "../../src/config/index.js";
import type { ApexConfig } from "../../src/config/index.js";

async function makeTempRoot(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "apex-config-test-"));
  await fs.mkdir(path.join(base, ".apex"), { recursive: true });
  return base;
}

async function cleanupRoot(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

describe("getDefaults", () => {
  it("returns the canonical default config", () => {
    const defaults = getDefaults();
    expect(defaults.auto_merge.enabled).toBe(true);
    expect(defaults.auto_merge.threshold).toBe(2);
    expect(defaults.auto_merge.require_no_conflict).toBe(true);
    expect(defaults.auto_merge.min_confidence).toBe("low");
  });

  it("returns a fresh copy each call (not shared reference)", () => {
    const a = getDefaults();
    const b = getDefaults();
    a.auto_merge.enabled = false;
    expect(b.auto_merge.enabled).toBe(true);
  });
});

describe("loadConfig — missing file", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("returns defaults when config.toml does not exist", async () => {
    const config = await loadConfig(root);
    const defaults = getDefaults();
    expect(config).toEqual(defaults);
  });

  it("does not throw when .apex/ directory is absent", async () => {
    const root2 = await fs.mkdtemp(path.join(os.tmpdir(), "apex-config-nodir-"));
    try {
      const config = await loadConfig(root2);
      expect(config.auto_merge.enabled).toBe(true);
    } finally {
      await fs.rm(root2, { recursive: true, force: true });
    }
  });
});

describe("loadConfig — partial file", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("fills in missing fields with defaults", async () => {
    const partial = `[auto_merge]\nenabled = false\n`;
    await fs.writeFile(path.join(root, ".apex", "config.toml"), partial, "utf8");

    const config = await loadConfig(root);
    expect(config.auto_merge.enabled).toBe(false);
    // Unspecified fields fall back to defaults.
    expect(config.auto_merge.threshold).toBe(2);
    expect(config.auto_merge.require_no_conflict).toBe(true);
    expect(config.auto_merge.min_confidence).toBe("low");
  });

  it("uses default when min_confidence is not a valid value", async () => {
    const bad = `[auto_merge]\nmin_confidence = "extreme"\n`;
    await fs.writeFile(path.join(root, ".apex", "config.toml"), bad, "utf8");
    const config = await loadConfig(root);
    expect(config.auto_merge.min_confidence).toBe("low");
  });
});

describe("loadConfig — full file", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("reads all auto_merge fields correctly", async () => {
    const full = [
      "[auto_merge]",
      "enabled = false",
      "threshold = 5",
      "require_no_conflict = false",
      'min_confidence = "high"',
    ].join("\n");
    await fs.writeFile(path.join(root, ".apex", "config.toml"), full, "utf8");

    const config = await loadConfig(root);
    expect(config.auto_merge.enabled).toBe(false);
    expect(config.auto_merge.threshold).toBe(5);
    expect(config.auto_merge.require_no_conflict).toBe(false);
    expect(config.auto_merge.min_confidence).toBe("high");
  });
});

describe("saveConfig + loadConfig round-trip", () => {
  let root: string;
  beforeEach(async () => {
    root = await makeTempRoot();
  });
  afterEach(async () => {
    await cleanupRoot(root);
  });

  it("persists and reloads a config faithfully", async () => {
    const toSave: ApexConfig = {
      auto_merge: {
        enabled: false,
        threshold: 3,
        require_no_conflict: false,
        min_confidence: "medium",
      },
    };
    await saveConfig(root, toSave);
    const loaded = await loadConfig(root);
    expect(loaded).toEqual(toSave);
  });

  it("creates the .apex dir if absent", async () => {
    // Remove .apex dir first.
    await fs.rm(path.join(root, ".apex"), { recursive: true, force: true });
    const toSave: ApexConfig = {
      auto_merge: {
        enabled: true,
        threshold: 1,
        require_no_conflict: true,
        min_confidence: "low",
      },
    };
    await saveConfig(root, toSave);
    const loaded = await loadConfig(root);
    expect(loaded.auto_merge.threshold).toBe(1);
  });
});
