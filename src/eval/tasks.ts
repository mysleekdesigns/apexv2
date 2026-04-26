import path from "node:path";
import fs from "node:fs/promises";
import matter from "gray-matter";
import yaml from "yaml";
import { z } from "zod";
import { templatesDir } from "../util/paths.js";
import type { EvalStack, EvalTask, EvalTaskFrontmatter } from "./types.js";

const SUPPORTED_STACKS: EvalStack[] = ["node-typescript", "python", "nextjs"];

const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

const ID_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const predicateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("file_exists"), ref: z.string().min(1) }),
  z.object({
    kind: z.literal("contains_string"),
    ref: z.string().min(1),
    value: z.string().min(1),
  }),
  z.object({
    kind: z.literal("regex_match"),
    ref: z.string().min(1),
    pattern: z.string().min(1),
    flags: z.string().optional(),
  }),
  z.object({
    kind: z.literal("command_exits_zero"),
    cmd: z.string().min(1),
    cwd: z.string().optional(),
    timeout_ms: z.number().int().positive().optional(),
  }),
  z.object({
    kind: z.literal("custom_predicate"),
    cmd: z.string().min(1),
    cwd: z.string().optional(),
    timeout_ms: z.number().int().positive().optional(),
  }),
]);

const frontmatterSchema = z.object({
  id: z.string().regex(ID_REGEX).max(64),
  stack: z.enum(["node-typescript", "python", "nextjs"]),
  kind: z.enum(["synthetic", "replay"]),
  title: z.string().min(1).max(200),
  starting_commit: z.string().nullable().optional(),
  prompts: z.array(z.string().min(1)).min(1),
  success_predicates: z.array(predicateSchema).min(1),
  source_episode: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export interface LoadTasksOptions {
  /** Filter to a single stack. If omitted, loads all stacks. */
  stack?: EvalStack;
  /** Override the directory containing `<stack>/<id>.md` fixtures. */
  tasksDir?: string;
  /** Custom warn channel. */
  onWarn?: (msg: string) => void;
}

function defaultTasksDir(): string {
  return path.join(templatesDir(), ".apex", "eval");
}

async function loadTaskFile(file: string): Promise<EvalTask | null> {
  const raw = await fs.readFile(file, "utf8");
  const parsed = matter(raw, matterOptions);
  const fmRaw = parsed.data as Record<string, unknown>;
  const validated = frontmatterSchema.safeParse(fmRaw);
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`${file}: invalid frontmatter: ${issues}`);
  }
  const fm = validated.data as EvalTaskFrontmatter;
  const stem = path.basename(file, ".md");
  if (fm.id !== stem) {
    throw new Error(`${file}: id (${fm.id}) does not match filename`);
  }
  return {
    frontmatter: fm,
    body: parsed.content.trim(),
    path: file,
  };
}

export async function loadSyntheticTasks(opts: LoadTasksOptions = {}): Promise<EvalTask[]> {
  const warn = opts.onWarn ?? ((m: string) => process.stderr.write(`[apex-eval] ${m}\n`));
  const root = opts.tasksDir ?? defaultTasksDir();
  const stacks = opts.stack ? [opts.stack] : SUPPORTED_STACKS;
  const out: EvalTask[] = [];
  for (const stack of stacks) {
    const dir = path.join(root, stack);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (!f.endsWith(".md")) continue;
      if (f.startsWith("_")) continue;
      const filePath = path.join(dir, f);
      try {
        const task = await loadTaskFile(filePath);
        if (task) out.push(task);
      } catch (err) {
        warn((err as Error).message);
      }
    }
  }
  return out.sort((a, b) => a.frontmatter.id.localeCompare(b.frontmatter.id));
}

export const __test__ = {
  frontmatterSchema,
  predicateSchema,
  loadTaskFile,
  defaultTasksDir,
};
