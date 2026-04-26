import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { fileURLToPath } from "node:url";
import {
  packPlugin,
  buildMcpRegistry,
  assertValidPluginLayout,
  REQUIRED_PLUGIN_FILES,
  REQUIRED_PLUGIN_DIRS,
} from "../../src/plugin/packer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const realTemplates = path.join(repoRoot, "templates");

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("plugin packer", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await tmpDir("apex-pack-");
  });

  afterEach(async () => {
    await fs.remove(outDir).catch(() => {});
  });

  it("writes a self-contained plugin layout", async () => {
    const result = await packPlugin({ outDir });

    for (const f of REQUIRED_PLUGIN_FILES) {
      expect(await fs.pathExists(path.join(outDir, f))).toBe(true);
    }
    for (const d of REQUIRED_PLUGIN_DIRS) {
      expect(await fs.pathExists(path.join(outDir, d))).toBe(true);
    }

    expect(result.outDir).toBe(outDir);
    expect(result.written.length).toBeGreaterThan(0);
  });

  it("writes a valid plugin.json manifest", async () => {
    await packPlugin({ outDir });
    const manifest = (await fs.readJson(
      path.join(outDir, ".claude-plugin", "plugin.json"),
    )) as Record<string, unknown>;
    expect(manifest["name"]).toBe("apex");
    expect(typeof manifest["version"]).toBe("string");
    expect(manifest["hooks"]).toBe("./hooks");
    expect(manifest["skills"]).toBe("./skills");
    expect(manifest["agents"]).toBe("./agents");
    expect(manifest["commands"]).toBe("./commands");
    expect(manifest["mcp"]).toBe("./.mcp.json");
  });

  it("copies hooks, skills, agents, and commands from templates/claude/", async () => {
    await packPlugin({ outDir });

    // Hooks: at least the session-start hook should be present and executable.
    const sessionStart = path.join(outDir, "hooks", "on-session-start.sh");
    expect(await fs.pathExists(sessionStart)).toBe(true);
    const stat = await fs.stat(sessionStart);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o100).toBeTruthy(); // owner-executable
    }

    // Skills: the recall bundle should land at skills/apex-recall/SKILL.md.
    expect(
      await fs.pathExists(path.join(outDir, "skills", "apex-recall", "SKILL.md")),
    ).toBe(true);

    // Agents.
    expect(
      await fs.pathExists(path.join(outDir, "agents", "apex-curator.md")),
    ).toBe(true);

    // Commands.
    expect(
      await fs.pathExists(path.join(outDir, "commands", "apex-thumbs-up.md")),
    ).toBe(true);
  });

  it("writes an MCP registry that points at $CLAUDE_PLUGIN_ROOT/dist/mcp/server-bin.js", async () => {
    await packPlugin({ outDir });
    const mcp = (await fs.readJson(path.join(outDir, ".mcp.json"))) as {
      mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };
    const server = mcp.mcpServers["apex-mcp"];
    expect(server).toBeDefined();
    expect(server!.command).toBe("node");
    const argLine = server!.args.join(" ");
    expect(argLine).toContain("CLAUDE_PLUGIN_ROOT");
    expect(argLine).toContain("dist/mcp");
    // CLAUDE_PROJECT_DIR is forwarded for project resolution inside the MCP server.
    expect(server!.env?.["CLAUDE_PROJECT_DIR"]).toBe("${CLAUDE_PROJECT_DIR}");
  });

  it("never includes user-owned `.apex/` in the plugin layout", async () => {
    await packPlugin({ outDir });
    expect(await fs.pathExists(path.join(outDir, ".apex"))).toBe(false);
    await assertValidPluginLayout(outDir);
  });

  it("assertValidPluginLayout rejects layouts containing .apex/", async () => {
    await packPlugin({ outDir });
    await fs.ensureDir(path.join(outDir, ".apex", "knowledge"));
    await expect(assertValidPluginLayout(outDir)).rejects.toThrow(/\.apex/);
  });

  it("assertValidPluginLayout rejects missing required files", async () => {
    await packPlugin({ outDir });
    await fs.remove(path.join(outDir, ".claude-plugin", "plugin.json"));
    await expect(assertValidPluginLayout(outDir)).rejects.toThrow(/plugin\.json/);
  });

  it("buildMcpRegistry returns a single apex-mcp entry", () => {
    const reg = buildMcpRegistry() as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(reg.mcpServers)).toEqual(["apex-mcp"]);
  });

  it("uses the supplied templates dir when overridden (test hook)", async () => {
    // Sanity: the override path is honored. Use the real templates dir to
    // verify the wiring without forcing every consumer into a fake fixture.
    const result = await packPlugin({
      outDir,
      templatesDir: realTemplates,
    });
    expect(result.written.length).toBeGreaterThan(0);
  });

  it("respects manifest overrides", async () => {
    await packPlugin({
      outDir,
      manifest: { name: "custom", version: "9.9.9" },
    });
    const manifest = (await fs.readJson(
      path.join(outDir, ".claude-plugin", "plugin.json"),
    )) as Record<string, unknown>;
    expect(manifest["name"]).toBe("custom");
    expect(manifest["version"]).toBe("9.9.9");
  });

  it("is idempotent: packing twice into the same dir produces equivalent output", async () => {
    const r1 = await packPlugin({ outDir });
    const m1 = await fs.readFile(r1.manifestPath, "utf8");
    const r2 = await packPlugin({ outDir });
    const m2 = await fs.readFile(r2.manifestPath, "utf8");
    expect(m1).toBe(m2);
  });
});
