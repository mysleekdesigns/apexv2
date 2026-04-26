import path from "node:path";
import fs from "fs-extra";
import { projectPaths, templatesDir } from "../util/paths.js";

export const APEX_MCP_SERVER_NAME = "apex";

export interface RegisterResult {
  added: boolean;
  mergedExisting: boolean;
  path: string;
}

export interface UnregisterResult {
  removed: boolean;
  fileDeleted: boolean;
  path: string;
}

interface McpJsonShape {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
}

function defaultApexEntry(): Record<string, unknown> {
  return {
    _apex_managed: true,
    type: "stdio",
    command: "node",
    args: ["./node_modules/apex-cc/dist/mcp/server-bin.js"],
    env: { CLAUDE_PROJECT_DIR: "${CLAUDE_PROJECT_DIR}" },
  };
}

async function readTemplateEntry(): Promise<Record<string, unknown>> {
  const tplPath = path.join(templatesDir(), ".mcp.json.tpl");
  try {
    const raw = await fs.readFile(tplPath, "utf8");
    const parsed = JSON.parse(raw) as McpJsonShape;
    const entry = parsed.mcpServers?.[APEX_MCP_SERVER_NAME];
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      return { ...(entry as Record<string, unknown>), _apex_managed: true };
    }
  } catch {
    /* fall through */
  }
  return defaultApexEntry();
}

function shapesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!shapesEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  const bk = Object.keys(bo);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if (!shapesEqual(ao[k], bo[k])) return false;
  }
  return true;
}

async function backupMalformed(filePath: string): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = `${filePath}.bak.${ts}`;
  await fs.move(filePath, backup, { overwrite: true });
  return backup;
}

export async function registerApexMcp(root: string): Promise<RegisterResult> {
  const paths = projectPaths(root);
  const filePath = paths.mcpJson;
  const entry = await readTemplateEntry();

  let existing: McpJsonShape | null = null;
  let mergedExisting = false;

  if (await fs.pathExists(filePath)) {
    mergedExisting = true;
    try {
      const raw = await fs.readFile(filePath, "utf8");
      existing = JSON.parse(raw) as McpJsonShape;
      if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
        throw new Error("not a JSON object");
      }
    } catch (err) {
      const backup = await backupMalformed(filePath);
      process.stderr.write(
        `[apex] .mcp.json was malformed (${(err as Error).message}); backed up to ${path.basename(
          backup,
        )}\n`,
      );
      existing = null;
      mergedExisting = false;
    }
  }

  const base: McpJsonShape =
    existing && typeof existing === "object" ? { ...existing } : {};
  const serversRaw = base.mcpServers;
  const servers: Record<string, unknown> =
    serversRaw && typeof serversRaw === "object" && !Array.isArray(serversRaw)
      ? { ...(serversRaw as Record<string, unknown>) }
      : {};

  const prior = servers[APEX_MCP_SERVER_NAME];
  if (shapesEqual(prior, entry)) {
    return { added: false, mergedExisting, path: filePath };
  }
  servers[APEX_MCP_SERVER_NAME] = entry;
  base.mcpServers = servers;

  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(base, null, 2)}\n`, "utf8");

  return { added: true, mergedExisting, path: filePath };
}

export async function unregisterApexMcp(root: string): Promise<UnregisterResult> {
  const paths = projectPaths(root);
  const filePath = paths.mcpJson;
  if (!(await fs.pathExists(filePath))) {
    return { removed: false, fileDeleted: false, path: filePath };
  }

  let parsed: McpJsonShape;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    parsed = JSON.parse(raw) as McpJsonShape;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("not a JSON object");
    }
  } catch {
    return { removed: false, fileDeleted: false, path: filePath };
  }

  const serversRaw = parsed.mcpServers;
  if (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw)) {
    return { removed: false, fileDeleted: false, path: filePath };
  }
  const servers = { ...(serversRaw as Record<string, unknown>) };
  const had = Object.prototype.hasOwnProperty.call(servers, APEX_MCP_SERVER_NAME);
  if (!had) {
    return { removed: false, fileDeleted: false, path: filePath };
  }
  delete servers[APEX_MCP_SERVER_NAME];

  if (Object.keys(servers).length === 0) {
    const otherKeys = Object.keys(parsed).filter((k) => k !== "mcpServers");
    if (otherKeys.length === 0) {
      await fs.remove(filePath);
      return { removed: true, fileDeleted: true, path: filePath };
    }
    delete parsed.mcpServers;
  } else {
    parsed.mcpServers = servers;
  }

  await fs.writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return { removed: true, fileDeleted: false, path: filePath };
}
