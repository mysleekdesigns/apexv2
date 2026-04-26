/**
 * Plugin packer.
 *
 * Given a target directory, write a self-contained Claude Code plugin layout:
 *
 *   <out>/
 *     .claude-plugin/plugin.json   # manifest (see ./manifest.ts)
 *     hooks/                       # POSIX shell scripts (sourced from templates/claude/hooks)
 *     skills/                      # SKILL.md bundles (sourced from templates/claude/skills)
 *     agents/                      # subagent definitions (sourced from templates/claude/agents)
 *     commands/                    # slash commands (sourced from templates/claude/commands)
 *     .mcp.json                    # MCP server registration for `apex-mcp`
 *
 * Notably absent: `.apex/`. The user's knowledge, episodes, proposed entries,
 * and config are NEVER part of the plugin payload — those are written by
 * `apex init` into the user's project and stay user-owned across upgrades.
 */
import path from "node:path";
import fs from "fs-extra";
import { fileURLToPath } from "node:url";
import {
  buildManifest,
  packageRoot,
  renderManifest,
  type ManifestOverrides,
  type PluginManifest,
} from "./manifest.js";

export interface PackOptions {
  /** Destination directory. Created if missing; existing files are overwritten. */
  outDir: string;
  /** Override the source `templates/claude/` location (test hook). */
  templatesDir?: string;
  /** Override the source package root used to read `package.json` (test hook). */
  packageRoot?: string;
  /** Per-field manifest overrides. */
  manifest?: ManifestOverrides;
}

export interface PackResult {
  outDir: string;
  manifestPath: string;
  manifest: PluginManifest;
  /** Absolute paths of every file written, in write order. */
  written: string[];
}

const HOOK_FILES = [
  "on-session-start.sh",
  "on-prompt-submit.sh",
  "on-post-tool.sh",
  "on-post-tool-failure.sh",
  "on-pre-compact.sh",
  "on-session-end.sh",
];

const AGENT_FILES = [
  "apex-archaeologist.md",
  "apex-curator.md",
  "apex-reflector.md",
];

const SKILL_DIRS = ["apex-recall", "apex-reflect", "apex-review"];

const COMMAND_FILES = ["apex-thumbs-up.md", "apex-thumbs-down.md"];

function defaultTemplatesDir(): string {
  // Mirrors src/util/paths.ts:templatesDir() but doesn't import it (paths.ts
  // is owned outside the plugin module).
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "..", "templates");
}

/** The MCP registry written into the plugin layout. */
export function buildMcpRegistry(): Record<string, unknown> {
  return {
    mcpServers: {
      "apex-mcp": {
        _apex_managed: true,
        // CLAUDE_PLUGIN_ROOT is the directory Claude Code mounts the plugin at.
        // The MCP entrypoint is the same `server-bin.js` shipped in `dist/`.
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/dist/mcp/server-bin.js"],
        env: {
          CLAUDE_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}",
          CLAUDE_PLUGIN_DATA: "${CLAUDE_PLUGIN_DATA}",
          CLAUDE_PLUGIN_ROOT: "${CLAUDE_PLUGIN_ROOT}",
        },
      },
    },
  };
}

async function copyIfExists(
  from: string,
  to: string,
  written: string[],
): Promise<boolean> {
  if (!(await fs.pathExists(from))) return false;
  await fs.ensureDir(path.dirname(to));
  await fs.copy(from, to, { overwrite: true });
  written.push(to);
  return true;
}

async function copyDirContents(
  fromDir: string,
  toDir: string,
  written: string[],
): Promise<void> {
  if (!(await fs.pathExists(fromDir))) return;
  await fs.ensureDir(toDir);
  const entries = await fs.readdir(fromDir);
  for (const entry of entries) {
    const src = path.join(fromDir, entry);
    const dst = path.join(toDir, entry);
    await fs.copy(src, dst, { overwrite: true });
    written.push(dst);
  }
}

/**
 * Write a self-contained plugin layout to `opts.outDir`. Returns a description
 * of every file written and the manifest object.
 */
export async function packPlugin(opts: PackOptions): Promise<PackResult> {
  const outDir = path.resolve(opts.outDir);
  const templatesRoot = opts.templatesDir ?? defaultTemplatesDir();
  const claudeTemplates = path.join(templatesRoot, "claude");
  const pkgRoot = opts.packageRoot ?? packageRoot();
  const written: string[] = [];

  await fs.ensureDir(outDir);

  const manifest = await buildManifest(opts.manifest ?? {}, pkgRoot);

  // 1. .claude-plugin/plugin.json
  const manifestDir = path.join(outDir, ".claude-plugin");
  await fs.ensureDir(manifestDir);
  const manifestPath = path.join(manifestDir, "plugin.json");
  await fs.writeFile(manifestPath, renderManifest(manifest), "utf8");
  written.push(manifestPath);

  // 2. hooks/
  const hooksOut = path.join(outDir, "hooks");
  await fs.ensureDir(hooksOut);
  for (const hook of HOOK_FILES) {
    const from = path.join(claudeTemplates, "hooks", hook);
    const to = path.join(hooksOut, hook);
    if (await copyIfExists(from, to, written)) {
      await fs.chmod(to, 0o755).catch(() => {
        /* best effort on platforms without chmod (e.g. Windows) */
      });
    }
  }

  // 3. skills/
  const skillsOut = path.join(outDir, "skills");
  await fs.ensureDir(skillsOut);
  for (const skill of SKILL_DIRS) {
    const from = path.join(claudeTemplates, "skills", skill);
    const to = path.join(skillsOut, skill);
    if (await fs.pathExists(from)) {
      await fs.copy(from, to, { overwrite: true });
      written.push(to);
    }
  }

  // 4. agents/
  const agentsOut = path.join(outDir, "agents");
  await fs.ensureDir(agentsOut);
  for (const agent of AGENT_FILES) {
    const from = path.join(claudeTemplates, "agents", agent);
    const to = path.join(agentsOut, agent);
    await copyIfExists(from, to, written);
  }

  // 5. commands/
  const commandsOut = path.join(outDir, "commands");
  await fs.ensureDir(commandsOut);
  for (const cmd of COMMAND_FILES) {
    const from = path.join(claudeTemplates, "commands", cmd);
    const to = path.join(commandsOut, cmd);
    await copyIfExists(from, to, written);
  }

  // 6. .mcp.json
  const mcpPath = path.join(outDir, ".mcp.json");
  await fs.writeFile(
    mcpPath,
    JSON.stringify(buildMcpRegistry(), null, 2) + "\n",
    "utf8",
  );
  written.push(mcpPath);

  // The plugin layout is intentionally self-contained: no `.apex/` is emitted.
  return { outDir, manifestPath, manifest, written };
}

/** Files that MUST be present in a successfully packed plugin. */
export const REQUIRED_PLUGIN_FILES: readonly string[] = [
  ".claude-plugin/plugin.json",
  ".mcp.json",
];

/** Top-level dirs that MUST exist in a packed plugin (even if empty). */
export const REQUIRED_PLUGIN_DIRS: readonly string[] = [
  "hooks",
  "skills",
  "agents",
  "commands",
];

/**
 * Throw if `outDir` does not look like a freshly-packed APEX plugin. Useful for
 * tests and CI smoke checks.
 */
export async function assertValidPluginLayout(outDir: string): Promise<void> {
  for (const f of REQUIRED_PLUGIN_FILES) {
    const p = path.join(outDir, f);
    if (!(await fs.pathExists(p))) {
      throw new Error(`plugin layout missing required file: ${f}`);
    }
  }
  for (const d of REQUIRED_PLUGIN_DIRS) {
    const p = path.join(outDir, d);
    if (!(await fs.pathExists(p))) {
      throw new Error(`plugin layout missing required directory: ${d}`);
    }
  }
  // The plugin layout must NEVER contain user-owned APEX state.
  const apexDir = path.join(outDir, ".apex");
  if (await fs.pathExists(apexDir)) {
    throw new Error(
      `plugin layout illegally contains .apex/ — user knowledge must stay in the project, not the plugin`,
    );
  }
}
