import { z } from "zod";
import { CodeIndex, type SymbolHit } from "./index.js";

export const findSymbolInputSchema = z.object({
  query: z.string().min(1).describe("Symbol name or partial substring to look up."),
  kind: z
    .enum(["function", "class", "method", "type", "interface", "const"])
    .optional()
    .describe("Restrict to a specific symbol kind."),
  exported: z.boolean().optional().describe("Only return exported symbols when true."),
  path_hint: z
    .string()
    .optional()
    .describe(
      "Optional path-substring hint (e.g. 'auth handler') used to bias results toward matching file paths.",
    ),
  k: z.number().int().min(1).max(50).default(10).describe("Maximum hits to return."),
});

export type FindSymbolInput = z.infer<typeof findSymbolInputSchema>;

export interface FindSymbolContext {
  /** Project root (the directory containing `.apex/`). */
  root: string;
}

export interface FindSymbolResult {
  hits: SymbolHit[];
}

export async function apexFindSymbol(
  ctx: FindSymbolContext,
  args: FindSymbolInput,
): Promise<FindSymbolResult> {
  const index = new CodeIndex(ctx.root);
  try {
    const direct = await index.findSymbol(args.query, {
      k: args.k,
      kind: args.kind,
      exported: args.exported,
    });
    if (!args.path_hint) return { hits: direct };
    const byPath = await index.findByPathHint(args.path_hint, { k: args.k });
    const merged = new Map<string, SymbolHit>();
    for (const h of direct) {
      merged.set(`${h.file}:${h.line}:${h.symbol}`, h);
    }
    for (const h of byPath) {
      const key = `${h.file}:${h.line}:${h.symbol}`;
      const prior = merged.get(key);
      if (prior) prior.score += 0.5;
      else merged.set(key, { ...h, score: h.score * 0.5 });
    }
    const hits = [...merged.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, args.k);
    return { hits };
  } finally {
    index.close();
  }
}
