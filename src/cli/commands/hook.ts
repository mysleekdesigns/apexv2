// `apex hook <event>` — entry point invoked by the .claude/hooks/*.sh scripts.
//
// Reads the Claude Code hook payload from stdin (per specs/compatibility.md
// §"Hook event subscription"), routes to the appropriate episode-writer call,
// and exits 0 even on internal error (a hook MUST never block Claude Code).
//
// Logical events handled:
//   session-start, prompt-submit, post-tool, post-tool-failure,
//   pre-compact, session-end
//
// Wired by templates/claude/settings.json.tmpl. Bash scripts feed stdin as-is.

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Command } from "commander";
import { z } from "zod";

import {
  appendCorrection,
  appendEdit,
  appendFailure,
  appendPrompt,
  appendRetrieval,
  appendTool,
  endEpisode,
  readCurrentEpisode,
  readMeta,
  startEpisode,
  writeCurrentEpisode,
  writeSnapshot,
} from "../../episode/writer.js";
import { newEpisodeId } from "../../episode/id.js";
import type { EpisodeMeta } from "../../types/shared.js";

// ---------- helpers -----------------------------------------------------------

function projectRoot(): string {
  return process.env["CLAUDE_PROJECT_DIR"] ?? process.cwd();
}

function nowIso(): string {
  return new Date().toISOString();
}

function safeStr(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (v == null) return fallback;
  try {
    return String(v);
  } catch {
    return fallback;
  }
}

function logHookError(root: string, event: string, err: unknown): void {
  try {
    const dir = path.join(root, ".apex", "episodes");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, ".hook-errors.log");
    const line = JSON.stringify({
      ts: nowIso(),
      event,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    fs.appendFileSync(file, line + "\n", "utf8");
  } catch {
    // truly non-blocking
  }
}

async function readStdin(): Promise<string> {
  // If stdin is a TTY (interactive run with no piped input), return immediately.
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonLoose(s: string): Record<string, unknown> {
  if (!s.trim()) return {};
  try {
    const v = JSON.parse(s) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function pick(o: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in o && o[k] !== undefined && o[k] !== null) return o[k];
  }
  return undefined;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------- correction detection ---------------------------------------------

// specs/episode-schema.md §"Lifecycle" item 6.
const CORRECTION_REGEX = /^(no\b|nope\b|don't\b|stop\b|actually\b|use .* instead)/i;

function isCorrection(prompt: string): boolean {
  return CORRECTION_REGEX.test(prompt.trim());
}

// ---------- confirmation detection -------------------------------------------

// Conservative list of short leading affirmations; prefer false negatives over
// false positives — a spurious confirmation row degrades curator confidence
// calibration more than a missed one. Empty / whitespace-only strings are
// excluded by the \S requirement implicit in each alternative.
const CONFIRMATION_REGEX =
  /^(yes\b|yep\b|yeah\b|exactly\b|perfect\b|that's right\b|that's correct\b|that's it\b|right\b|correct\b|do that\b|go ahead\b|ship it\b|looks good\b|lgtm\b|👍)/i;

function isConfirmation(prompt: string): boolean {
  const t = prompt.trim();
  return t.length > 0 && CONFIRMATION_REGEX.test(t);
}

// ---------- thumbs detection -------------------------------------------------

// Matches /apex-thumbs-up <id> or /apex-thumbs-down <id> where id is a
// kebab-style alphanumeric token (e.g. "gh-pnpm-not-npm").
const THUMBS_REGEX =
  /^\/apex-thumbs-(up|down)\s+([a-z0-9]+(?:-[a-z0-9]+)*)$/i;

function isThumbs(
  prompt: string,
): { kind: "thumbs_up" | "thumbs_down"; entry_id: string } | null {
  const m = THUMBS_REGEX.exec(prompt.trim());
  if (!m) return null;
  const polarity = m[1]!.toLowerCase();
  const kind = polarity === "up" ? "thumbs_up" : "thumbs_down";
  return { kind, entry_id: m[2]! };
}

// ---------- per-event handlers ------------------------------------------------

const SessionStartPayload = z
  .object({
    session_id: z.string().optional(),
    started_at: z.string().optional(),
    model: z.string().optional(),
    claude_code_version: z.string().optional(),
    repo_head_sha: z.string().optional(),
    repo_branch: z.string().optional(),
    cwd: z.string().optional(),
  })
  .passthrough();

function handleSessionStart(
  root: string,
  payload: Record<string, unknown>,
): void {
  const parsed = SessionStartPayload.parse(payload);
  const episodeId = newEpisodeId(new Date());
  const meta: EpisodeMeta = {
    schema_version: 1,
    episode_id: episodeId,
    session_id: parsed.session_id ?? randomUUID(),
    started_at: parsed.started_at ?? nowIso(),
    ended_at: null,
    model: parsed.model ?? "unknown",
    claude_code_version: parsed.claude_code_version ?? "unknown",
    repo_head_sha: parsed.repo_head_sha ?? "0000000",
    repo_branch: parsed.repo_branch ?? null,
    cwd: parsed.cwd ?? root,
    hooks_fired_count: {
      session_start: 1,
      user_prompt_submit: 0,
      post_tool_use: 0,
      post_tool_use_failure: 0,
      pre_compact: 0,
      session_end: 0,
    },
  };
  startEpisode(root, meta);
  writeCurrentEpisode(root, episodeId);
  // SessionStart hooks may emit text on stdout that Claude Code injects into
  // context. Phase 1.4 (recall skill) populates this; for now, no-op.
  process.stdout.write(`APEX episode ${episodeId} started.\n`);
}

const UserPromptSubmitPayload = z
  .object({
    session_id: z.string().optional(),
    ts: z.string().optional(),
    turn: z.number().int().nonnegative().optional(),
    prompt: z.string().optional(),
    attached_files: z.array(z.string()).optional(),
  })
  .passthrough();

function handlePromptSubmit(
  root: string,
  episodeId: string,
  payload: Record<string, unknown>,
): void {
  const p = UserPromptSubmitPayload.parse(payload);
  const prompt = p.prompt ?? safeStr(pick(payload, "user_prompt", "text"));
  const turn = p.turn ?? 0;
  const ts = p.ts ?? nowIso();

  appendPrompt(root, episodeId, {
    schema_version: 1,
    ts,
    turn,
    prompt,
    prompt_hash: sha256(prompt),
    attached_files: p.attached_files,
  });

  // Priority: thumbs > correction > confirmation > (no row).
  // Exactly one row is written per prompt.
  const thumbs = isThumbs(prompt);
  if (thumbs) {
    appendCorrection(root, episodeId, {
      schema_version: 1,
      ts,
      turn,
      kind: thumbs.kind,
      evidence_ref: `prompts.jsonl#turn=${turn}`,
      target_entry_id: thumbs.entry_id,
      user_text: prompt,
      claude_action_summary: "",
    });
  } else if (isCorrection(prompt)) {
    appendCorrection(root, episodeId, {
      schema_version: 1,
      ts,
      turn,
      kind: "correction",
      evidence_ref: `prompts.jsonl#turn=${turn}`,
      target_entry_id: null,
      user_text: prompt,
      claude_action_summary: "",
    });
  } else if (isConfirmation(prompt)) {
    appendCorrection(root, episodeId, {
      schema_version: 1,
      ts,
      turn,
      kind: "confirmation",
      evidence_ref: `prompts.jsonl#turn=${turn}`,
      target_entry_id: null,
      user_text: prompt,
      claude_action_summary: "",
    });
  }
}

const PostToolPayload = z
  .object({
    session_id: z.string().optional(),
    ts: z.string().optional(),
    turn: z.number().int().nonnegative().optional(),
    tool_call_id: z.string().optional(),
    tool_name: z.string().optional(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
    output_excerpt: z.string().optional(),
    output_size_bytes: z.number().int().nonnegative().optional(),
    exit_code: z.number().int().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    error: z.union([z.string(), z.null()]).optional(),
    files_touched: z.array(z.string()).optional(),
  })
  .passthrough();

const OUTPUT_EXCERPT_BYTES = 2 * 1024;

function handlePostTool(
  root: string,
  episodeId: string,
  payload: Record<string, unknown>,
): void {
  const p = PostToolPayload.parse(payload);
  const ts = p.ts ?? nowIso();
  const turn = p.turn ?? 0;
  const toolCallId = p.tool_call_id ?? safeStr(pick(payload, "id"), "unknown");
  const toolName = p.tool_name ?? safeStr(pick(payload, "toolName", "name"));
  const exitCode = p.exit_code ?? 0;
  const input =
    p.input && typeof p.input === "object"
      ? (p.input as Record<string, unknown>)
      : undefined;

  // Derive output_excerpt + size when only `output` is present.
  let outputExcerpt = p.output_excerpt;
  let outputSize = p.output_size_bytes;
  if (outputExcerpt === undefined && p.output !== undefined) {
    const outStr =
      typeof p.output === "string" ? p.output : JSON.stringify(p.output);
    outputSize = outputSize ?? Buffer.byteLength(outStr, "utf8");
    outputExcerpt = outStr.slice(0, OUTPUT_EXCERPT_BYTES);
  }

  appendTool(root, episodeId, {
    schema_version: 1,
    ts,
    turn,
    tool_call_id: toolCallId,
    tool_name: toolName,
    input,
    input_hash: input ? sha256(JSON.stringify(input)) : undefined,
    output_excerpt: outputExcerpt,
    output_size_bytes: outputSize,
    exit_code: exitCode,
    duration_ms: p.duration_ms,
    error: p.error ?? null,
    files_touched: p.files_touched,
  });

  // Mirror failures into failures.jsonl per episode-schema.md §Lifecycle 3.
  if (exitCode !== 0 || (p.error !== null && p.error !== undefined)) {
    const errStr = safeStr(p.error, `tool ${toolName} exited ${exitCode}`);
    appendFailure(root, episodeId, {
      schema_version: 1,
      ts,
      turn,
      tool_call_id: toolCallId,
      tool_name: toolName,
      exit_code: exitCode,
      error: errStr,
      error_signature: errStr.split("\n", 1)[0]?.slice(0, 120) ?? null,
      stderr_excerpt: outputExcerpt ?? null,
    });
  }

  // Edits → edits.jsonl on success.
  if (
    exitCode === 0 &&
    (toolName === "Edit" || toolName === "Write" || toolName === "NotebookEdit")
  ) {
    const filePath =
      (input?.["file_path"] as string | undefined) ??
      (input?.["path"] as string | undefined) ??
      (Array.isArray(p.files_touched) ? p.files_touched[0] : undefined);
    if (filePath) {
      appendEdit(root, episodeId, {
        schema_version: 1,
        ts,
        turn,
        tool_call_id: toolCallId,
        tool: toolName as "Edit" | "Write" | "NotebookEdit",
        path: filePath,
        added: 0,
        removed: 0,
        is_new_file: toolName === "Write",
      });
    }
  }
}

const PostToolFailurePayload = z
  .object({
    session_id: z.string().optional(),
    ts: z.string().optional(),
    turn: z.number().int().nonnegative().optional(),
    tool_call_id: z.string().optional(),
    tool_name: z.string().optional(),
    error: z.string().optional(),
    exit_code: z.number().int().optional(),
    stderr: z.string().optional(),
  })
  .passthrough();

function handlePostToolFailure(
  root: string,
  episodeId: string,
  payload: Record<string, unknown>,
): void {
  const p = PostToolFailurePayload.parse(payload);
  // PostToolUseFailure may double-fire alongside PostToolUse; spec §Lifecycle
  // item 4 requires idempotency by tool_call_id. We approximate by appending
  // a failure row keyed with the tool_call_id; downstream readers (reflector,
  // eval harness) dedupe by id.
  const ts = p.ts ?? nowIso();
  const turn = p.turn ?? 0;
  const toolCallId = p.tool_call_id ?? "unknown";
  const errStr = p.error ?? "unknown error";
  appendFailure(root, episodeId, {
    schema_version: 1,
    ts,
    turn,
    tool_call_id: toolCallId,
    tool_name: p.tool_name ?? "unknown",
    exit_code: p.exit_code,
    error: errStr,
    error_signature: errStr.split("\n", 1)[0]?.slice(0, 120) ?? null,
    stderr_excerpt: p.stderr ?? null,
  });
}

const PreCompactPayload = z
  .object({
    session_id: z.string().optional(),
    ts: z.string().optional(),
    turn: z.number().int().nonnegative().optional(),
    todos: z
      .array(
        z.object({
          content: z.string(),
          status: z.enum(["pending", "in_progress", "completed"]),
        }),
      )
      .optional(),
    open_files: z.array(z.string()).optional(),
    recent_messages: z.array(z.string()).optional(),
  })
  .passthrough();

function handlePreCompact(
  root: string,
  episodeId: string,
  payload: Record<string, unknown>,
): void {
  const p = PreCompactPayload.parse(payload);
  writeSnapshot(root, episodeId, {
    schema_version: 1,
    ts: p.ts ?? nowIso(),
    turn_at_snapshot: p.turn ?? 0,
    todos: p.todos,
    open_files: p.open_files,
    recent_decisions: p.recent_messages,
  });
}

const SessionEndPayload = z
  .object({
    session_id: z.string().optional(),
    ts: z.string().optional(),
    ended_at: z.string().optional(),
    hooks_fired_count: z
      .object({
        session_start: z.number().int().optional(),
        user_prompt_submit: z.number().int().optional(),
        post_tool_use: z.number().int().optional(),
        post_tool_use_failure: z.number().int().optional(),
        pre_compact: z.number().int().optional(),
        session_end: z.number().int().optional(),
      })
      .optional(),
  })
  .passthrough();

function handleSessionEnd(
  root: string,
  episodeId: string,
  payload: Record<string, unknown>,
): void {
  const p = SessionEndPayload.parse(payload);
  let meta: EpisodeMeta;
  try {
    meta = readMeta(root, episodeId);
  } catch {
    // meta.json was lost — synthesise a minimal one from the closing payload.
    meta = {
      schema_version: 1,
      episode_id: episodeId,
      session_id: p.session_id ?? "unknown",
      started_at: nowIso(),
      ended_at: null,
      model: "unknown",
      claude_code_version: "unknown",
      repo_head_sha: "0000000",
      repo_branch: null,
      cwd: root,
      hooks_fired_count: {
        session_start: 0,
        user_prompt_submit: 0,
        post_tool_use: 0,
        post_tool_use_failure: 0,
        pre_compact: 0,
        session_end: 0,
      },
    };
  }
  meta.ended_at = p.ended_at ?? nowIso();
  if (p.hooks_fired_count) {
    meta.hooks_fired_count = {
      ...meta.hooks_fired_count,
      ...p.hooks_fired_count,
    };
  }
  meta.hooks_fired_count.session_end =
    (meta.hooks_fired_count.session_end ?? 0) + 1;
  endEpisode(root, episodeId, meta);
}

// ---------- routing -----------------------------------------------------------

const EVENTS = [
  "session-start",
  "prompt-submit",
  "post-tool",
  "post-tool-failure",
  "pre-compact",
  "session-end",
] as const;

type Event = (typeof EVENTS)[number];

function isEvent(e: string): e is Event {
  return (EVENTS as readonly string[]).includes(e);
}

async function runHook(event: Event): Promise<void> {
  const root = projectRoot();
  let stdin = "";
  try {
    stdin = await readStdin();
  } catch (err) {
    logHookError(root, event, err);
    return;
  }
  const payload = parseJsonLoose(stdin);

  try {
    if (event === "session-start") {
      handleSessionStart(root, payload);
      return;
    }
    // All other events need a current episode id.
    let episodeId =
      process.env["APEX_EPISODE_ID"] ?? readCurrentEpisode(root) ?? "";
    if (!episodeId) {
      // Recover by starting an episode now — better to capture *something*
      // than to drop the event silently.
      const fakeMeta: EpisodeMeta = {
        schema_version: 1,
        episode_id: newEpisodeId(new Date()),
        session_id: safeStr(pick(payload, "session_id"), "recovered"),
        started_at: nowIso(),
        ended_at: null,
        model: "unknown",
        claude_code_version: "unknown",
        repo_head_sha: "0000000",
        repo_branch: null,
        cwd: root,
        hooks_fired_count: {
          session_start: 0,
          user_prompt_submit: 0,
          post_tool_use: 0,
          post_tool_use_failure: 0,
          pre_compact: 0,
          session_end: 0,
        },
      };
      startEpisode(root, fakeMeta);
      writeCurrentEpisode(root, fakeMeta.episode_id);
      episodeId = fakeMeta.episode_id;
    }
    switch (event) {
      case "prompt-submit":
        handlePromptSubmit(root, episodeId, payload);
        break;
      case "post-tool":
        handlePostTool(root, episodeId, payload);
        break;
      case "post-tool-failure":
        handlePostToolFailure(root, episodeId, payload);
        break;
      case "pre-compact":
        handlePreCompact(root, episodeId, payload);
        break;
      case "session-end":
        handleSessionEnd(root, episodeId, payload);
        break;
    }
  } catch (err) {
    logHookError(root, event, err);
  }
  // Never throw — hooks must exit 0 even on internal failure.
}

/** Register `apex hook <event>` on the supplied commander program. */
export function registerHookCommand(program: Command): Command {
  return program
    .command("hook <event>")
    .description("Internal: route a Claude Code hook event to APEX capture.")
    .action(async (event: string) => {
      if (!isEvent(event)) {
        // Unknown event: log + exit 0.
        logHookError(
          projectRoot(),
          event,
          new Error(`unknown hook event: ${event}`),
        );
        return;
      }
      await runHook(event);
    });
}

/** Direct-call entry useful for tests. */
export async function runHookForTest(
  event: Event,
  stdinJson: string,
): Promise<void> {
  const root = projectRoot();
  const payload = parseJsonLoose(stdinJson);
  try {
    if (event === "session-start") {
      handleSessionStart(root, payload);
      return;
    }
    let episodeId =
      process.env["APEX_EPISODE_ID"] ?? readCurrentEpisode(root) ?? "";
    if (!episodeId) {
      throw new Error("no current episode for non-session-start event");
    }
    switch (event) {
      case "prompt-submit":
        handlePromptSubmit(root, episodeId, payload);
        break;
      case "post-tool":
        handlePostTool(root, episodeId, payload);
        break;
      case "post-tool-failure":
        handlePostToolFailure(root, episodeId, payload);
        break;
      case "pre-compact":
        handlePreCompact(root, episodeId, payload);
        break;
      case "session-end":
        handleSessionEnd(root, episodeId, payload);
        break;
    }
  } catch (err) {
    logHookError(root, event, err);
    throw err;
  }
}

export {
  CORRECTION_REGEX,
  isCorrection,
  CONFIRMATION_REGEX,
  isConfirmation,
  THUMBS_REGEX,
  isThumbs,
};
