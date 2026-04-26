import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { APEX_MCP_VERSION, buildServer } from "../../src/mcp/index.js";
import type { ToolContext } from "../../src/mcp/tools.js";

function setupFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "apex-mcp-srv-"));
  const src = path.resolve("test/fixtures/knowledge");
  const dest = path.join(root, ".apex", "knowledge");
  fs.mkdirSync(dest, { recursive: true });
  for (const sub of ["decisions", "patterns", "gotchas", "conventions"]) {
    fs.mkdirSync(path.join(dest, sub), { recursive: true });
    const dir = path.join(src, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      fs.copyFileSync(path.join(dir, f), path.join(dest, sub, f));
    }
  }
  return root;
}

describe("MCP server (in-process)", () => {
  let root: string;
  let ctx: ToolContext;
  let client: Client;

  beforeEach(async () => {
    root = setupFixture();
    const built = buildServer({ root });
    ctx = built.ctx;
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "apex-test-client", version: "0.0.0" });
    await Promise.all([
      built.server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterEach(async () => {
    await client.close();
    ctx.close();
    await new Promise<void>((r) => setTimeout(r, 5));
  });

  it("advertises the expected version and instructions", () => {
    const v = client.getServerVersion();
    expect(v?.version).toBe(APEX_MCP_VERSION);
    const instructions = client.getInstructions();
    expect(instructions).toContain("APEX recall and capture");
    expect(instructions).toContain("Claude Code");
  });

  it("tools/list returns all six tools without opening SQLite", async () => {
    const indexPath = path.join(root, ".apex", "index", "fts.sqlite");
    expect(fs.existsSync(indexPath)).toBe(false);
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "apex_get",
      "apex_get_decision",
      "apex_propose",
      "apex_record_correction",
      "apex_search",
      "apex_stats",
    ]);
    expect(fs.existsSync(indexPath)).toBe(false);
  });

  it("apex_search returns structuredContent through the transport", async () => {
    const result = await client.callTool({
      name: "apex_search",
      arguments: { query: "pnpm" },
    });
    expect(result.structuredContent).toBeDefined();
    const sc = result.structuredContent as {
      hits: Array<{ entry_id: string }>;
      query: string;
    };
    expect(sc.query).toBe("pnpm");
    expect(sc.hits.length).toBeGreaterThan(0);
  });

  it("apex_get_decision returns the decision entry", async () => {
    const result = await client.callTool({
      name: "apex_get_decision",
      arguments: { entry_id: "db-postgres-pinned" },
    });
    const sc = result.structuredContent as {
      frontmatter: { type: string; id: string };
    };
    expect(sc.frontmatter.type).toBe("decision");
    expect(sc.frontmatter.id).toBe("db-postgres-pinned");
  });

  it("apex_stats returns counts by type", async () => {
    const result = await client.callTool({
      name: "apex_stats",
      arguments: {},
    });
    const sc = result.structuredContent as {
      total: number;
      by_type: Record<string, number>;
    };
    expect(sc.total).toBe(12);
    expect(sc.by_type["decision"]).toBe(3);
  });
});
