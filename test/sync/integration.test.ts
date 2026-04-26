/**
 * Integration tests for exportBundle + importBundle.
 *
 * Sets APEX_BUNDLE_PASSPHRASE via process.env and restores after each test.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { exportBundle, importBundle } from "../../src/sync/index.js";

const TEST_PASSPHRASE = "test-passphrase-xyz";
const ENV_VAR = "APEX_BUNDLE_PASSPHRASE";

async function makeTempRoot(suffix = "apex-sync-test-"): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), suffix));
  for (const dir of ["decisions", "patterns", "gotchas", "conventions"]) {
    await fs.mkdir(path.join(base, ".apex", "knowledge", dir), { recursive: true });
  }
  await fs.mkdir(path.join(base, ".apex", "proposed"), { recursive: true });
  return base;
}

async function cleanupRoot(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

describe("exportBundle + importBundle — integration", () => {
  let rootA: string;
  let rootB: string;
  let bundleFile: string;
  let prevPassphrase: string | undefined;

  beforeEach(async () => {
    prevPassphrase = process.env[ENV_VAR];
    process.env[ENV_VAR] = TEST_PASSPHRASE;

    rootA = await makeTempRoot("apex-sync-src-");
    rootB = await makeTempRoot("apex-sync-dst-");
    bundleFile = path.join(os.tmpdir(), `test-${Date.now()}.apex-bundle`);
  });

  afterEach(async () => {
    if (prevPassphrase === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = prevPassphrase;
    }
    await cleanupRoot(rootA);
    await cleanupRoot(rootB);
    try {
      await fs.rm(bundleFile);
    } catch {
      // file may not exist
    }
  });

  it("exports knowledge files and imports them into proposed/", async () => {
    // Populate rootA with knowledge files
    const files = [
      {
        rel: path.join(".apex", "knowledge", "decisions", "dec-001.md"),
        content: "# Decision 001\n\nContent of decision 001.\n",
      },
      {
        rel: path.join(".apex", "knowledge", "patterns", "pattern-xyz.md"),
        content: "# Pattern XYZ\n\nThis is a pattern.\n",
      },
      {
        rel: path.join(".apex", "knowledge", "gotchas", "gotcha-abc.md"),
        content: "# Gotcha ABC\n\nWatch out!\n",
      },
    ];

    for (const f of files) {
      await fs.writeFile(path.join(rootA, f.rel), f.content, "utf8");
    }

    // Export from rootA
    const exportReport = await exportBundle(rootA, { out: bundleFile });
    expect(exportReport.fileCount).toBe(3);
    expect(exportReport.outPath).toBe(bundleFile);

    // Verify bundle file exists and is non-empty
    const stat = await fs.stat(bundleFile);
    expect(stat.size).toBeGreaterThan(0);

    // Import into rootB
    const importReport = await importBundle(rootB, { in: bundleFile });
    expect(importReport.fileCount).toBe(3);
    expect(importReport.files).toHaveLength(3);

    // All files should land in .apex/proposed/ of rootB
    const proposedDir = path.join(rootB, ".apex", "proposed");
    const proposedFiles = await fs.readdir(proposedDir);
    expect(proposedFiles).toHaveLength(3);

    // Verify content is byte-identical for each file
    for (const f of files) {
      const basename = path.basename(f.rel);
      const importedPath = path.join(proposedDir, basename);
      const importedContent = await fs.readFile(importedPath, "utf8");
      expect(importedContent).toBe(f.content);
    }
  });

  it("import is idempotent — re-import creates .from-bundle.<ts>.md variants", async () => {
    // Set up one file in rootA
    await fs.writeFile(
      path.join(rootA, ".apex", "knowledge", "decisions", "dec-dup.md"),
      "# Dec dup\n",
      "utf8",
    );

    // Export
    await exportBundle(rootA, { out: bundleFile });

    // First import
    const report1 = await importBundle(rootB, { in: bundleFile });
    expect(report1.files[0].action).toBe("written");

    const proposedDir = path.join(rootB, ".apex", "proposed");
    const before = await fs.readdir(proposedDir);
    expect(before).toHaveLength(1);
    expect(before[0]).toBe("dec-dup.md");

    // Second import — should not overwrite
    const report2 = await importBundle(rootB, { in: bundleFile });
    expect(report2.files[0].action).toBe("renamed");
    expect(report2.files[0].writtenPath).toContain("from-bundle.");

    const after = await fs.readdir(proposedDir);
    expect(after).toHaveLength(2);

    // Original file must still exist
    expect(after).toContain("dec-dup.md");

    // The new file must match the from-bundle pattern
    const newFile = after.find((f) => f !== "dec-dup.md");
    expect(newFile).toMatch(/^dec-dup\.from-bundle\.\d+\.md$/);
  });

  it("dry-run import does not write any files", async () => {
    await fs.writeFile(
      path.join(rootA, ".apex", "knowledge", "conventions", "conv-dry.md"),
      "# Convention\n",
      "utf8",
    );

    await exportBundle(rootA, { out: bundleFile });

    const report = await importBundle(rootB, { in: bundleFile, dryRun: true });
    expect(report.fileCount).toBe(1);
    expect(report.files[0].action).toBe("dry-run");

    // proposed dir should be empty in rootB
    const proposedDir = path.join(rootB, ".apex", "proposed");
    const entries = await fs.readdir(proposedDir);
    expect(entries).toHaveLength(0);
  });

  it("includeProposed also exports proposed files", async () => {
    await fs.writeFile(
      path.join(rootA, ".apex", "knowledge", "decisions", "dec.md"),
      "# Dec\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(rootA, ".apex", "proposed", "prop.md"),
      "# Proposal\n",
      "utf8",
    );

    const exportReport = await exportBundle(rootA, {
      out: bundleFile,
      includeProposed: true,
    });
    expect(exportReport.fileCount).toBe(2);

    const importReport = await importBundle(rootB, { in: bundleFile });
    expect(importReport.fileCount).toBe(2);
  });

  it("throws a clear error when passphrase env var is missing", async () => {
    delete process.env[ENV_VAR];

    await expect(
      exportBundle(rootA, { out: bundleFile }),
    ).rejects.toThrow(/APEX_BUNDLE_PASSPHRASE/);
  });

  it("throws a clear error when decrypting with wrong passphrase", async () => {
    await fs.writeFile(
      path.join(rootA, ".apex", "knowledge", "decisions", "dec.md"),
      "# Dec\n",
      "utf8",
    );

    await exportBundle(rootA, { out: bundleFile });

    // Switch to wrong passphrase
    process.env[ENV_VAR] = "completely-wrong-passphrase";

    await expect(
      importBundle(rootB, { in: bundleFile }),
    ).rejects.toThrow("bundle is corrupt or passphrase is wrong");
  });

  it("does not include files outside .apex/ in the bundle", async () => {
    // Write a file outside .apex/
    await fs.writeFile(path.join(rootA, "README.md"), "# My Project\n", "utf8");
    // Write a knowledge file
    await fs.writeFile(
      path.join(rootA, ".apex", "knowledge", "decisions", "only-this.md"),
      "# Only this\n",
      "utf8",
    );

    await exportBundle(rootA, { out: bundleFile });
    const importReport = await importBundle(rootB, { in: bundleFile });

    // Only the knowledge file should be present
    expect(importReport.fileCount).toBe(1);
    expect(importReport.files[0].bundlePath).toContain("only-this.md");
  });
});
