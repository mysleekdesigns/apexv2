// Pattern detector for skill auto-authoring.
//
// Reads ordered tool sequences from episode data and detects repeated
// n-grams (n=2..5) of normalized tool names across episodes.
//
// Algorithm (longest first to prefer specific patterns):
//   1. Extract ordered tool name sequences per episode.
//   2. Normalize: lowercase tool names.
//   3. For n in [5,4,3,2] slide a window across each sequence, count
//      distinct occurrences across all episodes (by starting position).
//   4. Filter: occurrences >= threshold; shape length >= 2;
//      not entirely composed of "read" repeats.
//   5. Dedupe sub-patterns: if a longer shape has same occurrence count
//      as one of its sub-shapes, prefer the longer.
//   6. Sort by (length DESC, occurrences DESC); cap to limit.

export interface PatternOccurrence {
  episodeId: string;
  startTurn: number;
}

export interface DetectedPattern {
  shape: string[];
  occurrences: number;
  examples: PatternOccurrence[];
}

export interface EpisodeToolSequence {
  episodeId: string;
  /** Ordered tool names extracted from tools.jsonl, in turn order */
  tools: string[];
  /** Per-tool start turns, parallel to tools array */
  turns: number[];
}

export interface PatternDetectionOpts {
  /** Minimum number of occurrences to qualify. Default: 3 */
  threshold?: number;
  /** Maximum number of patterns to return. Default: 10 */
  limit?: number;
}

/** Normalize a tool name: lowercase, trim. */
function normalizeTool(name: string): string {
  return name.trim().toLowerCase();
}

/** Return true if the shape is entirely composed of a single "read" repetition. */
function isAllRead(shape: string[]): boolean {
  return shape.every((t) => t === "read");
}

/** Serialize a shape to a stable string key. */
function shapeKey(shape: string[]): string {
  return shape.join("\x00");
}

/** Generate all strict sub-shapes (length 2..shape.length-1) of a shape. */
function subShapeKeys(shape: string[]): Set<string> {
  const keys = new Set<string>();
  for (let len = 2; len < shape.length; len++) {
    for (let s = 0; s + len <= shape.length; s++) {
      keys.add(shapeKey(shape.slice(s, s + len)));
    }
  }
  return keys;
}

export function detectPatterns(
  episodes: EpisodeToolSequence[],
  opts: PatternDetectionOpts = {},
): DetectedPattern[] {
  const threshold = opts.threshold ?? 3;
  const limit = opts.limit ?? 10;

  // Map from shape key -> { shape, occurrences count, examples }
  const patternMap = new Map<
    string,
    { shape: string[]; count: number; examples: PatternOccurrence[] }
  >();

  // Collect all n-gram occurrences across all episodes, n = 5..2
  for (const n of [5, 4, 3, 2]) {
    for (const ep of episodes) {
      const normalized = ep.tools.map(normalizeTool);
      if (normalized.length < n) continue;

      for (let i = 0; i <= normalized.length - n; i++) {
        const slice = normalized.slice(i, i + n);
        const key = shapeKey(slice);

        const existing = patternMap.get(key);
        if (existing) {
          existing.count++;
          if (existing.examples.length < 10) {
            existing.examples.push({
              episodeId: ep.episodeId,
              startTurn: ep.turns[i] ?? i,
            });
          }
        } else {
          patternMap.set(key, {
            shape: slice,
            count: 1,
            examples: [
              {
                episodeId: ep.episodeId,
                startTurn: ep.turns[i] ?? i,
              },
            ],
          });
        }
      }
    }
  }

  // Filter by threshold + shape constraints
  const candidates: DetectedPattern[] = [];
  for (const [, entry] of patternMap) {
    if (entry.count < threshold) continue;
    if (entry.shape.length < 2) continue;
    if (isAllRead(entry.shape)) continue;
    candidates.push({
      shape: entry.shape,
      occurrences: entry.count,
      examples: entry.examples,
    });
  }

  // Dedupe sub-patterns: if a longer shape has same occurrence count as
  // any of its strict sub-shapes, remove the sub-shape.
  const keysToRemove = new Set<string>();
  for (const candidate of candidates) {
    const key = shapeKey(candidate.shape);
    // Find all strictly shorter candidates that are sub-shapes of this one
    for (const other of candidates) {
      if (other.shape.length >= candidate.shape.length) continue;
      // Check if 'other' is a sub-shape of 'candidate'
      const otherKey = shapeKey(other.shape);
      const allSubKeys = subShapeKeys(candidate.shape);
      if (allSubKeys.has(otherKey) && other.occurrences === candidate.occurrences) {
        keysToRemove.add(otherKey);
      }
    }
  }

  const filtered = candidates.filter((c) => !keysToRemove.has(shapeKey(c.shape)));

  // Sort: length DESC, then occurrences DESC
  filtered.sort((a, b) => {
    if (b.shape.length !== a.shape.length) return b.shape.length - a.shape.length;
    return b.occurrences - a.occurrences;
  });

  return filtered.slice(0, limit);
}
