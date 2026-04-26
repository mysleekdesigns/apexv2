import path from "node:path";
import { z } from "zod";
import { KnowledgeGraph, type BlastEntry, type NeighborOutput, type PathStep } from "./index.js";

export const apexGraphDependentsInputShape = {
  entry_id: z.string().min(1).max(128),
  relation: z
    .enum(["supersedes", "applies-to", "references", "tagged", "affects"])
    .optional(),
  max_depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
};

export const apexGraphDependenciesInputShape = {
  entry_id: z.string().min(1).max(128),
  relation: z
    .enum(["supersedes", "applies-to", "references", "tagged", "affects"])
    .optional(),
  max_depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
};

export const apexGraphBlastInputShape = {
  entry_id: z.string().min(1).max(128),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
};

export interface GraphToolContext {
  root: string;
  graph: KnowledgeGraph;
}

export function createGraphToolContext(root: string): GraphToolContext {
  return { root: path.resolve(root), graph: new KnowledgeGraph(root) };
}

export interface DependentsResult {
  entry_id: string;
  results: NeighborOutput[];
}

export async function apexGraphDependents(
  ctx: GraphToolContext,
  args: { entry_id: string; relation?: NeighborOutput["relation"]; max_depth?: 1 | 2 | 3 },
): Promise<DependentsResult> {
  const results = await ctx.graph.dependents(args.entry_id, {
    relation: args.relation,
    maxDepth: args.max_depth ?? 1,
  });
  return { entry_id: args.entry_id, results };
}

export interface DependenciesResult {
  entry_id: string;
  results: NeighborOutput[];
}

export async function apexGraphDependencies(
  ctx: GraphToolContext,
  args: { entry_id: string; relation?: NeighborOutput["relation"]; max_depth?: 1 | 2 | 3 },
): Promise<DependenciesResult> {
  const results = await ctx.graph.dependencies(args.entry_id, {
    relation: args.relation,
    maxDepth: args.max_depth ?? 1,
  });
  return { entry_id: args.entry_id, results };
}

export interface BlastResult {
  entry_id: string;
  depth: number;
  results: BlastEntry[];
}

export async function apexGraphBlast(
  ctx: GraphToolContext,
  args: { entry_id: string; depth?: 1 | 2 | 3 },
): Promise<BlastResult> {
  const depth = args.depth ?? 2;
  const results = await ctx.graph.blastRadius(args.entry_id, depth);
  return { entry_id: args.entry_id, depth, results };
}

export type { BlastEntry, NeighborOutput, PathStep };
