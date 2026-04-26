import path from "node:path";
import fs from "node:fs/promises";
import matter from "gray-matter";
import yaml from "yaml";
import { z } from "zod";
import type { KnowledgeEntry, KnowledgeType } from "../types/shared.js";

// gray-matter's default js-yaml parser converts ISO dates to Date objects, which
// breaks string-based schema validation. Use the `yaml` package — yaml@2 emits
// strings for date-like scalars when not explicitly typed.
const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

const KNOWLEDGE_DIRS: Array<{ dir: string; type: KnowledgeType }> = [
  { dir: "decisions", type: "decision" },
  { dir: "patterns", type: "pattern" },
  { dir: "gotchas", type: "gotcha" },
  { dir: "conventions", type: "convention" },
];

const ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const sourceSchema = z.object({
  kind: z.enum(["bootstrap", "correction", "reflection", "manual", "pr"]),
  ref: z.string().min(1),
  note: z.string().optional(),
});

const baseFrontmatterShape = {
  id: z.string().regex(ID_REGEX).max(64),
  type: z.enum(["decision", "pattern", "gotcha", "convention"]),
  title: z.string().min(1).max(120),
  applies_to: z.enum(["user", "team", "all"]),
  confidence: z.enum(["low", "medium", "high"]),
  sources: z.array(sourceSchema).min(1),
  created: z.string().regex(DATE_REGEX),
  last_validated: z.string().regex(DATE_REGEX),
  supersedes: z.array(z.string().regex(ID_REGEX)).optional(),
  archived: z.boolean().optional(),
  verified: z.boolean().optional(),
  tags: z.array(z.string().min(1)).optional(),
  schema_version: z.number().optional(),
};

const decisionSchema = z
  .object({
    ...baseFrontmatterShape,
    decision: z.string().min(1),
    rationale: z.string().min(1),
    outcome: z.string().min(1),
    alternatives: z.array(z.string()).optional(),
    affects: z.array(z.string()).optional(),
  })
  .passthrough();

const patternSchema = z
  .object({
    ...baseFrontmatterShape,
    intent: z.string().min(1),
    applies_when: z.array(z.string()).min(1),
    example_ref: z.string().optional(),
  })
  .passthrough();

const gotchaSchema = z
  .object({
    ...baseFrontmatterShape,
    symptom: z.string().min(1),
    resolution: z.string().min(1),
    error_signature: z.string().optional(),
    affects: z.array(z.string()).optional(),
    resolved_at: z.string().optional(),
  })
  .passthrough();

const conventionSchema = z
  .object({
    ...baseFrontmatterShape,
    rule: z.string().min(1),
    enforcement: z.enum(["manual", "lint", "ci", "hook"]),
    scope: z.array(z.string()).optional(),
  })
  .passthrough();

function schemaForType(type: KnowledgeType): z.ZodTypeAny {
  switch (type) {
    case "decision":
      return decisionSchema;
    case "pattern":
      return patternSchema;
    case "gotcha":
      return gotchaSchema;
    case "convention":
      return conventionSchema;
  }
}

export interface LoaderResult {
  entries: KnowledgeEntry[];
  warnings: string[];
}

export interface LoadOptions {
  /** When provided, called with each non-fatal warning. Defaults to console.warn. */
  onWarn?: (msg: string) => void;
}

export async function loadKnowledge(
  root: string,
  opts: LoadOptions = {},
): Promise<KnowledgeEntry[]> {
  const result = await loadKnowledgeWithWarnings(root, opts);
  return result.entries;
}

export async function loadKnowledgeWithWarnings(
  root: string,
  opts: LoadOptions = {},
): Promise<LoaderResult> {
  const warn = opts.onWarn ?? ((m: string) => console.warn(`[apex-recall] ${m}`));
  const knowledgeDir = path.join(root, ".apex", "knowledge");
  const entries: KnowledgeEntry[] = [];
  const warnings: string[] = [];

  for (const { dir, type } of KNOWLEDGE_DIRS) {
    const fullDir = path.join(knowledgeDir, dir);
    let files: string[];
    try {
      files = await fs.readdir(fullDir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      if (f.startsWith("_")) continue;
      const filePath = path.join(fullDir, f);
      const stem = f.slice(0, -3);
      try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = matter(raw, matterOptions);
        const fmRaw = parsed.data as Record<string, unknown>;
        if (!fmRaw || typeof fmRaw !== "object") {
          const msg = `${filePath}: missing frontmatter`;
          warn(msg);
          warnings.push(msg);
          continue;
        }
        if (fmRaw["type"] !== type) {
          const msg = `${filePath}: type mismatch (expected ${type}, got ${String(fmRaw["type"])})`;
          warn(msg);
          warnings.push(msg);
          continue;
        }
        if (fmRaw["id"] !== stem) {
          const msg = `${filePath}: id (${String(fmRaw["id"])}) does not match filename`;
          warn(msg);
          warnings.push(msg);
          continue;
        }
        const validated = schemaForType(type).safeParse(fmRaw);
        if (!validated.success) {
          const msg = `${filePath}: invalid frontmatter: ${validated.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`;
          warn(msg);
          warnings.push(msg);
          continue;
        }
        const fm = validated.data as KnowledgeEntry["frontmatter"] & {
          last_validated: string;
          created: string;
        };
        if (fm.last_validated < fm.created) {
          const msg = `${filePath}: last_validated (${fm.last_validated}) precedes created (${fm.created})`;
          warn(msg);
          warnings.push(msg);
          continue;
        }
        entries.push({
          frontmatter: fm,
          body: parsed.content.trim(),
          path: path.relative(root, filePath),
        });
      } catch (err) {
        const msg = `${filePath}: read/parse error: ${(err as Error).message}`;
        warn(msg);
        warnings.push(msg);
      }
    }
  }
  return { entries, warnings };
}
