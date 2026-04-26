// Phase 5.2 confirmation: `apex init` writes a managed .gitignore block that
// excludes .apex/episodes/ and .apex/index/ — i.e. team members syncing the
// repo never check in transient runtime artefacts.
//
// We do NOT modify the installer; we just assert the existing behaviour and
// fail loudly if it ever regresses.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { fileURLToPath } from "node:url";
import { runInstall } from "../../src/scaffold/installer.js";
import { projectPaths } from "../../src/util/paths.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures/projects");

async function tmpProject(fixture: string): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "apex-review-gi-"));
  await fs.copy(path.join(fixtures, fixture), base);
  return base;
}

describe("apex init writes managed .gitignore for team-sync (Phase 5.2)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await tmpProject("node-ts-next");
  });

  afterEach(async () => {
    await fs.remove(cwd).catch(() => {});
  });

  it("gitignores .apex/episodes/ and .apex/index/", async () => {
    await runInstall({
      root: cwd,
      dryRun: false,
      force: false,
      yes: true,
      apexVersion: "0.1.0-test",
    });

    const p = projectPaths(cwd);
    expect(await fs.pathExists(p.rootGitignore)).toBe(true);
    const gi = await fs.readFile(p.rootGitignore, "utf8");

    // Managed block markers.
    expect(gi).toContain("# apex:begin");
    expect(gi).toContain("# apex:end");

    // The two transient APEX subtrees that must never be committed.
    expect(gi).toContain(".apex/episodes/");
    expect(gi).toContain(".apex/index/");
  });

  it("knowledge/ and proposed/ are NOT gitignored (they ARE meant to be committed)", async () => {
    await runInstall({
      root: cwd,
      dryRun: false,
      force: false,
      yes: true,
      apexVersion: "0.1.0-test",
    });

    const p = projectPaths(cwd);
    const gi = await fs.readFile(p.rootGitignore, "utf8");

    // Knowledge tree is the team-shareable artefact — it must NOT appear.
    expect(gi).not.toMatch(/^\.apex\/knowledge\/?\s*$/m);
    expect(gi).not.toMatch(/^\.apex\/proposed\/?\s*$/m);
  });

  it("the .apex/.gitignore file ignores episodes/ and index/ at the local level too", async () => {
    await runInstall({
      root: cwd,
      dryRun: false,
      force: false,
      yes: true,
      apexVersion: "0.1.0-test",
    });

    const p = projectPaths(cwd);
    expect(await fs.pathExists(p.apexGitignore)).toBe(true);
    const gi = await fs.readFile(p.apexGitignore, "utf8");
    expect(gi).toMatch(/^episodes\/?$/m);
    expect(gi).toMatch(/^index\/?$/m);
  });
});
