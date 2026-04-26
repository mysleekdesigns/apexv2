import { z } from "zod";
import matter from "gray-matter";
import yaml from "yaml";
import type { KnowledgeType } from "../types/shared.js";

// Use the yaml package directly — same approach as recall/loader.ts to avoid
// gray-matter converting ISO dates to Date objects.
const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

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

export interface ValidationResult {
  valid: boolean;
  /** Parsed frontmatter data — only present when valid === true. */
  frontmatter?: Record<string, unknown>;
  /** Parsed markdown body — only present when valid === true. */
  body?: string;
  /** Human-readable error messages — only present when valid === false. */
  errors?: string[];
}

/**
 * Parse and validate the YAML frontmatter of a proposal .md file.
 * Mirrors the validation logic in src/recall/loader.ts so the same rules
 * apply at proposal time as at retrieval time.
 */
export function validateFrontmatter(
  raw: string,
  /** Optional file path, used only for richer error messages. */
  filePath?: string,
): ValidationResult {
  const loc = filePath ?? "<proposal>";

  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matter(raw, matterOptions);
  } catch (err) {
    return { valid: false, errors: [`${loc}: YAML parse error: ${(err as Error).message}`] };
  }

  const fmRaw = parsed.data as Record<string, unknown>;
  if (!fmRaw || typeof fmRaw !== "object" || Object.keys(fmRaw).length === 0) {
    return { valid: false, errors: [`${loc}: missing or empty frontmatter`] };
  }

  const typeVal = fmRaw["type"];
  const validTypes: KnowledgeType[] = ["decision", "pattern", "gotcha", "convention"];
  if (!validTypes.includes(typeVal as KnowledgeType)) {
    return {
      valid: false,
      errors: [
        `${loc}: invalid or missing 'type' field (got ${String(typeVal)}); must be one of ${validTypes.join(", ")}`,
      ],
    };
  }

  const type = typeVal as KnowledgeType;
  const schema = schemaForType(type);
  const result = schema.safeParse(fmRaw);

  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${loc}: ${i.path.join(".") || "<root>"}: ${i.message}`,
    );
    return { valid: false, errors: issues };
  }

  const fm = result.data as Record<string, unknown>;

  // last_validated must be >= created
  const created = fm["created"] as string;
  const lastValidated = fm["last_validated"] as string;
  if (lastValidated < created) {
    return {
      valid: false,
      errors: [
        `${loc}: last_validated (${lastValidated}) precedes created (${created})`,
      ],
    };
  }

  return {
    valid: true,
    frontmatter: fm,
    body: parsed.content.trim(),
  };
}

/**
 * Read a proposal file from disk and validate it.
 * This is the public API used by the promote pipeline.
 */
export async function validateProposal(proposalPath: string): Promise<ValidationResult> {
  const fs = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await fs.readFile(proposalPath, "utf8");
  } catch (err) {
    return {
      valid: false,
      errors: [`${proposalPath}: could not read file: ${(err as Error).message}`],
    };
  }

  // Strip the "<!-- PROPOSED — ... -->" header line before parsing, just as
  // move.ts does before writing to knowledge/. The header is not frontmatter.
  const stripped = stripProposedHeader(raw);
  return validateFrontmatter(stripped, proposalPath);
}

const PROPOSED_HEADER_RE = /^<!--\s*PROPOSED[^>]*-->\s*\n?/;

/** Remove the "<!-- PROPOSED — ... -->" comment line that the reflector/archaeologist prepends. */
export function stripProposedHeader(content: string): string {
  return content.replace(PROPOSED_HEADER_RE, "");
}
