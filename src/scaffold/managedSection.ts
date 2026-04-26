import { APEX_MANAGED_BEGIN, APEX_MANAGED_END } from "../types/shared.js";

export interface ManagedSpliceResult {
  content: string;
  hadExisting: boolean;
}

const GITIGNORE_BEGIN = "# apex:begin";
const GITIGNORE_END = "# apex:end";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegion(begin: string, end: string): RegExp {
  return new RegExp(
    `${escapeRegExp(begin)}[\\s\\S]*?${escapeRegExp(end)}\\n?`,
    "m",
  );
}

/** Splice an APEX-managed region into a markdown file. Replaces existing region if present. */
export function spliceMarkdownManaged(
  existing: string,
  managedBody: string,
): ManagedSpliceResult {
  const block = `${APEX_MANAGED_BEGIN}\n${managedBody.replace(/\s+$/, "")}\n${APEX_MANAGED_END}\n`;
  const re = buildRegion(APEX_MANAGED_BEGIN, APEX_MANAGED_END);
  if (re.test(existing)) {
    return { content: existing.replace(re, block), hadExisting: true };
  }
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const prefix = existing.length === 0 ? "" : `${existing}${sep}\n`;
  return { content: `${prefix}${block}`, hadExisting: false };
}

/** Extract managed body from a markdown file, or null if not present. */
export function extractMarkdownManaged(existing: string): string | null {
  const re = new RegExp(
    `${escapeRegExp(APEX_MANAGED_BEGIN)}\\n([\\s\\S]*?)\\n${escapeRegExp(APEX_MANAGED_END)}`,
    "m",
  );
  const m = existing.match(re);
  return m && m[1] !== undefined ? m[1] : null;
}

/** Remove the managed region from a markdown file. Returns the cleaned content. */
export function removeMarkdownManaged(existing: string): string {
  const re = buildRegion(APEX_MANAGED_BEGIN, APEX_MANAGED_END);
  const cleaned = existing.replace(re, "");
  return cleaned.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
}

/** Splice a managed block into a .gitignore file. */
export function spliceGitignoreManaged(
  existing: string,
  managedLines: string[],
): ManagedSpliceResult {
  const body = managedLines.map((l) => l.trim()).filter((l) => l.length > 0);
  const block = `${GITIGNORE_BEGIN}\n${body.join("\n")}\n${GITIGNORE_END}\n`;
  const re = buildRegion(GITIGNORE_BEGIN, GITIGNORE_END);
  if (re.test(existing)) {
    return { content: existing.replace(re, block), hadExisting: true };
  }
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const prefix = existing.length === 0 ? "" : `${existing}${sep}\n`;
  return { content: `${prefix}${block}`, hadExisting: false };
}

/** Remove the managed block from a .gitignore. */
export function removeGitignoreManaged(existing: string): string {
  const re = buildRegion(GITIGNORE_BEGIN, GITIGNORE_END);
  return existing.replace(re, "").replace(/\n{3,}/g, "\n\n");
}

export interface JsonManagedOptions {
  /** Top-level key under which APEX writes its managed content. */
  key: string;
}

/**
 * Splice an APEX-managed value into a JSON object. Adds `_apex_managed: true`
 * marker on every direct entry under `value` so the block is identifiable on upgrade.
 */
export function spliceJsonManaged(
  existing: Record<string, unknown> | null,
  value: Record<string, unknown>,
  opts: JsonManagedOptions,
): { merged: Record<string, unknown>; hadExisting: boolean } {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" ? { ...existing } : {};
  const had = base[opts.key] !== undefined;
  const tagged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      tagged[k] = { ...(v as Record<string, unknown>), _apex_managed: true };
    } else {
      tagged[k] = v;
    }
  }
  base[opts.key] = tagged;
  return { merged: base, hadExisting: had };
}

/**
 * Splice an APEX-managed array of hook entries into `settings.json`.
 * Replaces any entries tagged `_apex_managed: true`; preserves user entries.
 */
export function spliceSettingsHooks(
  existing: Record<string, unknown> | null,
  apexHooks: Record<string, unknown[]>,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" ? { ...existing } : {};
  const userHooksRaw = base["hooks"];
  const userHooks: Record<string, unknown[]> =
    userHooksRaw && typeof userHooksRaw === "object" && !Array.isArray(userHooksRaw)
      ? { ...(userHooksRaw as Record<string, unknown[]>) }
      : {};

  const events = new Set<string>([
    ...Object.keys(userHooks),
    ...Object.keys(apexHooks),
  ]);
  const merged: Record<string, unknown[]> = {};
  for (const event of events) {
    const userArr = Array.isArray(userHooks[event])
      ? (userHooks[event] as unknown[]).filter(
          (e) =>
            !(e && typeof e === "object" && (e as Record<string, unknown>)["_apex_managed"] === true),
        )
      : [];
    const apexArr = (apexHooks[event] ?? []).map((entry) => {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        return { ...(entry as Record<string, unknown>), _apex_managed: true };
      }
      return entry;
    });
    merged[event] = [...userArr, ...apexArr];
  }
  base["hooks"] = merged;
  base["apex_settings_version"] = 1;
  return base;
}

/** Remove APEX-tagged hook entries from settings.json. */
export function removeSettingsHooks(
  existing: Record<string, unknown> | null,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" ? { ...existing } : {};
  const userHooksRaw = base["hooks"];
  if (!userHooksRaw || typeof userHooksRaw !== "object" || Array.isArray(userHooksRaw)) {
    delete base["apex_settings_version"];
    return base;
  }
  const userHooks = userHooksRaw as Record<string, unknown[]>;
  const cleaned: Record<string, unknown[]> = {};
  for (const [event, arr] of Object.entries(userHooks)) {
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter(
      (e) =>
        !(e && typeof e === "object" && (e as Record<string, unknown>)["_apex_managed"] === true),
    );
    if (kept.length > 0) cleaned[event] = kept;
  }
  if (Object.keys(cleaned).length === 0) {
    delete base["hooks"];
  } else {
    base["hooks"] = cleaned;
  }
  delete base["apex_settings_version"];
  return base;
}

/** Splice an APEX-managed entry into `.mcp.json`'s `mcpServers`. */
export function spliceMcpServers(
  existing: Record<string, unknown> | null,
  serverName: string,
  serverConfig: Record<string, unknown>,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" ? { ...existing } : {};
  const serversRaw = base["mcpServers"];
  const servers: Record<string, unknown> =
    serversRaw && typeof serversRaw === "object" && !Array.isArray(serversRaw)
      ? { ...(serversRaw as Record<string, unknown>) }
      : {};
  servers[serverName] = { ...serverConfig, _apex_managed: true };
  base["mcpServers"] = servers;
  return base;
}

/** Remove an APEX-tagged entry from `.mcp.json`'s mcpServers. */
export function removeMcpServer(
  existing: Record<string, unknown> | null,
  serverName: string,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    existing && typeof existing === "object" ? { ...existing } : {};
  const serversRaw = base["mcpServers"];
  if (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw)) {
    return base;
  }
  const servers = { ...(serversRaw as Record<string, unknown>) };
  const entry = servers[serverName];
  if (
    entry &&
    typeof entry === "object" &&
    (entry as Record<string, unknown>)["_apex_managed"] === true
  ) {
    delete servers[serverName];
  }
  if (Object.keys(servers).length === 0) {
    delete base["mcpServers"];
  } else {
    base["mcpServers"] = servers;
  }
  return base;
}
