// proposer.ts — convert Candidate[] into DraftEntry-shaped proposals.
//
// Rules (per spec):
//   - Every proposal MUST cite at least one source ref (commit/<sha> or pr/<n>)
//   - Confidence: `low` for single-occurrence; `medium` only if reinforced by
//     ≥2 independent commits OR the primary commit touches a high-signal file
//     (CHANGELOG, ADR, docs/decisions/…)
//   - Never `high`
//   - Run the redactor on every text snippet that becomes a proposal body

import type { KnowledgeFrontmatter, KnowledgeSource } from "../types/shared.js";
import { redact } from "../redactor/index.js";
import type { Candidate } from "./extractor.js";

export interface DraftEntry {
  frontmatter: KnowledgeFrontmatter & Record<string, unknown>;
  body: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function safeId(raw: string): string {
  return raw
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
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

function computeConfidence(
  candidate: Candidate,
): KnowledgeFrontmatter["confidence"] {
  const totalRefs = 1 + candidate.corroboratingRefs.length;
  // medium if: ≥2 independent commit/pr sources OR the primary touches high-signal file
  if (totalRefs >= 2 || candidate.isHighSignal) return "medium";
  return "low";
}

function buildSources(candidate: Candidate): KnowledgeSource[] {
  const sources: KnowledgeSource[] = [];

  // Primary ref
  const primaryKind = candidate.primaryRef.startsWith("pr/") ? "pr" : "reflection";
  sources.push({ kind: primaryKind, ref: candidate.primaryRef });

  // Corroborating refs (up to 4 more)
  for (const ref of candidate.corroboratingRefs.slice(0, 4)) {
    const kind = ref.startsWith("pr/") ? "pr" : "reflection";
    sources.push({ kind, ref });
  }

  return sources;
}

// ---------------------------------------------------------------------------
// Proposal builders
// ---------------------------------------------------------------------------

function proposeGotcha(candidate: Candidate): DraftEntry {
  const titleSlug = slug(candidate.title);
  const id = safeId(`prmine-gotcha-${titleSlug}`);
  const confidence = computeConfidence(candidate);
  const sources = buildSources(candidate);

  const redactedTitle = redact(candidate.title).slice(0, 120);
  const redactedEvidence = candidate.evidence
    .slice(0, 5)
    .map((e) => ({ ...e, text: redact(e.text) }));

  const fm = {
    ...baseFrontmatter(id, "gotcha", redactedTitle, sources, confidence, [
      "pr-mining",
      "fix",
    ]),
    symptom: redact(
      `Commit/PR subject: "${candidate.title.slice(0, 200)}"`,
    ),
    resolution: redact(
      `Review the cited commit(s) for the root cause. Filed: ${candidate.primaryRef}.`,
    ),
    error_signature: redact(candidate.title.slice(0, 200)),
    affects: candidate.files.slice(0, 10).map(redact),
  };

  const bodyParts: string[] = [];
  bodyParts.push(`Extracted from \`${candidate.primaryRef}\`.`);
  if (candidate.corroboratingRefs.length > 0) {
    bodyParts.push(
      `Corroborated by: ${candidate.corroboratingRefs.slice(0, 4).join(", ")}.`,
    );
  }
  if (redactedEvidence.length > 0) {
    bodyParts.push("", "**Evidence lines:**");
    for (const ev of redactedEvidence) {
      bodyParts.push(`- (\`${ev.sourceRef}\`) ${ev.text}`);
    }
  }
  if (candidate.files.length > 0) {
    bodyParts.push("", "**Files touched:**");
    for (const f of candidate.files.slice(0, 8)) {
      bodyParts.push(`- ${redact(f)}`);
    }
  }

  return { frontmatter: fm, body: bodyParts.join("\n") };
}

function proposeDecision(candidate: Candidate): DraftEntry {
  const titleSlug = slug(candidate.title);
  const id = safeId(`prmine-decision-${titleSlug}`);
  const confidence = computeConfidence(candidate);
  const sources = buildSources(candidate);

  const redactedTitle = redact(candidate.title).slice(0, 120);
  const redactedEvidence = candidate.evidence
    .slice(0, 5)
    .map((e) => ({ ...e, text: redact(e.text) }));

  const fm = {
    ...baseFrontmatter(id, "decision", redactedTitle, sources, confidence, [
      "pr-mining",
      "architecture",
    ]),
    decision: redact(
      `${candidate.title.slice(0, 400)} (see ${candidate.primaryRef})`,
    ),
    rationale: redact(
      redactedEvidence.length > 0
        ? redactedEvidence.map((e) => e.text).join("; ").slice(0, 400)
        : `Inferred from commit/PR subject: "${candidate.title.slice(0, 200)}"`,
    ),
    outcome: "pending",
  };

  const bodyParts: string[] = [];
  bodyParts.push("## Context");
  bodyParts.push(`Extracted from \`${candidate.primaryRef}\`.`);
  if (candidate.corroboratingRefs.length > 0) {
    bodyParts.push(
      `Corroborated by: ${candidate.corroboratingRefs.slice(0, 4).join(", ")}.`,
    );
  }
  if (redactedEvidence.length > 0) {
    bodyParts.push("", "## Rationale (from commit body)");
    for (const ev of redactedEvidence) {
      bodyParts.push(`- (\`${ev.sourceRef}\`) ${ev.text}`);
    }
  }
  bodyParts.push("", "## Decision");
  bodyParts.push(redact(candidate.title));
  bodyParts.push("", "## Consequences");
  bodyParts.push("_Pending review — fill in after verification._");

  return { frontmatter: fm, body: bodyParts.join("\n") };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function proposeCandidates(candidates: Candidate[]): DraftEntry[] {
  const drafts: DraftEntry[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    // Drop candidates with no source ref grounding (should not happen given
    // extractor logic, but be defensive)
    if (!candidate.primaryRef) continue;

    let draft: DraftEntry;
    if (candidate.kind === "gotcha") {
      draft = proposeGotcha(candidate);
    } else {
      draft = proposeDecision(candidate);
    }

    const id = draft.frontmatter.id;
    if (seen.has(id)) continue;
    seen.add(id);
    drafts.push(draft);
  }

  return drafts;
}
