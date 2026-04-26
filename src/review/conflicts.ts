// Deterministic merge rules for conflicting edits to a single knowledge entry.
//
// When two branches edit the same `.apex/knowledge/<type>/<id>.md` and a
// human-resolvable conflict appears (e.g. as part of `git merge` or while
// reviewing a PR), `resolveConflict` picks a winner using a strict ordering:
//
//   1. confidence (high > medium > low)            — trust the more confirmed entry
//   2. last_validated (later ISO date wins)        — fall back to fresher evidence
//   3. supersedes-chain                            — the entry that lists the other
//                                                    in its `supersedes:` is newer
//   4. structural body merge                       — both bodies preserved if they
//                                                    are clearly orthogonal
//   5. action: "manual"                            — last resort, ask a human
//
// This module is deliberately pure: it never touches git, never reads the
// filesystem. Callers pass parsed frontmatter + body strings and receive a
// merge plan they can apply with their own writer.

import type { Confidence } from "../types/shared.js";

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/** Subset of frontmatter required for conflict resolution. Extra keys are ignored. */
export interface ConflictFrontmatter {
  id: string;
  confidence: Confidence;
  last_validated: string;
  /** Optional. When present, names entries this one explicitly replaces. */
  supersedes?: string[];
  /** Anything else from the YAML — preserved when the side wins. */
  [extra: string]: unknown;
}

export type ConflictAction = "use_local" | "use_remote" | "merge" | "manual";

export interface ConflictResolution {
  /** The merged frontmatter and body. May reference the unchanged side directly. */
  resolved: {
    frontmatter: ConflictFrontmatter;
    body: string;
  };
  /** Which path the resolver took. */
  action: ConflictAction;
  /** Human-readable reason — surfaced in `apex review` output and PR descriptions. */
  reason: string;
}

/**
 * Resolve a conflict between two versions of the same knowledge entry.
 *
 * Inputs are passed by value — the resolver does no I/O. Pass `localBody` and
 * `remoteBody` as the markdown content *after* the YAML frontmatter has been
 * stripped (use `gray-matter` or equivalent at the call site).
 *
 * Tie-breaking order:
 *   1. Frontmatter `id` mismatch is treated as the caller's bug — we still
 *      try to resolve, but flag with `action: "manual"` because two different
 *      ids should never have been merged in the first place.
 *   2. Higher confidence wins.
 *   3. More recent `last_validated` (ISO YYYY-MM-DD lexicographic order) wins.
 *   4. Supersedes-chain: if local lists remote.id in its `supersedes:`, local
 *      is newer (and vice-versa).
 *   5. If bodies are byte-identical and only frontmatter differs, merge is
 *      possible — we keep the winning frontmatter and the shared body.
 *   6. Otherwise return `action: "manual"` so the caller can stage a manual
 *      diff for human review.
 */
export function resolveConflict(
  localFrontmatter: ConflictFrontmatter,
  remoteFrontmatter: ConflictFrontmatter,
  localBody: string,
  remoteBody: string,
): ConflictResolution {
  // Sanity: matching ids only (different ids = caller bug, surface for human).
  if (localFrontmatter.id !== remoteFrontmatter.id) {
    return {
      resolved: { frontmatter: localFrontmatter, body: localBody },
      action: "manual",
      reason: `id mismatch: local="${localFrontmatter.id}" vs remote="${remoteFrontmatter.id}". Manual review required — these should not have been compared.`,
    };
  }

  // Identical content — no conflict at all.
  if (
    framesEqual(localFrontmatter, remoteFrontmatter) &&
    localBody === remoteBody
  ) {
    return {
      resolved: { frontmatter: localFrontmatter, body: localBody },
      action: "use_local",
      reason: "local and remote are byte-identical; no conflict",
    };
  }

  // Rule 1: confidence (high > medium > low).
  const localRank = CONFIDENCE_RANK[localFrontmatter.confidence];
  const remoteRank = CONFIDENCE_RANK[remoteFrontmatter.confidence];

  if (localRank > remoteRank) {
    return useLocal(
      localFrontmatter,
      localBody,
      `local confidence "${localFrontmatter.confidence}" outranks remote "${remoteFrontmatter.confidence}"`,
    );
  }
  if (remoteRank > localRank) {
    return useRemote(
      remoteFrontmatter,
      remoteBody,
      `remote confidence "${remoteFrontmatter.confidence}" outranks local "${localFrontmatter.confidence}"`,
    );
  }

  // Rule 2: last_validated (ISO YYYY-MM-DD; lexical comparison is correct).
  if (localFrontmatter.last_validated > remoteFrontmatter.last_validated) {
    return useLocal(
      localFrontmatter,
      localBody,
      `local last_validated (${localFrontmatter.last_validated}) is later than remote (${remoteFrontmatter.last_validated})`,
    );
  }
  if (remoteFrontmatter.last_validated > localFrontmatter.last_validated) {
    return useRemote(
      remoteFrontmatter,
      remoteBody,
      `remote last_validated (${remoteFrontmatter.last_validated}) is later than local (${localFrontmatter.last_validated})`,
    );
  }

  // Rule 3: supersedes-chain. The entry that cites the other as superseded is newer.
  const localSupersedesRemote =
    Array.isArray(localFrontmatter.supersedes) &&
    localFrontmatter.supersedes.includes(remoteFrontmatter.id);
  const remoteSupersedesLocal =
    Array.isArray(remoteFrontmatter.supersedes) &&
    remoteFrontmatter.supersedes.includes(localFrontmatter.id);

  if (localSupersedesRemote && !remoteSupersedesLocal) {
    return useLocal(
      localFrontmatter,
      localBody,
      `local entry's supersedes: chain claims remote (${remoteFrontmatter.id})`,
    );
  }
  if (remoteSupersedesLocal && !localSupersedesRemote) {
    return useRemote(
      remoteFrontmatter,
      remoteBody,
      `remote entry's supersedes: chain claims local (${localFrontmatter.id})`,
    );
  }
  if (localSupersedesRemote && remoteSupersedesLocal) {
    // Cyclic supersedes — invalid per knowledge-schema.md §"Supersession chain".
    return {
      resolved: { frontmatter: localFrontmatter, body: localBody },
      action: "manual",
      reason: `supersedes cycle: local and remote each list the other (invalid per schema). Manual review required.`,
    };
  }

  // Rule 4: bodies identical, frontmatter differs only in non-decisive fields →
  // merge by keeping local frontmatter and shared body. Deterministic since
  // local and remote are equal-ranked at this point.
  if (localBody === remoteBody) {
    return {
      resolved: { frontmatter: localFrontmatter, body: localBody },
      action: "merge",
      reason: "bodies are identical; frontmatter equal-ranked — kept local frontmatter",
    };
  }

  // Rule 5: nothing automatic — flag manual.
  return {
    resolved: { frontmatter: localFrontmatter, body: localBody },
    action: "manual",
    reason:
      "equal confidence, equal last_validated, no supersedes link, and bodies differ — manual review required",
  };
}

function useLocal(
  fm: ConflictFrontmatter,
  body: string,
  reason: string,
): ConflictResolution {
  return { resolved: { frontmatter: fm, body }, action: "use_local", reason };
}

function useRemote(
  fm: ConflictFrontmatter,
  body: string,
  reason: string,
): ConflictResolution {
  return { resolved: { frontmatter: fm, body }, action: "use_remote", reason };
}

/** Shallow deep-equal sufficient for our frontmatter shape (JSON-serialisable). */
function framesEqual(a: ConflictFrontmatter, b: ConflictFrontmatter): boolean {
  try {
    return JSON.stringify(sortObj(a)) === JSON.stringify(sortObj(b));
  } catch {
    return false;
  }
}

function sortObj(o: unknown): unknown {
  if (Array.isArray(o)) return o.map(sortObj);
  if (o && typeof o === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(o as Record<string, unknown>).sort()) {
      sorted[key] = sortObj((o as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return o;
}
