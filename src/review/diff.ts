// Pure functions that render `apex review` output.
//
// `apex review` reads `.apex/proposed/*.md`, decides which proposals are
// eligible for auto-promotion (= will be moved to `.apex/knowledge/`) vs
// queued (= require human attention), and emits a PR-ready Markdown summary.
//
// This file owns the rendering only — file I/O and CLI glue live in
// src/review/cli.ts so the rendering is testable without a tmpdir.

import path from "node:path";
import fs from "node:fs/promises";
import matter from "gray-matter";
import yaml from "yaml";
import { findEligible } from "../promote/eligibility.js";
import type { EligibleProposal } from "../promote/eligibility.js";
import { loadConfig } from "../config/index.js";
import { stripProposedHeader } from "../promote/validate.js";
import { projectPaths } from "../util/paths.js";
import { lintEntries } from "./appliesTo.js";
import type { LintWarning } from "./appliesTo.js";
import type { KnowledgeType } from "../types/shared.js";

const matterOptions = {
  engines: {
    yaml: {
      parse: (s: string): object => (yaml.parse(s) ?? {}) as object,
      stringify: (o: object): string => yaml.stringify(o),
    },
  },
};

const TYPE_ORDER: KnowledgeType[] = ["decision", "pattern", "gotcha", "convention"];
const TYPE_LABEL: Record<KnowledgeType, string> = {
  decision: "Decisions",
  pattern: "Patterns",
  gotcha: "Gotchas",
  convention: "Conventions",
};

export interface ReviewProposalEntry {
  /** Absolute or repo-relative file path of the proposal (.apex/proposed/<id>.md). */
  proposalPath: string;
  id: string;
  type: KnowledgeType;
  title: string;
  applies_to: string;
  confidence: string;
  /** Whether the auto-merge pipeline would promote this proposal as-is. */
  eligible: boolean;
  /** When eligible === false: why it was queued. */
  reason?: string;
}

export interface ReviewModel {
  /** All proposals that were considered, in their original on-disk order. */
  proposals: ReviewProposalEntry[];
  /** Proposals that would be auto-promoted on `apex promote`. */
  promoted: ReviewProposalEntry[];
  /** Proposals queued for human attention. */
  queued: ReviewProposalEntry[];
  /** Lint warnings against `.apex/knowledge/`. Empty unless --lint requested. */
  lint: LintWarning[];
  /** When true, the rendering will include the lint section. */
  lintRequested: boolean;
}

export interface BuildModelOptions {
  /** Project root (must contain .apex/). Defaults to cwd. */
  root: string;
  /** Whether to scan .apex/knowledge/ for applies_to lint warnings. */
  lint?: boolean;
}

/**
 * Build a structured review model from the on-disk state of `<root>/.apex/`.
 * Pure orchestration over existing helpers — no rendering happens here.
 */
export async function buildReviewModel(opts: BuildModelOptions): Promise<ReviewModel> {
  const root = opts.root;
  const config = await loadConfig(root);
  const eligible = await findEligible(root, config);
  const proposals = await Promise.all(eligible.map((e) => toEntry(e, root)));

  const promoted = proposals.filter((p) => p.eligible);
  const queued = proposals.filter((p) => !p.eligible);

  let lint: LintWarning[] = [];
  if (opts.lint) {
    const knowledgeDir = projectPaths(root).knowledgeDir;
    lint = await lintEntries(knowledgeDir);
  }

  return {
    proposals,
    promoted,
    queued,
    lint,
    lintRequested: Boolean(opts.lint),
  };
}

async function toEntry(
  el: EligibleProposal,
  root: string,
): Promise<ReviewProposalEntry> {
  // findEligible already parses frontmatter when valid; when invalid we still
  // want a row in the diff, so re-read on the spot.
  let fm = el.frontmatter as Record<string, unknown>;
  let typeStr = typeof fm["type"] === "string" ? (fm["type"] as string) : "";
  let id = typeof fm["id"] === "string" ? (fm["id"] as string) : "";
  let title = typeof fm["title"] === "string" ? (fm["title"] as string) : "";
  let appliesTo = typeof fm["applies_to"] === "string" ? (fm["applies_to"] as string) : "";
  let confidence = typeof fm["confidence"] === "string" ? (fm["confidence"] as string) : "";

  if (!el.eligible || Object.keys(fm).length === 0) {
    try {
      const raw = await fs.readFile(el.proposalPath, "utf8");
      const stripped = stripProposedHeader(raw);
      const parsed = matter(stripped, matterOptions);
      fm = parsed.data as Record<string, unknown>;
      if (!id && typeof fm["id"] === "string") id = fm["id"] as string;
      if (!typeStr && typeof fm["type"] === "string") typeStr = fm["type"] as string;
      if (!title && typeof fm["title"] === "string") title = fm["title"] as string;
      if (!appliesTo && typeof fm["applies_to"] === "string") {
        appliesTo = fm["applies_to"] as string;
      }
      if (!confidence && typeof fm["confidence"] === "string") {
        confidence = fm["confidence"] as string;
      }
    } catch {
      // leave blanks — we still surface the row so the user knows it exists.
    }
  }

  if (!id) id = path.basename(el.proposalPath, ".md").replace(/^_+/, "");
  if (!typeStr) typeStr = "convention";
  const type = (TYPE_ORDER as readonly string[]).includes(typeStr)
    ? (typeStr as KnowledgeType)
    : "convention";

  const entry: ReviewProposalEntry = {
    proposalPath: path.relative(root, el.proposalPath) || el.proposalPath,
    id,
    type,
    title: title || "(no title)",
    applies_to: appliesTo || "(unset)",
    confidence: confidence || "(unset)",
    eligible: el.eligible,
  };
  if (!el.eligible && el.reason) {
    entry.reason = el.reason;
  }
  return entry;
}

/**
 * Render the review model as PR-ready Markdown. Stable, deterministic output —
 * snapshot-friendly. Keeps the body compact (≤ ~80 columns where possible).
 */
export function renderMarkdown(model: ReviewModel): string {
  const lines: string[] = [];
  const total = model.proposals.length;
  const nProm = model.promoted.length;
  const nQueued = model.queued.length;

  lines.push("# APEX knowledge review");
  lines.push("");
  if (total === 0) {
    lines.push("_No pending proposals in `.apex/proposed/`._");
    lines.push("");
  } else {
    lines.push(
      `**${total} proposal${total === 1 ? "" : "s"}** — ` +
        `${nProm} would be promoted, ${nQueued} queued for review.`,
    );
    lines.push("");
  }

  lines.push("## Summary");
  lines.push("");
  lines.push("| Status | Count |");
  lines.push("|---|---|");
  lines.push(`| Would promote | ${nProm} |`);
  lines.push(`| Queued | ${nQueued} |`);
  if (model.lintRequested) {
    lines.push(`| Lint warnings | ${model.lint.length} |`);
  }
  lines.push("");

  // Promoted section, grouped by type for readability.
  if (nProm > 0) {
    lines.push("## Would promote");
    lines.push("");
    for (const t of TYPE_ORDER) {
      const rows = model.promoted.filter((p) => p.type === t);
      if (rows.length === 0) continue;
      lines.push(`### ${TYPE_LABEL[t]} (${rows.length})`);
      lines.push("");
      lines.push("| id | title | applies_to | confidence | path |");
      lines.push("|---|---|---|---|---|");
      for (const r of rows) {
        lines.push(
          `| \`${r.id}\` | ${escapePipe(r.title)} | ${r.applies_to} | ${r.confidence} | \`${r.proposalPath}\` |`,
        );
      }
      lines.push("");
    }
  }

  // Queued section, grouped by type with the reason.
  if (nQueued > 0) {
    lines.push("## Queued for review");
    lines.push("");
    for (const t of TYPE_ORDER) {
      const rows = model.queued.filter((p) => p.type === t);
      if (rows.length === 0) continue;
      lines.push(`### ${TYPE_LABEL[t]} (${rows.length})`);
      lines.push("");
      lines.push("| id | title | applies_to | confidence | reason |");
      lines.push("|---|---|---|---|---|");
      for (const r of rows) {
        lines.push(
          `| \`${r.id}\` | ${escapePipe(r.title)} | ${r.applies_to} | ${r.confidence} | ${escapePipe(r.reason ?? "(no reason recorded)")} |`,
        );
      }
      lines.push("");
    }
  }

  if (model.lintRequested) {
    lines.push("## Lint");
    lines.push("");
    if (model.lint.length === 0) {
      lines.push("_No `applies_to` lint warnings — every entry is well-formed._");
      lines.push("");
    } else {
      lines.push("| path | id | kind | message |");
      lines.push("|---|---|---|---|");
      for (const w of model.lint) {
        lines.push(
          `| \`${w.path}\` | \`${w.id}\` | ${w.kind} | ${escapePipe(w.message)} |`,
        );
      }
      lines.push("");
    }
  }

  lines.push(
    "_Generated by `apex review`. Paste this into a PR description after running `apex promote`._",
  );
  lines.push("");
  return lines.join("\n");
}

/** Escape `|` so it survives a Markdown table. Newlines collapse to spaces. */
function escapePipe(s: string): string {
  return s.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

/** JSON shape returned when --json is passed. */
export interface ReviewJson {
  total: number;
  promoted: number;
  queued: number;
  proposals: ReviewProposalEntry[];
  lint: LintWarning[];
}

export function renderJson(model: ReviewModel): ReviewJson {
  return {
    total: model.proposals.length,
    promoted: model.promoted.length,
    queued: model.queued.length,
    proposals: model.proposals,
    lint: model.lint,
  };
}
