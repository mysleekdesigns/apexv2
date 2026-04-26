import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  apexGet,
  apexGetInputShape,
  apexPropose,
  apexProposeInputShape,
  apexRecordCorrection,
  apexRecordCorrectionInputShape,
  apexSearch,
  apexSearchInputShape,
  apexStats,
  apexStatsInputShape,
  createToolContext,
  type ToolContext,
} from "./tools.js";

export interface BuildServerOptions {
  root: string;
  name?: string;
  version?: string;
}

export function buildServer(opts: BuildServerOptions): {
  server: McpServer;
  ctx: ToolContext;
} {
  const ctx = createToolContext(opts.root);
  const server = new McpServer(
    {
      name: opts.name ?? "apex-mcp",
      version: opts.version ?? "0.1.0-phase1",
    },
    {
      capabilities: { tools: {} },
      instructions:
        "APEX recall and capture tools. Use apex_search to find decisions, patterns, gotchas, and conventions. Always cite the returned `path` when applying a hit.",
    },
  );

  server.registerTool(
    "apex_search",
    {
      description:
        "Search the project's APEX knowledge base (decisions, patterns, gotchas, conventions). Returns ranked hits with file path and last_validated date.",
      inputSchema: apexSearchInputShape,
    },
    async (args) => {
      const result = await apexSearch(ctx, args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "apex_get",
    {
      description:
        "Fetch a full APEX knowledge entry by id (and optional type). Returns the entry's frontmatter, body, and on-disk path.",
      inputSchema: apexGetInputShape,
    },
    async (args) => {
      const entry = await apexGet(ctx, args);
      return {
        content: [
          {
            type: "text",
            text: entry ? JSON.stringify(entry, null, 2) : `not found: ${args.entry_id}`,
          },
        ],
        structuredContent: entry
          ? (entry as unknown as Record<string, unknown>)
          : { found: false },
      };
    },
  );

  server.registerTool(
    "apex_record_correction",
    {
      description:
        "Append a user-driven correction to .apex/proposed/_corrections.md. The reflector consumes this queue between sessions; corrections are never auto-merged.",
      inputSchema: apexRecordCorrectionInputShape,
    },
    async (args) => {
      const result = await apexRecordCorrection(ctx, args);
      return {
        content: [
          { type: "text", text: `recorded at ${result.recorded_at} -> ${result.path}` },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "apex_propose",
    {
      description:
        "Write a candidate knowledge entry to .apex/proposed/. Never auto-merges; awaits human or curator review.",
      inputSchema: apexProposeInputShape,
    },
    async (args) => {
      const result = await apexPropose(ctx, args);
      return {
        content: [{ type: "text", text: `proposed -> ${result.path}` }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "apex_stats",
    {
      description:
        "Return APEX index stats: counts by type, last sync time, and drift warnings.",
      inputSchema: apexStatsInputShape as Record<string, z.ZodTypeAny>,
    },
    async () => {
      const result = await apexStats(ctx);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  return { server, ctx };
}

export async function runStdio(root: string): Promise<{
  server: McpServer;
  ctx: ToolContext;
  transport: StdioServerTransport;
}> {
  const { server, ctx } = buildServer({ root });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return { server, ctx, transport };
}
