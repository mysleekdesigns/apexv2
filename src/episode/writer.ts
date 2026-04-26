// Episode-file writer. Implements specs/episode-schema.md.
//
// All writes pass through the redactor (specs/redactor-design.md §1.2).
// JSONL files are append-only; meta.json is rewritten on session end.
//
// File layout (per episode-id):
//   .apex/episodes/<id>/meta.json
//   .apex/episodes/<id>/prompts.jsonl
//   .apex/episodes/<id>/tools.jsonl
//   .apex/episodes/<id>/failures.jsonl
//   .apex/episodes/<id>/corrections.jsonl
//   .apex/episodes/<id>/edits.jsonl
//   .apex/episodes/<id>/retrievals.jsonl
//   .apex/episodes/<id>/snapshots/pre-compact-<n>.json
//
// Hooks are racing each other in independent processes; appendFile is the
// only safe write primitive. We do NOT batch or buffer.

import fs from "node:fs";
import path from "node:path";

import type { EpisodeMeta } from "../types/shared.js";
import { redact } from "../redactor/index.js";
import { isEpisodeId } from "./id.js";

// ---------- types: per spec ---------------------------------------------------

export interface PromptLine {
  schema_version: 1;
  ts: string;
  turn: number;
  prompt: string;
  prompt_hash?: string;
  attached_files?: string[];
  injected_knowledge_ids?: string[];
}

export interface ToolLine {
  schema_version: 1;
  ts: string;
  turn: number;
  tool_call_id: string;
  tool_name: string;
  input?: Record<string, unknown>;
  input_hash?: string;
  output_excerpt?: string;
  output_size_bytes?: number;
  exit_code: number;
  duration_ms?: number;
  error?: string | null;
  files_touched?: string[];
}

export interface FailureLine {
  schema_version: 1;
  ts: string;
  turn: number;
  tool_call_id: string;
  tool_name: string;
  exit_code?: number;
  error: string;
  error_signature?: string | null;
  stderr_excerpt?: string | null;
}

export interface CorrectionLine {
  schema_version: 1;
  ts: string;
  turn: number;
  kind: "correction" | "confirmation" | "thumbs_up" | "thumbs_down";
  evidence_ref: string;
  target_entry_id?: string | null;
  user_text?: string;
  claude_action_summary?: string;
}

export interface EditLine {
  schema_version: 1;
  ts: string;
  turn: number;
  tool_call_id?: string;
  tool: "Edit" | "Write" | "NotebookEdit";
  path: string;
  added: number;
  removed: number;
  is_new_file?: boolean;
}

export interface RetrievalLine {
  schema_version: 1;
  ts: string;
  turn: number;
  query?: string;
  entry_id: string;
  entry_type: "decision" | "pattern" | "gotcha" | "convention";
  rank: number;
  score: number;
  tier?: "fts" | "vector" | "hybrid" | "graph";
  surfaced: boolean;
  referenced?: boolean | null;
}

export interface SnapshotPayload {
  schema_version: 1;
  ts: string;
  turn_at_snapshot: number;
  todos?: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
  }>;
  open_files?: string[];
  recent_decisions?: string[];
}

// ---------- path helpers ------------------------------------------------------

function episodeDir(root: string, episodeId: string): string {
  if (!isEpisodeId(episodeId)) {
    throw new Error(`invalid episode id: ${episodeId}`);
  }
  return path.join(root, ".apex", "episodes", episodeId);
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function appendJsonl(file: string, line: object): void {
  ensureDir(path.dirname(file));
  const redacted = redact(line);
  fs.appendFileSync(file, JSON.stringify(redacted) + "\n", "utf8");
}

function writeJson(file: string, value: object): void {
  ensureDir(path.dirname(file));
  const redacted = redact(value);
  fs.writeFileSync(file, JSON.stringify(redacted, null, 2) + "\n", "utf8");
}

// ---------- public API --------------------------------------------------------

export function startEpisode(root: string, meta: EpisodeMeta): string {
  const dir = episodeDir(root, meta.episode_id);
  ensureDir(dir);
  ensureDir(path.join(dir, "snapshots"));
  writeJson(path.join(dir, "meta.json"), meta);
  return dir;
}

export function endEpisode(
  root: string,
  episodeId: string,
  finalMeta: EpisodeMeta,
): void {
  if (finalMeta.episode_id !== episodeId) {
    throw new Error(
      `endEpisode: meta.episode_id (${finalMeta.episode_id}) != arg (${episodeId})`,
    );
  }
  writeJson(path.join(episodeDir(root, episodeId), "meta.json"), finalMeta);
}

export function readMeta(root: string, episodeId: string): EpisodeMeta {
  const file = path.join(episodeDir(root, episodeId), "meta.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as EpisodeMeta;
}

export function appendPrompt(
  root: string,
  episodeId: string,
  line: PromptLine,
): void {
  appendJsonl(path.join(episodeDir(root, episodeId), "prompts.jsonl"), line);
}

export function appendTool(
  root: string,
  episodeId: string,
  line: ToolLine,
): void {
  appendJsonl(path.join(episodeDir(root, episodeId), "tools.jsonl"), line);
}

export function appendFailure(
  root: string,
  episodeId: string,
  line: FailureLine,
): void {
  appendJsonl(path.join(episodeDir(root, episodeId), "failures.jsonl"), line);
}

export function appendCorrection(
  root: string,
  episodeId: string,
  line: CorrectionLine,
): void {
  appendJsonl(
    path.join(episodeDir(root, episodeId), "corrections.jsonl"),
    line,
  );
}

export function appendEdit(
  root: string,
  episodeId: string,
  line: EditLine,
): void {
  appendJsonl(path.join(episodeDir(root, episodeId), "edits.jsonl"), line);
}

export function appendRetrieval(
  root: string,
  episodeId: string,
  line: RetrievalLine,
): void {
  appendJsonl(
    path.join(episodeDir(root, episodeId), "retrievals.jsonl"),
    line,
  );
}

export function writeSnapshot(
  root: string,
  episodeId: string,
  payload: SnapshotPayload,
): string {
  const dir = path.join(episodeDir(root, episodeId), "snapshots");
  ensureDir(dir);
  // Determine next n by counting existing pre-compact-*.json files.
  let n = 1;
  if (fs.existsSync(dir)) {
    const existing = fs
      .readdirSync(dir)
      .filter((f) => /^pre-compact-\d+\.json$/.test(f))
      .map((f) => parseInt(f.replace(/^pre-compact-(\d+)\.json$/, "$1"), 10))
      .filter((x) => Number.isFinite(x));
    if (existing.length > 0) n = Math.max(...existing) + 1;
  }
  const file = path.join(dir, `pre-compact-${n}.json`);
  writeJson(file, payload);
  return file;
}

// ---------- "current episode" pointer ----------------------------------------

/**
 * `.apex/episodes/.current` stores the active episode id so that downstream
 * hooks (which run in fresh shell processes) can find it without depending on
 * env var inheritance from SessionStart. SessionStart writes it; SessionEnd
 * may clear it.
 */
export function writeCurrentEpisode(root: string, episodeId: string): string {
  const dir = path.join(root, ".apex", "episodes");
  ensureDir(dir);
  const file = path.join(dir, ".current");
  fs.writeFileSync(file, episodeId + "\n", "utf8");
  return file;
}

export function readCurrentEpisode(root: string): string | null {
  const file = path.join(root, ".apex", "episodes", ".current");
  if (!fs.existsSync(file)) return null;
  const v = fs.readFileSync(file, "utf8").trim();
  return isEpisodeId(v) ? v : null;
}

export function clearCurrentEpisode(root: string): void {
  const file = path.join(root, ".apex", "episodes", ".current");
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
