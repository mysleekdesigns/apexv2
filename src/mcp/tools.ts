import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { z } from "zod";
import yaml from "yaml";
import { Recall } from "../recall/index.js";
import { projectPaths } from "../util/paths.js";
import type {
  KnowledgeEntry,
  KnowledgeType,
  RecallHit,
} from "../types/shared.js";

const knowledgeTypeSchema = z.enum(["decision", "pattern", "gotcha", "convention"]);

export const apexSearchInputShape = {
  query: z.string().min(1).max(2000),
  type: knowledgeTypeSchema.optional(),
  k: z.number().int().min(1).max(50).optional(),
};

export const apexGetInputShape = {
  entry_id: z.string().min(1).max(64),
  type: knowledgeTypeSchema.optional(),
};

export const apexRecordCorrectionInputShape = {
  prompt: z.string().min(1).max(8000),
  correction: z.string().min(1).max(8000),
  evidence: z.string().min(1).max(8000),
};

const sourceShape = z.object({
  kind: z.enum(["bootstrap", "correction", "reflection", "manual", "pr"]),
  ref: z.string().min(1),
  note: z.string().optional(),
});

const proposeFrontmatterSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    type: knowledgeTypeSchema,
    title: z.string().min(1).max(120),
    applies_to: z.enum(["user", "team", "all"]),
    confidence: z.enum(["low", "medium", "high"]),
    sources: z.array(sourceShape).min(1),
    created: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    last_validated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    supersedes: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  })
  .passthrough();

export const apexProposeInputShape = {
  entry: z.object({
    frontmatter: proposeFrontmatterSchema,
    body: z.string().min(1).max(16_000),
  }),
};

export const apexStatsInputShape = {} as const;

export interface ToolContext {
  root: string;
  recall: Recall;
}

export function createToolContext(root: string): ToolContext {
  return { root: path.resolve(root), recall: new Recall(root) };
}

export interface SearchResultPayload {
  hits: RecallHit[];
  query: string;
}

export async function apexSearch(
  ctx: ToolContext,
  args: { query: string; type?: KnowledgeType; k?: number },
): Promise<SearchResultPayload> {
  const hits = await ctx.recall.search(args.query, {
    type: args.type,
    k: args.k ?? 5,
  });
  return { hits, query: args.query };
}

export async function apexGet(
  ctx: ToolContext,
  args: { entry_id: string; type?: KnowledgeType },
): Promise<KnowledgeEntry | null> {
  return ctx.recall.get(args.entry_id, args.type);
}

export interface RecordCorrectionResult {
  recorded_at: string;
  path: string;
}

export async function apexRecordCorrection(
  ctx: ToolContext,
  args: { prompt: string; correction: string; evidence: string },
): Promise<RecordCorrectionResult> {
  const paths = projectPaths(ctx.root);
  await fs.mkdir(paths.proposedDir, { recursive: true });
  const file = path.join(paths.proposedDir, "_corrections.md");
  const ts = new Date().toISOString();
  const block = [
    `## Correction recorded ${ts}`,
    "",
    "**Prompt:**",
    "",
    quoteBlock(args.prompt),
    "",
    "**Correction:**",
    "",
    quoteBlock(args.correction),
    "",
    "**Evidence:**",
    "",
    quoteBlock(args.evidence),
    "",
    "---",
    "",
  ].join("\n");
  let existing = "";
  if (fsSync.existsSync(file)) {
    existing = await fs.readFile(file, "utf8");
  } else {
    existing =
      "# Corrections queue\n\nFile written by apex_record_correction. Reflector consumes and clears.\n\n";
  }
  await fs.writeFile(file, existing + block, "utf8");
  return { recorded_at: ts, path: path.relative(ctx.root, file) };
}

export interface ProposeResult {
  path: string;
  id: string;
  type: KnowledgeType;
}

export async function apexPropose(
  ctx: ToolContext,
  args: { entry: { frontmatter: Record<string, unknown>; body: string } },
): Promise<ProposeResult> {
  const paths = projectPaths(ctx.root);
  await fs.mkdir(paths.proposedDir, { recursive: true });
  const fm = args.entry.frontmatter;
  const id = String(fm["id"]);
  const type = String(fm["type"]) as KnowledgeType;
  const file = path.join(paths.proposedDir, `${type}-${id}.md`);
  const yamlText = yaml.stringify(fm).trimEnd();
  const md = `---\n${yamlText}\n---\n\n${args.entry.body.trim()}\n`;
  await fs.writeFile(file, md, "utf8");
  return { path: path.relative(ctx.root, file), id, type };
}

export interface StatsResult {
  total: number;
  by_type: Record<KnowledgeType, number>;
  last_sync: string | null;
  index_path: string;
  drift_warnings: string[];
}

export async function apexStats(ctx: ToolContext): Promise<StatsResult> {
  const s = await ctx.recall.stats();
  return {
    total: s.total,
    by_type: s.byType,
    last_sync: s.last_sync,
    index_path: path.relative(ctx.root, s.index_path),
    drift_warnings: s.drift_warnings,
  };
}

function quoteBlock(s: string): string {
  return s
    .split(/\r?\n/)
    .map((l) => `> ${l}`)
    .join("\n");
}
