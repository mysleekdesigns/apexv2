import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { newEpisodeId } from "../../src/episode/id.js";
import type { EpisodeMeta } from "../../src/types/shared.js";

export const TODAY = new Date().toISOString().slice(0, 10);

export async function makeTempRoot(): Promise<string> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "apex-confidence-test-"));
  for (const sub of ["decisions", "patterns", "gotchas", "conventions"]) {
    await fs.mkdir(path.join(base, ".apex", "knowledge", sub), { recursive: true });
  }
  await fs.mkdir(path.join(base, ".apex", "episodes"), { recursive: true });
  return base;
}

export async function cleanupRoot(root: string): Promise<void> {
  await fs.rm(root, { recursive: true, force: true });
}

interface KnowledgeFixture {
  id: string;
  type: "convention" | "gotcha" | "pattern" | "decision";
  title: string;
  body?: string;
  confidence?: "low" | "medium" | "high";
  affects?: string[];
  tags?: string[];
}

export async function writeKnowledge(
  root: string,
  fx: KnowledgeFixture,
): Promise<string> {
  const dir = `${fx.type}s`;
  const created = "2026-01-01";
  const lines: string[] = [
    "---",
    `id: ${fx.id}`,
    `type: ${fx.type}`,
    `title: ${fx.title}`,
    "applies_to: all",
    `confidence: ${fx.confidence ?? "medium"}`,
    "sources:",
    "  - kind: manual",
    "    ref: manual/test",
    `created: ${created}`,
    `last_validated: ${TODAY}`,
  ];
  if (fx.affects && fx.affects.length > 0) {
    lines.push("affects:");
    for (const a of fx.affects) lines.push(`  - ${a}`);
  }
  if (fx.tags && fx.tags.length > 0) {
    lines.push(`tags: [${fx.tags.join(", ")}]`);
  }
  if (fx.type === "decision") {
    lines.push("decision: x", "rationale: y", "outcome: z");
  } else if (fx.type === "pattern") {
    lines.push("intent: do x", 'applies_when: ["always"]');
  } else if (fx.type === "gotcha") {
    lines.push("symptom: it breaks", "resolution: fix it");
  } else {
    lines.push("rule: use this", "enforcement: manual");
  }
  lines.push("---", "", fx.body ?? `Body for ${fx.id}.`, "");
  const filePath = path.join(root, ".apex", "knowledge", dir, `${fx.id}.md`);
  await fs.writeFile(filePath, lines.join("\n"), "utf8");
  return filePath;
}

export async function makeEpisode(
  root: string,
  opts: {
    failures?: Array<{
      turn: number;
      tool_name: string;
      error: string;
      error_signature?: string;
    }>;
    corrections?: Array<{
      turn: number;
      kind: "correction" | "confirmation" | "thumbs_up" | "thumbs_down";
      user_text?: string;
      target_entry_id?: string | null;
    }>;
    tools?: Array<{
      turn: number;
      tool_name: string;
      command?: string;
      file_path?: string;
      exit_code?: number;
    }>;
    retrievals?: Array<{
      turn: number;
      entry_id: string;
      entry_type: "decision" | "pattern" | "gotcha" | "convention";
    }>;
    /** Optional pre-computed id; otherwise auto-generated. */
    episodeId?: string;
  } = {},
): Promise<string> {
  const episodeId = opts.episodeId ?? newEpisodeId(new Date());
  const dir = path.join(root, ".apex", "episodes", episodeId);
  await fs.mkdir(dir, { recursive: true });

  const meta: EpisodeMeta = {
    schema_version: 1,
    episode_id: episodeId,
    session_id: "session-test",
    started_at: new Date().toISOString(),
    ended_at: null,
    model: "test",
    claude_code_version: "test",
    repo_head_sha: "0000000",
    repo_branch: null,
    cwd: root,
    hooks_fired_count: {
      session_start: 1,
      user_prompt_submit: 0,
      post_tool_use: 0,
      post_tool_use_failure: 0,
      pre_compact: 0,
      session_end: 0,
    },
  };
  await fs.writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify(meta, null, 2),
    "utf8",
  );

  const ts = new Date().toISOString();

  if (opts.failures) {
    const lines = opts.failures.map((f) =>
      JSON.stringify({
        schema_version: 1,
        ts,
        turn: f.turn,
        tool_call_id: `tc-${f.turn}`,
        tool_name: f.tool_name,
        exit_code: 1,
        error: f.error,
        error_signature: f.error_signature ?? null,
        stderr_excerpt: null,
      }),
    );
    await fs.writeFile(path.join(dir, "failures.jsonl"), lines.join("\n") + "\n", "utf8");
  }

  if (opts.corrections) {
    const lines = opts.corrections.map((c) =>
      JSON.stringify({
        schema_version: 1,
        ts,
        turn: c.turn,
        kind: c.kind,
        evidence_ref: `prompts.jsonl#turn=${c.turn}`,
        target_entry_id: c.target_entry_id ?? null,
        user_text: c.user_text ?? "",
        claude_action_summary: "",
      }),
    );
    await fs.writeFile(path.join(dir, "corrections.jsonl"), lines.join("\n") + "\n", "utf8");
  }

  if (opts.tools) {
    const lines = opts.tools.map((t) => {
      const input: Record<string, unknown> = {};
      if (t.command !== undefined) input["command"] = t.command;
      if (t.file_path !== undefined) input["file_path"] = t.file_path;
      return JSON.stringify({
        schema_version: 1,
        ts,
        turn: t.turn,
        tool_call_id: `tc-${t.turn}`,
        tool_name: t.tool_name,
        input,
        exit_code: t.exit_code ?? 0,
      });
    });
    await fs.writeFile(path.join(dir, "tools.jsonl"), lines.join("\n") + "\n", "utf8");
  }

  if (opts.retrievals) {
    const lines = opts.retrievals.map((r) =>
      JSON.stringify({
        schema_version: 1,
        ts,
        turn: r.turn,
        entry_id: r.entry_id,
        entry_type: r.entry_type,
        rank: 1,
        score: 1.0,
        tier: "fts",
        surfaced: true,
      }),
    );
    await fs.writeFile(path.join(dir, "retrievals.jsonl"), lines.join("\n") + "\n", "utf8");
  }

  return episodeId;
}

export async function readKnowledgeConfidence(
  root: string,
  type: "convention" | "gotcha" | "pattern" | "decision",
  id: string,
): Promise<{ confidence: string; last_validated: string }> {
  const file = path.join(root, ".apex", "knowledge", `${type}s`, `${id}.md`);
  const txt = await fs.readFile(file, "utf8");
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  const fm = m ? m[1]! : "";
  const conf = /confidence:\s*(\S+)/.exec(fm);
  const lv = /last_validated:\s*(\S+)/.exec(fm);
  return {
    confidence: conf ? conf[1]!.replace(/['"]/g, "") : "",
    last_validated: lv ? lv[1]!.replace(/['"]/g, "") : "",
  };
}
