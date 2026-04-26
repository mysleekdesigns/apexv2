// extractor.ts — pure heuristic extraction of candidate signals from commit metadata.
//
// No I/O; takes CommitInfo[] and PrInfo[] and returns Candidate[].
// All patterns are explained inline.

import type { CommitInfo, PrInfo } from "./git.js";

export type CandidateKind = "gotcha" | "decision";

export interface EvidenceLine {
  text: string;
  sourceRef: string;
}

export interface Candidate {
  kind: CandidateKind;
  title: string;
  /** The most relevant commit SHA (or PR number) for the primary source. */
  primaryRef: string;
  /** Additional corroborating refs (commit SHAs, PR numbers). */
  corroboratingRefs: string[];
  /** Evidence lines extracted from bodies / subjects. */
  evidence: EvidenceLine[];
  /** Files touched — used as context in the proposal body. */
  files: string[];
  /**
   * High-signal marker: the commit or PR touched an ADR/CHANGELOG file,
   * which boosts confidence to `medium` if combined with another commit.
   */
  isHighSignal: boolean;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// Commit subjects that suggest a gotcha (bugs, regressions, rollbacks)
const GOTCHA_SUBJECT_RE = /^(fix|hotfix|revert|patch)\b/i;

// Commit subjects that suggest a decision (deliberate architectural choices)
const DECISION_SUBJECT_RE = /^(decide[ds]?|adopt|switch(?:\s+to)?|migrate(?:\s+to)?|deprecate[ds]?)\b/i;

// Body lines that contain explanatory language worth capturing as evidence
const EVIDENCE_BODY_RE = /\b(why|because|reason|to avoid|gotcha|caveat|note:)\b/i;

// Files that indicate high-signal sources (ADRs, CHANGELOG, decision logs)
const HIGH_SIGNAL_FILES_RE =
  /^(CHANGELOG\.md|docs\/decisions\/[^/]+\.md|docs\/adr\/[^/]+\.md|ADR-[^/]+\.md)$/i;

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export interface ExtractorOpts {
  /** If true, also extract from PR bodies (not just commit data). */
  includePrBodies?: boolean;
}

export function extractCandidates(
  commits: CommitInfo[],
  prs: PrInfo[] = [],
  _opts: ExtractorOpts = {},
): Candidate[] {
  const candidates: Candidate[] = [];

  // --- Pass 1: classify commits by subject pattern -------------------------
  for (const commit of commits) {
    const kind = classifySubject(commit.subject);
    if (!kind) continue;

    const isHighSignal = commit.files.some((f) => HIGH_SIGNAL_FILES_RE.test(f));

    const evidence: EvidenceLine[] = extractEvidenceLines(commit.body, `commit/${commit.sha}`);

    // Also treat the commit subject itself as evidence
    evidence.unshift({
      text: commit.subject,
      sourceRef: `commit/${commit.sha}`,
    });

    candidates.push({
      kind,
      title: buildTitle(kind, commit.subject),
      primaryRef: `commit/${commit.sha}`,
      corroboratingRefs: [],
      evidence,
      files: commit.files.slice(0, 20),
      isHighSignal,
    });
  }

  // --- Pass 2: incorporate PR bodies if --include-reviews ------------------
  for (const pr of prs) {
    const kind = classifySubject(pr.title);
    if (!kind) continue;

    const isHighSignal = false; // PR bodies don't touch files directly
    const evidence: EvidenceLine[] = extractEvidenceLines(pr.body, `pr/${pr.number}`);
    evidence.unshift({ text: pr.title, sourceRef: `pr/${pr.number}` });

    candidates.push({
      kind,
      title: buildTitle(kind, pr.title),
      primaryRef: `pr/${pr.number}`,
      corroboratingRefs: pr.mergeCommitSha ? [`commit/${pr.mergeCommitSha}`] : [],
      evidence,
      files: [],
      isHighSignal,
    });
  }

  // --- Pass 3: merge & corroborate duplicate titles ------------------------
  return mergeAndCorroborate(candidates);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifySubject(subject: string): CandidateKind | null {
  if (GOTCHA_SUBJECT_RE.test(subject)) return "gotcha";
  if (DECISION_SUBJECT_RE.test(subject)) return "decision";
  return null;
}

function buildTitle(kind: CandidateKind, subject: string): string {
  // Strip the conventional commit prefix for a cleaner title
  const cleaned = subject
    .replace(/^(fix|hotfix|revert|patch|decide[ds]?|adopt|switch(?:\s+to)?|migrate(?:\s+to)?|deprecate[ds]?)(\([^)]+\))?[!:]?\s*/i, "")
    .trim();
  const prefix = kind === "gotcha" ? "Fix" : "Decision";
  const base = cleaned || subject;
  return `${prefix}: ${base}`.slice(0, 120);
}

function extractEvidenceLines(body: string, sourceRef: string): EvidenceLine[] {
  if (!body.trim()) return [];
  const lines: EvidenceLine[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (EVIDENCE_BODY_RE.test(trimmed)) {
      lines.push({ text: trimmed.slice(0, 300), sourceRef });
    }
  }
  return lines;
}

function normTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Merge candidates with similar normalised titles. The first occurrence
 * becomes the primary; later ones are added as corroborating refs.
 */
function mergeAndCorroborate(candidates: Candidate[]): Candidate[] {
  const merged = new Map<string, Candidate>();

  for (const c of candidates) {
    const key = `${c.kind}:${normTitle(c.title)}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...c, corroboratingRefs: [...c.corroboratingRefs] });
    } else {
      // Merge corroborating refs
      if (!existing.corroboratingRefs.includes(c.primaryRef)) {
        existing.corroboratingRefs.push(c.primaryRef);
      }
      // Merge evidence
      for (const ev of c.evidence) {
        if (!existing.evidence.some((e) => e.text === ev.text)) {
          existing.evidence.push(ev);
        }
      }
      // Merge files
      for (const f of c.files) {
        if (!existing.files.includes(f)) existing.files.push(f);
      }
      // Upgrade isHighSignal
      if (c.isHighSignal) existing.isHighSignal = true;
    }
  }

  return [...merged.values()];
}
