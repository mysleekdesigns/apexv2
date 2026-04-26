// Duplicate-detection for knowledge entries.
//
// Uses shingled Jaccard similarity (character 3-grams) — no embeddings required.
// Two entries are considered candidate duplicates when their normalised title OR
// their first-200-chars body have Jaccard ≥ THRESHOLD.

import type { KnowledgeEntry, Confidence } from "../types/shared.js";

const THRESHOLD = 0.85;
const BODY_CHARS = 200;

// ---------- shingle helpers ---------------------------------------------------

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function shingles(s: string, k = 3): Set<string> {
  const out = new Set<string>();
  const n = normalise(s);
  for (let i = 0; i <= n.length - k; i++) {
    out.add(n.slice(i, i + k));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const s of a) {
    if (b.has(s)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

// ---------- types -------------------------------------------------------------

export interface DuplicatePair {
  a: KnowledgeEntry;
  b: KnowledgeEntry;
  /** "title" | "body" — which field triggered the match */
  via: "title" | "body";
  score: number;
}

export interface DedupedCluster {
  /** Pairs where one side clearly wins (confidence difference) — a merge is proposed. */
  proposeMerge: boolean;
  /** Id of the entry to keep (higher confidence, or tiebreak by applies_to breadth). */
  keepId: string;
  /** Id of the entry to discard. */
  discardId: string;
  pair: DuplicatePair;
}

// ---------- public API --------------------------------------------------------

/** Confidence order for comparison (high wins). */
const CONF_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Rank applies_to breadth for tiebreaking: all > team > user.
 */
const APPLIES_RANK: Record<string, number> = { user: 0, team: 1, all: 2 };

function pickKeeper(a: KnowledgeEntry, b: KnowledgeEntry): { keepId: string; discardId: string; proposeMerge: boolean } {
  const ca = CONF_RANK[a.frontmatter.confidence];
  const cb = CONF_RANK[b.frontmatter.confidence];

  if (ca !== cb) {
    // Clear confidence difference — propose merging the lower into the higher.
    const [keep, discard] = ca > cb ? [a, b] : [b, a];
    // Only propose merge when there is a confidence gap (high vs low/medium, or medium vs low)
    const proposeMerge = Math.abs(ca - cb) >= 1;
    return { keepId: keep.frontmatter.id, discardId: discard.frontmatter.id, proposeMerge };
  }

  // Same confidence: use applies_to breadth as tiebreaker — no merge proposal.
  const aa = APPLIES_RANK[a.frontmatter.applies_to] ?? 0;
  const ba = APPLIES_RANK[b.frontmatter.applies_to] ?? 0;
  const [keep, discard] = aa >= ba ? [a, b] : [b, a];
  return { keepId: keep.frontmatter.id, discardId: discard.frontmatter.id, proposeMerge: false };
}

/**
 * Find all duplicate clusters within `entries`.
 * Only compares entries of the same `type` (per spec).
 */
export function findDuplicates(entries: KnowledgeEntry[]): DedupedCluster[] {
  const clusters: DedupedCluster[] = [];

  // Pre-compute shingles per entry.
  const titleShingles = new Map<string, Set<string>>();
  const bodyShingles = new Map<string, Set<string>>();

  for (const e of entries) {
    const id = e.frontmatter.id;
    titleShingles.set(id, shingles(e.frontmatter.title));
    bodyShingles.set(id, shingles(e.body.slice(0, BODY_CHARS)));
  }

  // Group by type — spec says only compare same-type entries.
  const byType = new Map<string, KnowledgeEntry[]>();
  for (const e of entries) {
    const t = e.frontmatter.type;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(e);
  }

  for (const group of byType.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i]!;
        const b = group[j]!;

        const tScore = jaccard(titleShingles.get(a.frontmatter.id)!, titleShingles.get(b.frontmatter.id)!);
        const bScore = jaccard(bodyShingles.get(a.frontmatter.id)!, bodyShingles.get(b.frontmatter.id)!);

        let via: "title" | "body" | null = null;
        let score = 0;

        if (tScore >= THRESHOLD) {
          via = "title";
          score = tScore;
        } else if (bScore >= THRESHOLD) {
          via = "body";
          score = bScore;
        }

        if (!via) continue;

        const { keepId, discardId, proposeMerge } = pickKeeper(a, b);
        const pair: DuplicatePair = { a, b, via, score };
        clusters.push({ proposeMerge, keepId, discardId, pair });
      }
    }
  }

  return clusters;
}
