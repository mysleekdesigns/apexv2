import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { isEpisodeId } from "../episode/id.js";
import type { EpisodeMeta } from "../types/shared.js";
import type {
  EditLine,
  PromptLine,
  RetrievalLine,
  ToolLine,
  FailureLine,
  CorrectionLine,
} from "../episode/writer.js";
import type { EvalStack, EvalTask, SuccessPredicate } from "./types.js";

export interface EpisodeArtifacts {
  episodeId: string;
  meta: EpisodeMeta | null;
  prompts: PromptLine[];
  tools: ToolLine[];
  failures: FailureLine[];
  corrections: CorrectionLine[];
  edits: EditLine[];
  retrievals: RetrievalLine[];
}

async function readJsonl<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      /* skip */
    }
  }
  return out;
}

async function readMeta(file: string): Promise<EpisodeMeta | null> {
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text) as EpisodeMeta;
  } catch {
    return null;
  }
}

export async function readEpisode(
  episodeDir: string,
): Promise<EpisodeArtifacts> {
  const episodeId = path.basename(episodeDir);
  const meta = await readMeta(path.join(episodeDir, "meta.json"));
  const [prompts, tools, failures, corrections, edits, retrievals] =
    await Promise.all([
      readJsonl<PromptLine>(path.join(episodeDir, "prompts.jsonl")),
      readJsonl<ToolLine>(path.join(episodeDir, "tools.jsonl")),
      readJsonl<FailureLine>(path.join(episodeDir, "failures.jsonl")),
      readJsonl<CorrectionLine>(path.join(episodeDir, "corrections.jsonl")),
      readJsonl<EditLine>(path.join(episodeDir, "edits.jsonl")),
      readJsonl<RetrievalLine>(path.join(episodeDir, "retrievals.jsonl")),
    ]);
  return { episodeId, meta, prompts, tools, failures, corrections, edits, retrievals };
}

/**
 * Discover episode directories under `.apex/episodes/`. If `episodeGlob` is a
 * literal episode id we just resolve it. Otherwise we treat it as a substring
 * filter on the episode-id directory name. (We avoid pulling in a glob library
 * to honour the no-new-deps constraint.)
 */
export async function discoverEpisodes(
  root: string,
  episodeGlob?: string,
): Promise<string[]> {
  const baseDir = path.join(root, ".apex", "episodes");
  let entries: string[];
  try {
    entries = await fs.readdir(baseDir);
  } catch {
    return [];
  }
  const dirs: string[] = [];
  for (const name of entries) {
    if (!isEpisodeId(name)) continue;
    if (episodeGlob && !matchEpisodeGlob(name, episodeGlob)) continue;
    const full = path.join(baseDir, name);
    try {
      const st = await fs.stat(full);
      if (st.isDirectory()) dirs.push(full);
    } catch {
      /* skip */
    }
  }
  dirs.sort();
  return dirs;
}

export function matchEpisodeGlob(name: string, pattern: string): boolean {
  if (pattern === name) return true;
  // Translate a small glob (`*` and `?`) into a regex.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return re.test(name);
}

function inferStackFromTools(tools: ToolLine[]): EvalStack {
  // Heuristic: look at file extensions and Bash commands to pick a label.
  let py = 0;
  let nextjs = 0;
  let ts = 0;
  for (const t of tools) {
    const cmd = (t.input?.["command"] as string | undefined) ?? "";
    const filePath = (t.input?.["file_path"] as string | undefined) ?? "";
    const haystack = `${cmd} ${filePath} ${(t.files_touched ?? []).join(" ")}`;
    if (/\.py(\b|$)/.test(haystack) || /\bpytest\b|\bpip\b|pyproject\.toml/.test(haystack)) py++;
    if (/next\.config|app\/\w+\/page\.tsx|\bnext\b/.test(haystack)) nextjs++;
    if (/\.tsx?(\b|$)/.test(haystack) || /\bnpm|pnpm|yarn|tsc|vitest|jest\b/.test(haystack)) ts++;
  }
  if (nextjs > 0 && nextjs >= py && nextjs >= ts) return "nextjs";
  if (py > ts) return "python";
  return "node-typescript";
}

function uniqueFilesTouched(tools: ToolLine[]): string[] {
  const set = new Set<string>();
  for (const t of tools) {
    if (t.tool_name === "Edit" || t.tool_name === "Write" || t.tool_name === "NotebookEdit") {
      const fp = t.input?.["file_path"] as string | undefined;
      if (fp) set.add(fp);
    }
    for (const f of t.files_touched ?? []) set.add(f);
  }
  return Array.from(set);
}

/** Build an EvalTask descriptor from a captured episode. */
export function episodeToTask(artifacts: EpisodeArtifacts): EvalTask {
  const stack = inferStackFromTools(artifacts.tools);
  const prompts = artifacts.prompts.map((p) => p.prompt).filter((p): p is string => Boolean(p));
  const filesTouched = uniqueFilesTouched(artifacts.tools);
  // For replay tasks we generate file_exists predicates from edited files. If
  // there are no edits we fall back to a single tautological predicate so the
  // task remains scorable.
  const predicates: SuccessPredicate[] = filesTouched.length > 0
    ? filesTouched.slice(0, 8).map((f) => ({ kind: "file_exists", ref: f }))
    : [{ kind: "file_exists", ref: "." }];
  const id = `replay-${artifacts.episodeId}`;
  return {
    frontmatter: {
      id,
      stack,
      kind: "replay",
      title: `Replay of episode ${artifacts.episodeId}`,
      starting_commit: artifacts.meta?.repo_head_sha ?? null,
      prompts: prompts.length > 0 ? prompts : ["(no prompts captured)"],
      success_predicates: predicates,
      source_episode: artifacts.episodeId,
    },
    body: "",
    path: `<replay:${artifacts.episodeId}>`,
  };
}

/**
 * Strip retrieved-knowledge context from prompts. Used by `--without-apex` to
 * simulate the ablation: the harness counts only signals that would have been
 * present pre-APEX. We do not rerun Claude — this is a measurement engine.
 */
export function stripApexContext(artifacts: EpisodeArtifacts): EpisodeArtifacts {
  return {
    ...artifacts,
    retrievals: [],
    prompts: artifacts.prompts.map((p) => {
      const copy: PromptLine = { ...p };
      if (copy.injected_knowledge_ids) copy.injected_knowledge_ids = [];
      return copy;
    }),
  };
}

export function hashErrorSignature(err: FailureLine): string {
  const sig = err.error_signature ?? err.error;
  const normalized = (sig ?? "")
    .toLowerCase()
    .replace(/\b\d+\b/g, "N")
    .replace(/0x[0-9a-f]+/gi, "0xN")
    .replace(/\/[\w./-]+/g, "/PATH")
    .trim();
  return crypto
    .createHash("sha256")
    .update(`${err.tool_name}|${err.exit_code ?? ""}|${normalized}`)
    .digest("hex")
    .slice(0, 16);
}
