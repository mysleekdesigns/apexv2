/**
 * Shadow predictor — pure heuristic, no side-effects.
 *
 * Given a prompt + recent history, returns 1–3 candidate queries that the
 * user is likely to need next. Used by runShadowPrefetch to warm the cache.
 */

// Small inline stopword list — no library imports.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "if", "in", "on", "at", "to",
  "for", "of", "with", "by", "from", "as", "is", "was", "are", "were",
  "be", "been", "being", "have", "has", "had", "do", "does", "did",
  "will", "would", "could", "should", "may", "might", "can", "that",
  "this", "these", "those", "it", "its", "they", "them", "their",
  "what", "which", "who", "when", "where", "why", "how", "not", "no",
  "so", "than", "then", "there", "here", "also", "just", "only",
  "into", "up", "out", "about", "after", "before", "all", "some",
  "any", "such", "each", "other", "more", "very", "your", "my",
  "our", "we", "you", "he", "she", "his", "her", "use", "using",
  "used", "make", "need", "want", "get", "give", "take", "put",
  "see", "know", "think", "come", "like", "look", "show", "set",
]);

/**
 * Extract noun-phrase candidates from text.
 * Returns lowercase tokens that are >=4 chars and not stopwords.
 */
export function extractNounPhrases(text: string): string[] {
  // Tokenise on whitespace/punctuation, lowercase, filter.
  const tokens = text
    .toLowerCase()
    .split(/[\s,;:.!?()\[\]{}"'`\\/|@#$%^&*+=<>~]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t) && /^[a-z][a-z0-9-_]*$/.test(t));

  // Dedupe while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/**
 * Detect intent-bearing prefixes that suggest a conceptual question.
 * Returns the rest of the prompt after the detected phrase, or null.
 */
function extractIntentSlice(prompt: string): string | null {
  const lower = prompt.toLowerCase().trim();
  const patterns = ["how do i ", "how do you ", "how to ", "what is ", "what are "];
  for (const pat of patterns) {
    if (lower.startsWith(pat)) {
      const rest = lower.slice(pat.length).trim();
      // Take the first two tokens of the remainder.
      const words = rest.split(/\s+/).filter(Boolean).slice(0, 2);
      if (words.length >= 1) return words.join(" ");
    }
    const idx = lower.indexOf(pat);
    if (idx !== -1) {
      const rest = lower.slice(idx + pat.length).trim();
      const words = rest.split(/\s+/).filter(Boolean).slice(0, 2);
      if (words.length >= 1) return words.join(" ");
    }
  }
  return null;
}

export interface PredictOptions {
  /** Up to 5 recent prompts from the current episode (newest last). */
  recentPrompts?: string[];
}

/**
 * Predict 1–3 candidate queries for the given prompt.
 *
 * Rules (in priority order):
 *   1. The verbatim prompt (always included).
 *   2. Top-2 distinct noun phrases from prompt + history, joined.
 *   3. If the prompt contains an intent phrase ("how do", "what is", etc.),
 *      a 2-word slice of the remainder.
 *
 * Result is deduped and capped at 3.
 */
export function predictQueries(prompt: string, opts: PredictOptions = {}): string[] {
  const candidates: string[] = [];

  // Candidate 1: verbatim prompt.
  candidates.push(prompt.trim());

  // Gather noun phrases from prompt + last 5 recent prompts.
  const history = (opts.recentPrompts ?? []).slice(-5);
  const allText = [prompt, ...history].join(" ");
  const phrases = extractNounPhrases(allText);

  // Candidate 2: top-2 distinct noun phrases joined.
  if (phrases.length >= 2) {
    const joined = phrases.slice(0, 2).join(" ");
    if (joined !== prompt.trim()) {
      candidates.push(joined);
    }
  } else if (phrases.length === 1) {
    const sole = phrases[0]!;
    if (sole !== prompt.trim()) {
      candidates.push(sole);
    }
  }

  // Candidate 3: intent slice.
  const intentSlice = extractIntentSlice(prompt);
  if (intentSlice !== null && intentSlice !== prompt.trim()) {
    candidates.push(intentSlice);
  }

  // Dedupe (case-insensitive) and cap at 3.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const key = c.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
    if (out.length === 3) break;
  }

  return out;
}
