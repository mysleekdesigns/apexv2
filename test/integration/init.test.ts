import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { fileURLToPath } from "node:url";
import { runInstall, isInstalled } from "../../src/scaffold/installer.js";
import { runInit } from "../../src/cli/commands/init.js";
import { projectPaths } from "../../src/util/paths.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.resolve(here, "../fixtures/projects");

async function tmpProject(fixture: string): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "apex-test-"));
  await fs.copy(path.join(fixtures, fixture), base);
  return base;
}

describe("apex init (integration)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await tmpProject("node-ts-next");
  });

  afterEach(async () => {
    await fs.remove(cwd).catch(() => {});
  });

  it("writes the expected APEX-owned files and a valid install.json", async () => {
    const result = await runInstall({
      root: cwd,
      dryRun: false,
      force: false,
      yes: true,
      apexVersion: "0.1.0-test",
    });

    expect(result.detection.language).toBe("node");
    expect(result.installJson.apex_version).toBe("0.1.0-test");
    expect(result.installJson.schema_versions.knowledge).toBe(1);

    const p = projectPaths(cwd);
    expect(await fs.pathExists(p.installJson)).toBe(true);
    expect(await fs.pathExists(p.claudeMd)).toBe(true);
    expect(await fs.pathExists(p.claudeLocalMd)).toBe(true);
    expect(await fs.pathExists(path.join(p.rulesDir, "00-stack.md"))).toBe(true);
    expect(await fs.pathExists(p.settingsJson)).toBe(true);
    expect(await fs.pathExists(p.mcpJson)).toBe(true);
    expect(await fs.pathExists(p.configToml)).toBe(true);
    expect(await fs.pathExists(p.apexGitignore)).toBe(true);
    expect(await fs.pathExists(path.join(p.knowledgeDir, "decisions"))).toBe(true);

    // Hooks are present and executable.
    for (const hook of [
      "on-session-start.sh",
      "on-prompt-submit.sh",
      "on-post-tool.sh",
      "on-post-tool-failure.sh",
      "on-pre-compact.sh",
      "on-session-end.sh",
    ]) {
      const hp = path.join(p.hooksDir, hook);
      expect(await fs.pathExists(hp)).toBe(true);
      const stat = await fs.stat(hp);
      // Executable bit on at least owner.
      expect(stat.mode & 0o100).toBeTruthy();
    }

    // Settings.json contains apex-tagged hooks.
    const settings = (await fs.readJson(p.settingsJson)) as Record<string, unknown>;
    const hooks = settings["hooks"] as Record<string, unknown[]>;
    expect(Object.keys(hooks).sort()).toEqual([
      "PostToolUse",
      "PostToolUseFailure",
      "PreCompact",
      "SessionEnd",
      "SessionStart",
      "UserPromptSubmit",
    ]);
    const sessionStart = hooks["SessionStart"] as unknown[];
    expect((sessionStart?.[0] as Record<string, unknown>)["_apex_managed"]).toBe(true);

    // .mcp.json registers apex.
    const mcp = (await fs.readJson(p.mcpJson)) as Record<string, unknown>;
    const servers = mcp["mcpServers"] as Record<string, unknown>;
    expect(servers["apex"]).toBeDefined();
    expect((servers["apex"] as Record<string, unknown>)["_apex_managed"]).toBe(true);

    // Root .gitignore contains apex managed block.
    const gi = await fs.readFile(p.rootGitignore, "utf8").catch(() => "");
    expect(gi).toContain("# apex:begin");
    expect(gi).toContain("CLAUDE.local.md");
  });

  it("dry-run writes nothing", async () => {
    const result = await runInstall({
      root: cwd,
      dryRun: true,
      force: false,
      yes: true,
      apexVersion: "0.1.0-test",
    });
    expect(result.records.length).toBeGreaterThan(0);
    expect(await isInstalled(cwd)).toBe(false);
    const p = projectPaths(cwd);
    expect(await fs.pathExists(p.installJson)).toBe(false);
    expect(await fs.pathExists(p.claudeMd)).toBe(false);
  });

  it("idempotent re-run via runInit prints upgrade prompt and exits 0", async () => {
    await runInstall({
      root: cwd,
      dryRun: false,
      force: false,
      yes: true,
      apexVersion: "0.1.0-test",
    });
    expect(await isInstalled(cwd)).toBe(true);

    const writes: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await runInit({ cwd, yes: true });
      expect(code).toBe(0);
    } finally {
      process.stdout.write = origWrite;
    }
    const out = writes.join("");
    expect(out).toContain("APEX is already installed");
    expect(out).toContain("apex upgrade");
  });

  it("force re-run preserves installed_at and bumps last_upgraded_at", async () => {
    const first = await runInstall({
      root: cwd,
      dryRun: false,
      force: false,
      yes: true,
      apexVersion: "0.1.0-test",
    });
    // small delay to ensure the second timestamp differs.
    await new Promise((r) => setTimeout(r, 10));
    const second = await runInstall({
      root: cwd,
      dryRun: false,
      force: true,
      yes: true,
      apexVersion: "0.2.0-test",
    });
    expect(second.installJson.installed_at).toBe(first.installJson.installed_at);
    expect(second.installJson.last_upgraded_at).not.toBe(
      first.installJson.last_upgraded_at,
    );
    expect(second.installJson.apex_version).toBe("0.2.0-test");
  });

  it("preserves user content outside the managed section in CLAUDE.md", async () => {
    const p = projectPaths(cwd);
    await fs.writeFile(p.claudeMd, "# My project\n\nUser-authored content.\n", "utf8");
    await runInstall({
      root: cwd,
      dryRun: false,
      force: false,
      yes: true,
      apexVersion: "0.1.0-test",
    });
    const content = await fs.readFile(p.claudeMd, "utf8");
    expect(content).toContain("User-authored content.");
    expect(content).toContain("<!-- apex:begin -->");
    expect(content).toContain("<!-- apex:end -->");
  });
});
