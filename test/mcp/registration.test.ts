import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import {
  APEX_MCP_SERVER_NAME,
  registerApexMcp,
  unregisterApexMcp,
} from "../../src/scaffold/mcpRegistration.js";

async function tmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "apex-mcp-reg-"));
}

describe("registerApexMcp / unregisterApexMcp", () => {
  let root: string;

  beforeEach(async () => {
    root = await tmpRoot();
  });

  afterEach(async () => {
    await fs.remove(root).catch(() => {});
  });

  it("creates a fresh .mcp.json with the apex entry", async () => {
    const r = await registerApexMcp(root);
    expect(r.added).toBe(true);
    expect(r.mergedExisting).toBe(false);
    const json = (await fs.readJson(r.path)) as Record<string, unknown>;
    const servers = json["mcpServers"] as Record<string, unknown>;
    expect(servers[APEX_MCP_SERVER_NAME]).toBeDefined();
    const entry = servers[APEX_MCP_SERVER_NAME] as Record<string, unknown>;
    expect(entry["command"]).toBe("node");
    expect(entry["_apex_managed"]).toBe(true);
  });

  it("is idempotent on re-run", async () => {
    await registerApexMcp(root);
    const second = await registerApexMcp(root);
    expect(second.added).toBe(false);
    expect(second.mergedExisting).toBe(true);
  });

  it("preserves user-added servers when merging", async () => {
    const file = path.join(root, ".mcp.json");
    await fs.writeJson(
      file,
      {
        mcpServers: {
          mine: { command: "echo", args: ["hi"] },
        },
        otherKey: "preserved",
      },
      { spaces: 2 },
    );
    const r = await registerApexMcp(root);
    expect(r.added).toBe(true);
    expect(r.mergedExisting).toBe(true);
    const json = (await fs.readJson(file)) as Record<string, unknown>;
    const servers = json["mcpServers"] as Record<string, unknown>;
    expect(servers["mine"]).toBeDefined();
    expect((servers["mine"] as Record<string, unknown>)["command"]).toBe("echo");
    expect(servers[APEX_MCP_SERVER_NAME]).toBeDefined();
    expect(json["otherKey"]).toBe("preserved");
  });

  it("recovers gracefully from malformed JSON by backing up and writing fresh", async () => {
    const file = path.join(root, ".mcp.json");
    await fs.writeFile(file, "{ this is not valid json", "utf8");
    const r = await registerApexMcp(root);
    expect(r.added).toBe(true);
    const json = (await fs.readJson(file)) as Record<string, unknown>;
    const servers = json["mcpServers"] as Record<string, unknown>;
    expect(servers[APEX_MCP_SERVER_NAME]).toBeDefined();
    const dirEntries = await fs.readdir(root);
    expect(dirEntries.some((f) => f.startsWith(".mcp.json.bak."))).toBe(true);
  });

  it("unregister removes only the apex entry and preserves others", async () => {
    const file = path.join(root, ".mcp.json");
    await fs.writeJson(
      file,
      {
        mcpServers: {
          mine: { command: "echo", args: ["hi"] },
        },
      },
      { spaces: 2 },
    );
    await registerApexMcp(root);
    const u = await unregisterApexMcp(root);
    expect(u.removed).toBe(true);
    expect(u.fileDeleted).toBe(false);
    const json = (await fs.readJson(file)) as Record<string, unknown>;
    const servers = json["mcpServers"] as Record<string, unknown>;
    expect(servers["mine"]).toBeDefined();
    expect(servers[APEX_MCP_SERVER_NAME]).toBeUndefined();
  });

  it("unregister deletes the file when no servers remain", async () => {
    await registerApexMcp(root);
    const u = await unregisterApexMcp(root);
    expect(u.removed).toBe(true);
    expect(u.fileDeleted).toBe(true);
    expect(await fs.pathExists(path.join(root, ".mcp.json"))).toBe(false);
  });

  it("unregister is a no-op when .mcp.json doesn't exist", async () => {
    const u = await unregisterApexMcp(root);
    expect(u.removed).toBe(false);
    expect(u.fileDeleted).toBe(false);
  });
});
