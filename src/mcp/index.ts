import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { z } from "zod";
import { CLAUDE_CODE_MIN_VERSION } from "../types/shared.js";
import {
  apexGet,
  apexGetDecision,
  apexGetDecisionInputShape,
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

export const APEX_MCP_VERSION = "0.1.0-phase3";

export interface BuildServerOptions {
  root: string;
  name?: string;
  version?: string;
}

interface ToolResponse {
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  [key: string]: unknown;
}

interface ToolDef {
  name: string;
  description: string;
  schema: Record<string, z.ZodTypeAny>;
  handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResponse>;
}

function jsonResponse<T>(value: T): ToolResponse {
  const text = value === null ? "not found" : JSON.stringify(value, null, 2);
  return {
    content: [{ type: "text", text }],
    structuredContent:
      value === null
        ? { found: false }
        : (value as unknown as Record<string, unknown>),
  };
}

const TOOLS: ToolDef[] = [
  {
    name: "apex_search",
    description:
      "Search the project's APEX knowledge base (decisions, patterns, gotchas, conventions). Returns ranked hits with file path and last_validated date.",
    schema: apexSearchInputShape,
    handler: async (ctx, args) => {
      const result = await apexSearch(
        ctx,
        args as { query: string; type?: never; k?: number },
      );
      return jsonResponse(result);
    },
  },
  {
    name: "apex_get",
    description:
      "Fetch a full APEX knowledge entry by id (and optional type). Returns the entry's frontmatter, body, and on-disk path.",
    schema: apexGetInputShape,
    handler: async (ctx, args) => {
      const entry = await apexGet(ctx, args as { entry_id: string; type?: never });
      return jsonResponse(entry);
    },
  },
  {
    name: "apex_get_decision",
    description:
      "Typed convenience wrapper around apex_get filtered to type=decision. Returns the decision entry's frontmatter, body, and on-disk path.",
    schema: apexGetDecisionInputShape,
    handler: async (ctx, args) => {
      const entry = await apexGetDecision(ctx, args as { entry_id: string });
      return jsonResponse(entry);
    },
  },
  {
    name: "apex_record_correction",
    description:
      "Append a user-driven correction to .apex/proposed/_corrections.md. The reflector consumes this queue between sessions; corrections are never auto-merged.",
    schema: apexRecordCorrectionInputShape,
    handler: async (ctx, args) => {
      const result = await apexRecordCorrection(
        ctx,
        args as { prompt: string; correction: string; evidence: string },
      );
      return {
        content: [
          { type: "text", text: `recorded at ${result.recorded_at} -> ${result.path}` },
        ],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "apex_propose",
    description:
      "Write a candidate knowledge entry to .apex/proposed/. Never auto-merges; awaits human or curator review.",
    schema: apexProposeInputShape,
    handler: async (ctx, args) => {
      const result = await apexPropose(
        ctx,
        args as { entry: { frontmatter: Record<string, unknown>; body: string } },
      );
      return {
        content: [{ type: "text", text: `proposed -> ${result.path}` }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  },
  {
    name: "apex_stats",
    description:
      "Return APEX index stats: counts by type, last sync time, and drift warnings.",
    schema: apexStatsInputShape as Record<string, z.ZodTypeAny>,
    handler: async (ctx) => {
      const result = await apexStats(ctx);
      return jsonResponse(result);
    },
  },
];

const SERVER_INSTRUCTIONS = [
  "APEX recall and capture tools for self-learning project intelligence.",
  `Tools: ${TOOLS.map((t) => t.name).join(", ")}.`,
  `Requires Claude Code >= ${CLAUDE_CODE_MIN_VERSION}.`,
  "Heavy resources (SQLite recall index) are opened lazily on first tool invocation; tools/list does not touch disk.",
  "See PRD §3.3 for the deferred-loading contract.",
  "Always cite the returned `path` and `last_validated` when applying a hit.",
].join("\n");

export function buildServer(opts: BuildServerOptions): {
  server: McpServer;
  ctx: ToolContext;
  toolNames: string[];
} {
  const ctx = createToolContext(opts.root);
  const server = new McpServer(
    {
      name: opts.name ?? "apex-mcp",
      version: opts.version ?? APEX_MCP_VERSION,
    },
    {
      capabilities: { tools: { listChanged: true } },
      instructions: SERVER_INSTRUCTIONS,
    },
  );

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      async (args: Record<string, unknown>) => tool.handler(ctx, args),
    );
  }

  return { server, ctx, toolNames: TOOLS.map((t) => t.name) };
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
