/**
 * Plugin upgrade safety planner.
 *
 * APEX is split into two ownership domains:
 *
 *   - **Plugin-owned** files: hooks, skills, agents, commands, the MCP registry,
 *     and the plugin manifest. These are produced by `packer.ts` and are
 *     freely replaced on upgrade.
 *
 *   - **User-owned** files: the entire `.apex/` knowledge tree (decisions,
 *     patterns, gotchas, conventions, proposed entries, episodes, config) and
 *     `CLAUDE.local.md`. These are NEVER overwritten by an upgrade.
 *
 * `planUpgrade()` inspects an installed project and a freshly-packed plugin
 * directory, and returns a plan that callers can render or apply. **The
 * planner never mutates the filesystem** — it only reports what an upgrade
 * would do.
 */
import path from "node:path";
import fs from "fs-extra";

export type FileOwnership = "plugin" | "user";

export type UpgradeAction =
  | "replace"   // plugin file present in both; replace existing
  | "add"       // plugin file new; add to project
  | "remove"    // plugin file removed upstream; delete from project
  | "skip";     // user-owned; never touch

export interface UpgradeFile {
  /** Project-relative path. */
  relPath: string;
  ownership: FileOwnership;
  action: UpgradeAction;
  reason: string;
}

export interface UpgradePlan {
  projectRoot: string;
  pluginDir: string;
  /** Files that would be replaced/added/removed. */
  changes: UpgradeFile[];
  /** Files explicitly skipped because they are user-owned. */
  preserved: UpgradeFile[];
  /** Convenience counts. */
  counts: {
    replace: number;
    add: number;
    remove: number;
    skip: number;
  };
}

/**
 * Path patterns that are user-owned and MUST NOT be touched by an upgrade.
 *
 * Matching is project-relative and uses simple prefix / equality rules. Order
 * matters only in that the first match wins, but the rules here are mutually
 * exclusive in practice.
 */
export const USER_OWNED_PATHS: readonly string[] = [
  ".apex/knowledge",
  ".apex/proposed",
  ".apex/episodes",
  ".apex/config.toml",
  ".apex/install.json",
  "CLAUDE.local.md",
];

/**
 * Path prefixes that are plugin-owned. Anything under one of these prefixes
 * (in the user's project) was originally written by APEX and is replaceable.
 */
export const PLUGIN_OWNED_PREFIXES: readonly string[] = [
  ".claude/hooks/",
  ".claude/skills/",
  ".claude/agents/",
  ".claude/commands/",
  ".claude-plugin/",
];

/**
 * Plugin-owned source directories *inside the packed plugin layout* that map
 * to project-relative destinations under the user's installed `.claude/`
 * tree. Used to enumerate which files would be replaced/added.
 */
const PLUGIN_TO_PROJECT_DIRS: ReadonlyArray<{ src: string; dst: string }> = [
  { src: "hooks", dst: ".claude/hooks" },
  { src: "skills", dst: ".claude/skills" },
  { src: "agents", dst: ".claude/agents" },
  { src: "commands", dst: ".claude/commands" },
];

/**
 * Top-level files inside the packed plugin layout that map to project-relative
 * destinations.
 */
const PLUGIN_TO_PROJECT_FILES: ReadonlyArray<{ src: string; dst: string }> = [
  { src: ".claude-plugin/plugin.json", dst: ".claude-plugin/plugin.json" },
];

/** Return true if `relPath` is user-owned (never overwritten by upgrade). */
export function isUserOwned(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  for (const p of USER_OWNED_PATHS) {
    if (norm === p) return true;
    if (norm.startsWith(p + "/")) return true;
  }
  return false;
}

/** Return true if `relPath` is plugin-owned (replaceable on upgrade). */
export function isPluginOwned(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/");
  for (const prefix of PLUGIN_OWNED_PREFIXES) {
    if (norm.startsWith(prefix)) return true;
    if (norm + "/" === prefix) return true;
  }
  return false;
}

async function listFilesRecursive(root: string, base = ""): Promise<string[]> {
  if (!(await fs.pathExists(root))) return [];
  const out: string[] = [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const sub = path.join(base, entry.name);
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFilesRecursive(abs, sub);
      out.push(...nested);
    } else if (entry.isFile()) {
      out.push(sub);
    }
  }
  return out;
}

/**
 * Build an upgrade plan: given an existing project root and a freshly-packed
 * plugin directory, list which project files would be replaced, added,
 * removed, or skipped.
 *
 * NEVER touches the filesystem.
 */
export async function planUpgrade(
  projectRoot: string,
  pluginDir: string,
): Promise<UpgradePlan> {
  const root = path.resolve(projectRoot);
  const plugin = path.resolve(pluginDir);

  const changes: UpgradeFile[] = [];
  const preserved: UpgradeFile[] = [];

  // 1. Enumerate plugin-owned files coming FROM the new plugin.
  const incoming = new Set<string>();

  for (const { src, dst } of PLUGIN_TO_PROJECT_DIRS) {
    const fromDir = path.join(plugin, src);
    const files = await listFilesRecursive(fromDir);
    for (const f of files) {
      const rel = path.posix.join(dst, f.replace(/\\/g, "/"));
      incoming.add(rel);
      const projAbs = path.join(root, rel);
      const exists = await fs.pathExists(projAbs);
      changes.push({
        relPath: rel,
        ownership: "plugin",
        action: exists ? "replace" : "add",
        reason: exists
          ? "plugin-owned: replaced on upgrade"
          : "plugin-owned: new in this plugin version",
      });
    }
  }

  for (const { src, dst } of PLUGIN_TO_PROJECT_FILES) {
    const from = path.join(plugin, src);
    if (!(await fs.pathExists(from))) continue;
    incoming.add(dst);
    const projAbs = path.join(root, dst);
    const exists = await fs.pathExists(projAbs);
    changes.push({
      relPath: dst,
      ownership: "plugin",
      action: exists ? "replace" : "add",
      reason: exists
        ? "plugin-owned: replaced on upgrade"
        : "plugin-owned: new in this plugin version",
    });
  }

  // 2. Enumerate plugin-owned files in the EXISTING project that are no
  //    longer present in the incoming plugin — those are removals.
  for (const { dst } of PLUGIN_TO_PROJECT_DIRS) {
    const dir = path.join(root, dst);
    const existing = await listFilesRecursive(dir);
    for (const f of existing) {
      const rel = path.posix.join(dst, f.replace(/\\/g, "/"));
      if (!incoming.has(rel)) {
        changes.push({
          relPath: rel,
          ownership: "plugin",
          action: "remove",
          reason: "plugin-owned: removed in newer plugin version",
        });
      }
    }
  }

  // 3. Walk user-owned trees to record what is preserved (diagnostic only).
  for (const userPath of USER_OWNED_PATHS) {
    const abs = path.join(root, userPath);
    if (!(await fs.pathExists(abs))) continue;
    const stat = await fs.stat(abs);
    if (stat.isDirectory()) {
      const files = await listFilesRecursive(abs);
      for (const f of files) {
        preserved.push({
          relPath: path.posix.join(userPath, f.replace(/\\/g, "/")),
          ownership: "user",
          action: "skip",
          reason: "user-owned: never overwritten by plugin upgrade",
        });
      }
    } else {
      preserved.push({
        relPath: userPath,
        ownership: "user",
        action: "skip",
        reason: "user-owned: never overwritten by plugin upgrade",
      });
    }
  }

  const counts = {
    replace: changes.filter((c) => c.action === "replace").length,
    add: changes.filter((c) => c.action === "add").length,
    remove: changes.filter((c) => c.action === "remove").length,
    skip: preserved.length,
  };

  return { projectRoot: root, pluginDir: plugin, changes, preserved, counts };
}

/**
 * Render an upgrade plan as a human-readable summary. Stable, sorted output
 * suitable for CI diffs.
 */
export function renderPlan(plan: UpgradePlan): string {
  const lines: string[] = [];
  lines.push(
    `apex plugin upgrade plan: replace=${plan.counts.replace} add=${plan.counts.add} remove=${plan.counts.remove} skip=${plan.counts.skip}`,
  );
  const sorted = [...plan.changes].sort((a, b) => a.relPath.localeCompare(b.relPath));
  for (const c of sorted) {
    lines.push(`  ${c.action.padEnd(7)} ${c.relPath}`);
  }
  if (plan.preserved.length > 0) {
    lines.push(`  (${plan.preserved.length} user-owned file(s) preserved)`);
  }
  return lines.join("\n") + "\n";
}
