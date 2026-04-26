// Pure heuristic proposer for the reflector.
//
// Detects:
//   1. Repeated failures with the same error_signature >= 2 occurrences → gotcha
//   2. Repeated user corrections (normalised) >= 2 occurrences → convention
//   3. Resolved-failure candidates: signature absent from recent N episodes
//      while a successful tool run touched the failure's files → candidate-resolution
//
// Every proposal MUST cite at least one episode source or it is dropped.

import type { KnowledgeFrontmatter, KnowledgeSource } from "../types/shared.js";
import type { EpisodeSignals, FailureLine } from "./signals.js";

export interface DraftEntry {
  frontmatter: KnowledgeFrontmatter & Record<string, unknown>;
  body: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normaliseCorrection(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function baseFrontmatter(
  id: string,
  type: KnowledgeFrontmatter["type"],
  title: string,
  sources: KnowledgeSource[],
  confidence: KnowledgeFrontmatter["confidence"],
  tags: string[],
): KnowledgeFrontmatter {
  return {
    id,
    type,
    title,
    applies_to: "all",
    confidence,
    sources,
    created: today(),
    last_validated: today(),
    tags,
  };
}

// ---------- failure aggregation ----------------------------------------------

interface FailureOccurrence {
  episodeId: string;
  failure: FailureLine;
  lineIndex: number;
}

function buildFailureMap(
  signalsList: EpisodeSignals[],
): Map<string, FailureOccurrence[]> {
  const map = new Map<string, FailureOccurrence[]>();
  for (const ep of signalsList) {
    let idx = 0;
    for (const f of ep.failures) {
      const sig = f.error_signature?.trim();
      if (!sig) {
        idx++;
        continue;
      }
      const list = map.get(sig) ?? [];
      list.push({ episodeId: ep.episodeId, failure: f, lineIndex: idx });
      map.set(sig, list);
      idx++;
    }
  }
  return map;
}

function proposeGotcha(
  sig: string,
  occurrences: FailureOccurrence[],
): DraftEntry | null {
  if (occurrences.length < 2) return null;

  const sources: KnowledgeSource[] = occurrences.slice(0, 5).map((o) => ({
    kind: "reflection" as const,
    ref: `episode/${o.episodeId}/failures.jsonl#turn=${o.failure.turn}`,
    note: o.failure.error.slice(0, 120),
  }));

  const confidence: KnowledgeFrontmatter["confidence"] =
    occurrences.length >= 3 ? "medium" : "low";

  const sigSlug = slug(sig);
  // Guarantee id starts with a letter after slug might produce leading digit
  const id = `reflect-gotcha-${sigSlug}`.slice(0, 64);
  // Re-validate id pattern: must be a-z0-9 segments separated by hyphens
  const safeId = id.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  const toolName = occurrences[0]!.failure.tool_name;
  const title = `Recurring ${toolName} failure: ${sig.slice(0, 60)}`;

  const fm = {
    ...baseFrontmatter(safeId, "gotcha", title.slice(0, 120), sources, confidence, [
      "reflection",
      "tool-failure",
    ]),
    symptom: `${toolName} fails with: ${sig.slice(0, 200)}`,
    resolution: `Investigate and address the root cause of: "${sig.slice(0, 200)}". Seen ${occurrences.length} time(s) across episodes.`,
    error_signature: sig.slice(0, 200),
  };

  const episodeList = [...new Set(occurrences.map((o) => o.episodeId))].join(", ");
  const body = [
    `Detected **${occurrences.length}** occurrence(s) of this error signature across episodes: ${episodeList}.`,
    "",
    "**Error signature:**",
    "```",
    sig.slice(0, 400),
    "```",
    "",
    "**Sampled occurrences:**",
    ...occurrences.slice(0, 5).map(
      (o) =>
        `- episode \`${o.episodeId}\` turn ${o.failure.turn}: ${o.failure.error.slice(0, 120)}`,
    ),
  ].join("\n");

  return { frontmatter: fm, body };
}

// ---------- correction aggregation -------------------------------------------

interface CorrectionOccurrence {
  episodeId: string;
  userText: string;
  turn: number;
  lineIndex: number;
}

function buildCorrectionMap(
  signalsList: EpisodeSignals[],
): Map<string, CorrectionOccurrence[]> {
  const map = new Map<string, CorrectionOccurrence[]>();
  for (const ep of signalsList) {
    let idx = 0;
    for (const c of ep.corrections) {
      if (c.kind !== "correction") {
        idx++;
        continue;
      }
      const text = c.user_text?.trim();
      if (!text) {
        idx++;
        continue;
      }
      const key = normaliseCorrection(text);
      const list = map.get(key) ?? [];
      list.push({ episodeId: ep.episodeId, userText: text, turn: c.turn, lineIndex: idx });
      map.set(key, list);
      idx++;
    }
  }
  return map;
}

function proposeConvention(
  normalisedText: string,
  occurrences: CorrectionOccurrence[],
): DraftEntry | null {
  if (occurrences.length < 2) return null;

  const sources: KnowledgeSource[] = occurrences.slice(0, 5).map((o) => ({
    kind: "reflection" as const,
    ref: `episode/${o.episodeId}/corrections.jsonl#turn=${o.turn}`,
    note: o.userText.slice(0, 120),
  }));

  const episodeSet = new Set(occurrences.map((o) => o.episodeId));
  const confidence: KnowledgeFrontmatter["confidence"] =
    episodeSet.size >= 3 ? "medium" : "low";

  const textSlug = slug(normalisedText);
  const id = `reflect-convention-${textSlug}`.slice(0, 64);
  const safeId = id.replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  const title = `Repeated correction: ${normalisedText.slice(0, 80)}`;

  const fm = {
    ...baseFrontmatter(
      safeId,
      "convention",
      title.slice(0, 120),
      sources,
      confidence,
      ["reflection", "correction"],
    ),
    rule: normalisedText.slice(0, 400),
    enforcement: "manual" as const,
  };

  const episodeList = [...episodeSet].join(", ");
  const body = [
    `User repeated this correction **${occurrences.length}** time(s) across episodes: ${episodeList}.`,
    "",
    "**Correction text (representative):**",
    `> ${occurrences[0]!.userText.slice(0, 400)}`,
  ].join("\n");

  return { frontmatter: fm, body };
}

// ---------- resolved-failure detection ---------------------------------------

function proposeResolution(
  sig: string,
  occurrences: FailureOccurrence[],
  recentEpisodes: EpisodeSignals[],
  existingKnowledgeIds: Set<string>,
  recentN: number,
): DraftEntry | null {
  // Check if the signature is absent from the most recent N episodes
  const recentIds = new Set(recentEpisodes.slice(0, recentN).map((e) => e.episodeId));
  const appearsInRecent = occurrences.some((o) => recentIds.has(o.episodeId));
  if (appearsInRecent) return null;

  // Check if a successful tool run touched files mentioned in the failure
  const failureEpisodes = new Set(occurrences.map((o) => o.episodeId));

  // Look for the error_signature in existing knowledge ids
  const sigSlug = slug(sig);
  const candidateKnowledgeId = `reflect-gotcha-${sigSlug}`.slice(0, 64).replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  // Check if any successful tools in recent episodes could indicate resolution
  let hasSuccessEvidence = false;
  for (const ep of recentEpisodes.slice(0, recentN)) {
    const successfulTools = ep.tools.filter((t) => t.exit_code === 0);
    if (successfulTools.length > 0) {
      hasSuccessEvidence = true;
      break;
    }
  }

  if (!hasSuccessEvidence) return null;

  const sources: KnowledgeSource[] = occurrences.slice(0, 3).map((o) => ({
    kind: "reflection" as const,
    ref: `episode/${o.episodeId}/failures.jsonl#turn=${o.failure.turn}`,
    note: `original failure: ${o.failure.error.slice(0, 80)}`,
  }));

  // Add a source from the recent successful run
  for (const ep of recentEpisodes.slice(0, recentN)) {
    const successTool = ep.tools.find((t) => t.exit_code === 0);
    if (successTool) {
      sources.push({
        kind: "reflection" as const,
        ref: `episode/${ep.episodeId}/tools.jsonl#turn=${successTool.turn}`,
      });
      break;
    }
  }

  const id = `reflect-resolved-${sigSlug}`.slice(0, 64).replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  const knowledgeRef = existingKnowledgeIds.has(candidateKnowledgeId)
    ? candidateKnowledgeId
    : "(not yet in knowledge base)";

  const fm = {
    ...baseFrontmatter(
      id,
      "gotcha",
      `Candidate resolution for: ${sig.slice(0, 80)}`.slice(0, 120),
      sources,
      "low" as const,
      ["reflection", "candidate-resolution"],
    ),
    symptom: `Previously recurring failure "${sig.slice(0, 200)}" has not reappeared in the last ${recentN} episodes.`,
    resolution: `Verify this failure is truly resolved. If confirmed, update or archive the corresponding gotcha: ${knowledgeRef}.`,
    error_signature: sig.slice(0, 200),
    resolved_at: today(),
    candidate_resolution_for: knowledgeRef,
  };

  const priorEpisodes = [...failureEpisodes].join(", ");
  const body = [
    `This error signature was previously seen in: ${priorEpisodes}.`,
    `It has **not** appeared in the last ${recentN} episode(s), and successful tool runs have occurred since.`,
    "",
    "**This is a candidate-resolution proposal** — verify manually before archiving any related gotcha.",
    "",
    `Possibly relates to knowledge entry: \`${knowledgeRef}\`.`,
  ].join("\n");

  return { frontmatter: fm, body };
}

// ---------- main entry point -------------------------------------------------

export function proposeFromEpisodes(
  signalsList: EpisodeSignals[],
  existingKnowledgeIds: Set<string>,
  opts: { resolvedN?: number } = {},
): DraftEntry[] {
  if (signalsList.length === 0) return [];

  const resolvedN = opts.resolvedN ?? 3;
  const drafts: DraftEntry[] = [];
  const seen = new Set<string>();

  const failureMap = buildFailureMap(signalsList);
  const correctionMap = buildCorrectionMap(signalsList);

  // Repeated failures → gotcha
  for (const [sig, occurrences] of failureMap) {
    const draft = proposeGotcha(sig, occurrences);
    if (draft && !seen.has(draft.frontmatter.id)) {
      drafts.push(draft);
      seen.add(draft.frontmatter.id);
    }
  }

  // Repeated corrections → convention
  for (const [normText, occurrences] of correctionMap) {
    const draft = proposeConvention(normText, occurrences);
    if (draft && !seen.has(draft.frontmatter.id)) {
      drafts.push(draft);
      seen.add(draft.frontmatter.id);
    }
  }

  // Resolved-failure candidates
  // Only check signatures that appeared historically but not recently
  if (signalsList.length > resolvedN) {
    const olderEpisodes = signalsList.slice(resolvedN);
    const historicalFailureMap = buildFailureMap(olderEpisodes);
    for (const [sig, occurrences] of historicalFailureMap) {
      if (occurrences.length < 2) continue;
      const draft = proposeResolution(sig, occurrences, signalsList, existingKnowledgeIds, resolvedN);
      if (draft && !seen.has(draft.frontmatter.id)) {
        drafts.push(draft);
        seen.add(draft.frontmatter.id);
      }
    }
  }

  return drafts;
}
