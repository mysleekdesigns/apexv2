// Pure-function redactor. Implements specs/redactor-design.md §2 + §6.
//
// `redact()` is the single chokepoint for every write into `.apex/episodes/`
// and `.apex/knowledge/`. It is a pure transformation: same input + same
// catalog -> same output. No IO, no side effects.
//
// Phase 1 maps `block` and `mask` severities both to "replace with marker".
// `warn` patterns are not implemented in Phase 1 (per the owned-files brief).
// CI lint enforces block-tier strictness at the repo boundary (out of scope
// here).
//
// Idempotency: redact(redact(x)) === redact(x). The marker `[REDACTED:name]`
// contains no characters that match any default pattern, so a second pass is
// a no-op.

import { PATTERNS, type RedactorPattern } from "./patterns.js";

/**
 * Redact a string or any JSON-serialisable value. Strings are scanned with
 * the catalog. Objects/arrays are walked recursively; non-string leaves
 * (numbers, booleans, null) are returned untouched. The structural shape of
 * the input is preserved.
 */
export function redact<T>(input: T): T {
  if (typeof input === "string") {
    return redactString(input) as T;
  }
  if (Array.isArray(input)) {
    return input.map((v) => redact(v)) as unknown as T;
  }
  if (input !== null && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      // Keys are also redacted: a leaked secret used as a key is just as bad.
      const sk = redactString(k);
      out[sk] = redact(v);
    }
    return out as T;
  }
  return input;
}

/**
 * Redact a single string. Walks the pattern catalog in order; each pattern
 * may consume disjoint byte ranges. Already-replaced regions are not
 * re-scanned because the marker `[REDACTED:...]` is shorter than every
 * detector's minimum match length and contains characters most detectors
 * exclude.
 */
export function redactString(s: string): string {
  if (s.length === 0) return s;

  // §2.3 adversarial split-line case: AWS keys can wrap across `\n` mid-token
  // when JSON pretty-printers split long strings. We *detect* AWS keys in a
  // whitespace-folded view, then replace those byte ranges in the original.
  // Other patterns are run on the original text.
  let out = s;

  // Pre-pass: AWS access keys folded across whitespace.
  out = foldAndRedactAwsAccessKeys(out);

  for (const p of PATTERNS) {
    out = applyPattern(out, p);
  }

  // §2 aws-secret-key: 40-char base64 within 4 lines of `aws_secret_access_key`
  // / `AWS_SECRET_ACCESS_KEY`. Implemented contextually (no single regex).
  out = redactAwsSecretKeys(out);

  return out;
}

function applyPattern(s: string, p: RedactorPattern): string {
  // Reset lastIndex defensively — global regexes are stateful.
  p.regex.lastIndex = 0;
  if (typeof p.replacement === "string") {
    return s.replace(p.regex, p.replacement);
  }
  return s.replace(p.regex, p.replacement as (...a: string[]) => string);
}

/**
 * §2.3 — Pre-fold whitespace inside candidate AWS-access-key windows so a key
 * split across newlines or quotes still matches. We scan for `AKIA` anchors,
 * pull the next ~64 raw chars, strip ASCII whitespace + `\` continuations,
 * and if the de-noised view yields a 20-char `AKIA[0-9A-Z]{16}` token we
 * replace the original span with the marker.
 */
function foldAndRedactAwsAccessKeys(s: string): string {
  const ANCHOR = /AKIA/g;
  const MARKER = "[REDACTED:aws-access-key]";
  let out = "";
  let cursor = 0;
  for (let m: RegExpExecArray | null; (m = ANCHOR.exec(s)) !== null; ) {
    const start = m.index;
    // Window of up to 64 raw chars after the anchor (key body is 16 chars; we
    // give plenty of headroom for whitespace/quote noise).
    const windowEnd = Math.min(s.length, start + 64);
    const raw = s.slice(start, windowEnd);
    // Strip whitespace, quotes, backslashes, commas — typical JSON wrap noise.
    let stripped = "";
    const offsets: number[] = []; // stripped[i] came from raw[offsets[i]]
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]!;
      if (/[\s"'\\,]/.test(ch)) continue;
      stripped += ch;
      offsets.push(i);
    }
    // Need at least 20 surviving chars beginning with "AKIA".
    if (stripped.length < 20 || !stripped.startsWith("AKIA")) continue;
    const candidate = stripped.slice(0, 20);
    if (!/^AKIA[0-9A-Z]{16}$/.test(candidate)) continue;
    // 21st char must not extend the token (boundary check).
    const after = stripped.charAt(20);
    if (after && /[A-Z0-9]/.test(after)) continue;
    // Map back to raw span.
    const rawEndOffset = offsets[19]! + 1; // inclusive end in raw -> exclusive
    const rawSpanEnd = start + rawEndOffset;
    out += s.slice(cursor, start) + MARKER;
    cursor = rawSpanEnd;
    // Advance the global regex past this span.
    ANCHOR.lastIndex = rawSpanEnd;
  }
  out += s.slice(cursor);
  return out;
}

/**
 * §2 aws-secret-key — proximity guard. A 40-char base64 token is flagged
 * only when within 4 lines of an `aws_secret_access_key` / `AWS_SECRET_ACCESS_KEY`
 * cue. Avoids false-positives on commit SHAs / SRI hashes.
 */
function redactAwsSecretKeys(s: string): string {
  const lines = s.split("\n");
  // Find lines containing the cue.
  const cueRe = /aws_secret_access_key/i;
  const tokenRe = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40}(?![A-Za-z0-9+/=])/g;
  const cueLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (cueRe.test(lines[i]!)) cueLines.add(i);
  }
  if (cueLines.size === 0) return s;
  for (let i = 0; i < lines.length; i++) {
    let near = false;
    for (const c of cueLines) {
      if (Math.abs(i - c) <= 4) {
        near = true;
        break;
      }
    }
    if (!near) continue;
    lines[i] = lines[i]!.replace(tokenRe, "[REDACTED:aws-secret-key]");
  }
  return lines.join("\n");
}

/** Re-export for callers that want to enumerate patterns (e.g. `apex audit`). */
export { PATTERNS, patternNames } from "./patterns.js";
