/**
 * Plugin manifest generator.
 *
 * Produces the `.claude-plugin/plugin.json` document that Claude Code reads
 * when a plugin is installed. The shape mirrors the public Claude Code plugin
 * spec: a `name`, `version`, `description`, `author`, and pointers to the
 * subdirectories that hold hooks, skills, agents, commands, and the MCP
 * server registration.
 *
 * Defaults are pulled from this package's `package.json` so the manifest
 * stays in lockstep with the published `apex-cc` build that produced it.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author: PluginAuthor;
  /** Relative path inside the plugin layout. Conventional: `./hooks`. */
  hooks: string;
  /** Relative path inside the plugin layout. Conventional: `./skills`. */
  skills: string;
  /** Relative path inside the plugin layout. Conventional: `./agents`. */
  agents: string;
  /** Relative path inside the plugin layout. Conventional: `./commands`. */
  commands: string;
  /** Relative path to the MCP server registry inside the plugin. */
  mcp: string;
}

export interface ManifestOverrides {
  name?: string;
  version?: string;
  description?: string;
  author?: PluginAuthor;
}

interface PartialPackageJson {
  name?: string;
  version?: string;
  description?: string;
  author?: string | PluginAuthor;
}

/**
 * Locate the `apex-cc` package.json that describes the running build.
 *
 * Resolution order:
 *  1. The package root inferred from `import.meta.url` (works for `src/` in
 *     dev and `dist/` after build, both two levels under the repo root).
 *  2. A caller-provided directory (used by tests with synthetic fixtures).
 */
export function packageRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(here), "..", "..");
}

async function readPackageJson(root: string): Promise<PartialPackageJson> {
  const p = path.join(root, "package.json");
  try {
    const data = (await fs.readJson(p)) as PartialPackageJson;
    return data;
  } catch {
    return {};
  }
}

function normalizeAuthor(raw: unknown): PluginAuthor {
  if (raw && typeof raw === "object" && "name" in raw) {
    const a = raw as PluginAuthor;
    const out: PluginAuthor = { name: a.name };
    if (a.email) out.email = a.email;
    if (a.url) out.url = a.url;
    return out;
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    return { name: raw };
  }
  return { name: "APEX maintainers" };
}

function normalizeName(raw: string | undefined): string {
  // Plugin names are conventionally short, kebab-case, and don't include
  // the `-cc` package suffix.
  const fallback = "apex";
  if (!raw) return fallback;
  return raw.replace(/^@[^/]+\//, "").replace(/-cc$/, "") || fallback;
}

/**
 * Build a plugin manifest object from the running package's `package.json`,
 * with optional overrides.
 *
 * The returned object can be JSON-stringified directly into
 * `.claude-plugin/plugin.json`.
 */
export async function buildManifest(
  overrides: ManifestOverrides = {},
  pkgRoot: string = packageRoot(),
): Promise<PluginManifest> {
  const pkg = await readPackageJson(pkgRoot);
  return {
    name: overrides.name ?? normalizeName(pkg.name),
    version: overrides.version ?? pkg.version ?? "0.0.0",
    description:
      overrides.description ??
      pkg.description ??
      "APEX — self-learning project intelligence layer for Claude Code",
    author: overrides.author ?? normalizeAuthor(pkg.author),
    hooks: "./hooks",
    skills: "./skills",
    agents: "./agents",
    commands: "./commands",
    mcp: "./.mcp.json",
  };
}

/** Render a manifest as the JSON string that lives on disk. */
export function renderManifest(m: PluginManifest): string {
  return JSON.stringify(m, null, 2) + "\n";
}
