import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import {
  planUpgrade,
  renderPlan,
  isUserOwned,
  isPluginOwned,
  USER_OWNED_PATHS,
} from "../../src/plugin/upgrade.js";
import { packPlugin } from "../../src/plugin/packer.js";

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Build a minimal "installed project" that looks like an APEX-installed repo. */
async function setupInstalledProject(root: string): Promise<void> {
  // Plugin-owned (will be replaceable on upgrade)
  await fs.ensureDir(path.join(root, ".claude", "hooks"));
  await fs.writeFile(
    path.join(root, ".claude", "hooks", "on-session-start.sh"),
    "#!/usr/bin/env bash\n# old version\n",
  );
  await fs.ensureDir(path.join(root, ".claude", "agents"));
  await fs.writeFile(
    path.join(root, ".claude", "agents", "apex-curator.md"),
    "# old curator\n",
  );
  await fs.ensureDir(path.join(root, ".claude", "skills", "apex-recall"));
  await fs.writeFile(
    path.join(root, ".claude", "skills", "apex-recall", "SKILL.md"),
    "# old recall\n",
  );

  // A leftover plugin-owned file that no longer ships in the new plugin
  await fs.writeFile(
    path.join(root, ".claude", "agents", "apex-deprecated.md"),
    "# removed in newer plugin\n",
  );

  // User-owned (must be preserved)
  await fs.ensureDir(path.join(root, ".apex", "knowledge", "decisions"));
  await fs.writeFile(
    path.join(root, ".apex", "knowledge", "decisions", "auth-rotation.md"),
    "---\nid: decision:auth-rotation\n---\n",
  );
  await fs.ensureDir(path.join(root, ".apex", "proposed"));
  await fs.writeFile(
    path.join(root, ".apex", "proposed", "p-001.md"),
    "proposed entry",
  );
  await fs.writeFile(path.join(root, ".apex", "config.toml"), "version = 1\n");
  await fs.writeFile(path.join(root, "CLAUDE.local.md"), "personal notes");
}

describe("plugin upgrade planner", () => {
  let projectRoot: string;
  let pluginDir: string;

  beforeEach(async () => {
    projectRoot = await tmpDir("apex-upgrade-proj-");
    pluginDir = await tmpDir("apex-upgrade-plug-");
    await setupInstalledProject(projectRoot);
    await packPlugin({ outDir: pluginDir });
  });

  afterEach(async () => {
    await fs.remove(projectRoot).catch(() => {});
    await fs.remove(pluginDir).catch(() => {});
  });

  it("classifies user-owned files correctly", () => {
    expect(isUserOwned(".apex/knowledge/decisions/x.md")).toBe(true);
    expect(isUserOwned(".apex/proposed/p-1.md")).toBe(true);
    expect(isUserOwned(".apex/config.toml")).toBe(true);
    expect(isUserOwned("CLAUDE.local.md")).toBe(true);
    expect(isUserOwned(".claude/hooks/on-session-start.sh")).toBe(false);
    expect(isUserOwned(".apex/index/fts.sqlite")).toBe(false); // index/ is rebuildable, not user-owned in this sense
  });

  it("classifies plugin-owned files correctly", () => {
    expect(isPluginOwned(".claude/hooks/on-session-start.sh")).toBe(true);
    expect(isPluginOwned(".claude/skills/apex-recall/SKILL.md")).toBe(true);
    expect(isPluginOwned(".claude/agents/apex-curator.md")).toBe(true);
    expect(isPluginOwned(".claude/commands/apex-thumbs-up.md")).toBe(true);
    expect(isPluginOwned(".claude-plugin/plugin.json")).toBe(true);
    expect(isPluginOwned(".apex/knowledge/decisions/x.md")).toBe(false);
    expect(isPluginOwned("CLAUDE.local.md")).toBe(false);
  });

  it("identifies replaceable plugin files", async () => {
    const plan = await planUpgrade(projectRoot, pluginDir);
    const replacements = plan.changes.filter((c) => c.action === "replace");
    const replacePaths = new Set(replacements.map((c) => c.relPath));
    expect(replacePaths.has(".claude/hooks/on-session-start.sh")).toBe(true);
    expect(replacePaths.has(".claude/agents/apex-curator.md")).toBe(true);
    expect(replacePaths.has(".claude/skills/apex-recall/SKILL.md")).toBe(true);
    expect(plan.counts.replace).toBe(replacements.length);
  });

  it("identifies new plugin files as adds", async () => {
    const plan = await planUpgrade(projectRoot, pluginDir);
    const adds = plan.changes.filter((c) => c.action === "add");
    // The fresh plugin ships hooks the test fixture didn't pre-create
    // (e.g. on-prompt-submit.sh); they should appear as adds.
    const addPaths = adds.map((c) => c.relPath);
    expect(addPaths).toContain(".claude/hooks/on-prompt-submit.sh");
  });

  it("identifies obsolete plugin files as removes", async () => {
    const plan = await planUpgrade(projectRoot, pluginDir);
    const removes = plan.changes.filter((c) => c.action === "remove");
    const removePaths = removes.map((c) => c.relPath);
    expect(removePaths).toContain(".claude/agents/apex-deprecated.md");
  });

  it("never plans to overwrite or delete user-owned files", async () => {
    const plan = await planUpgrade(projectRoot, pluginDir);
    const change = plan.changes.find((c) => c.relPath.startsWith(".apex/"));
    expect(change).toBeUndefined();
    const claudeLocal = plan.changes.find((c) => c.relPath === "CLAUDE.local.md");
    expect(claudeLocal).toBeUndefined();
  });

  it("records every user-owned file as preserved", async () => {
    const plan = await planUpgrade(projectRoot, pluginDir);
    const preservedPaths = plan.preserved.map((p) => p.relPath);
    expect(preservedPaths).toContain(".apex/knowledge/decisions/auth-rotation.md");
    expect(preservedPaths).toContain(".apex/proposed/p-001.md");
    expect(preservedPaths).toContain(".apex/config.toml");
    expect(preservedPaths).toContain("CLAUDE.local.md");
    expect(plan.preserved.every((p) => p.action === "skip")).toBe(true);
    expect(plan.preserved.every((p) => p.ownership === "user")).toBe(true);
  });

  it("does not mutate the project filesystem", async () => {
    const before = await fs.readFile(
      path.join(projectRoot, ".apex", "knowledge", "decisions", "auth-rotation.md"),
      "utf8",
    );
    const beforeHook = await fs.readFile(
      path.join(projectRoot, ".claude", "hooks", "on-session-start.sh"),
      "utf8",
    );
    await planUpgrade(projectRoot, pluginDir);
    const after = await fs.readFile(
      path.join(projectRoot, ".apex", "knowledge", "decisions", "auth-rotation.md"),
      "utf8",
    );
    const afterHook = await fs.readFile(
      path.join(projectRoot, ".claude", "hooks", "on-session-start.sh"),
      "utf8",
    );
    expect(after).toBe(before);
    expect(afterHook).toBe(beforeHook);
  });

  it("renderPlan summarises counts and lists changes", async () => {
    const plan = await planUpgrade(projectRoot, pluginDir);
    const out = renderPlan(plan);
    expect(out).toContain("apex plugin upgrade plan");
    expect(out).toContain(`replace=${plan.counts.replace}`);
    expect(out).toContain(`add=${plan.counts.add}`);
    expect(out).toContain(`remove=${plan.counts.remove}`);
    expect(out).toContain(`skip=${plan.counts.skip}`);
  });

  it("USER_OWNED_PATHS exports a stable, non-empty list", () => {
    expect(USER_OWNED_PATHS.length).toBeGreaterThan(0);
    expect(USER_OWNED_PATHS).toContain(".apex/knowledge");
    expect(USER_OWNED_PATHS).toContain("CLAUDE.local.md");
  });

  it("counts add/replace/remove/skip consistently", async () => {
    const plan = await planUpgrade(projectRoot, pluginDir);
    expect(plan.counts.replace).toBe(
      plan.changes.filter((c) => c.action === "replace").length,
    );
    expect(plan.counts.add).toBe(
      plan.changes.filter((c) => c.action === "add").length,
    );
    expect(plan.counts.remove).toBe(
      plan.changes.filter((c) => c.action === "remove").length,
    );
    expect(plan.counts.skip).toBe(plan.preserved.length);
  });
});
