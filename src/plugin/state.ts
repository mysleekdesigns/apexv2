/**
 * Plugin state-path helper.
 *
 * Claude Code exposes a per-plugin data directory via the `CLAUDE_PLUGIN_DATA`
 * environment variable. Anything written there is owned by the plugin instance
 * (not the user's project) and survives plugin upgrades — exactly what APEX
 * needs for caches, telemetry buffers, and any state that should NOT live
 * inside the user-owned `.apex/` tree.
 *
 * APEX-owned state that should survive plugin upgrades belongs here.
 * User-owned data (knowledge, episodes, config) MUST stay under the project's
 * `.apex/` directory and is never written to `pluginDataDir()`.
 *
 * Outside the Claude Code plugin runtime (e.g. local dev, CI, the test suite)
 * we fall back to a stable per-project directory inside the OS temp dir, keyed
 * by an optional project root, so callers always get a usable, writable path.
 */
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

/**
 * Return the directory APEX should use for plugin-managed state.
 *
 * Resolution order:
 *  1. `process.env.CLAUDE_PLUGIN_DATA` if set (the production path under
 *     Claude Code).
 *  2. A deterministic fallback under `os.tmpdir()` keyed by the optional
 *     `projectRoot` so two different projects don't share the same dir.
 *
 * The function is pure: it does NOT create the directory. Callers that need
 * the path on disk should `fs.ensureDir(pluginDataDir(...))` themselves.
 */
export function pluginDataDir(projectRoot?: string): string {
  const fromEnv = process.env["CLAUDE_PLUGIN_DATA"];
  if (fromEnv && fromEnv.trim().length > 0) {
    return path.resolve(fromEnv.trim());
  }
  const key = projectRoot
    ? crypto.createHash("sha1").update(path.resolve(projectRoot)).digest("hex").slice(0, 12)
    : "default";
  return path.join(os.tmpdir(), "apex-plugin-data", key);
}

/** True when the plugin runtime has provided a `CLAUDE_PLUGIN_DATA` directory. */
export function hasPluginDataEnv(): boolean {
  const v = process.env["CLAUDE_PLUGIN_DATA"];
  return typeof v === "string" && v.trim().length > 0;
}
