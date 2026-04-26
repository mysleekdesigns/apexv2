import path from "node:path";
import fs from "node:fs/promises";
import { readEpisodeSignals } from "../reflector/signals.js";
import type {
  CorrectionLine,
  EpisodeSignals,
  FailureLine,
  ToolLine,
} from "../reflector/signals.js";
import type { KnowledgeEntry } from "../types/shared.js";
import type {
  AggregatedSignals,
  CalibrationConfig,
  CalibrationSignal,
  EntryRef,
  SignalSource,
} from "./types.js";

const TEST_COMMAND_RE = /\b(npm|pnpm|yarn|pytest|jest|vitest|cargo|go)\b\s+(?:run\s+)?test\b/i;
const IGNORE_RE = /\b(ignore|forget|stop using)\b\s+(?:that|this rule|that gotcha|the rule|the entry)/i;
const NEGATION_RE = /\b(not|n't|should not|shouldn't|disallow|avoid|never)\b/i;

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "this",
  "that",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "it",
  "as",
  "at",
  "by",
  "from",
  "but",
  "do",
  "does",
  "did",
  "should",
  "would",
  "could",
  "we",
  "you",
  "i",
  "they",
  "he",
  "she",
  "use",
  "using",
  "used",
  "no",
  "not",
]);

/** Lowercase + tokenise + drop stop-words. v1 lemmatizer: trim trailing s/es/ed/ing. */
export function tokenize(s: string): string[] {
  const tokens = s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
    .map(lemmatize);
  return tokens;
}

function lemmatize(t: string): string {
  if (t.length > 4 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}

export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let intersect = 0;
  for (const t of sa) if (sb.has(t)) intersect++;
  const unionSize = sa.size + sb.size - intersect;
  if (unionSize === 0) return 0;
  return intersect / unionSize;
}

interface EntryIndex {
  ref: EntryRef;
  affects: string[];
  /** Lowercase tokens used for content matching. */
  tokens: string[];
  /** Pre-built lowercase id (for substring/explicit match). */
  idLower: string;
  /** Title tokens (used for failing-test contradiction match). */
  titleTokens: string[];
}

/** Build an index over knowledge entries for signal correlation. */
export function indexEntries(entries: KnowledgeEntry[]): EntryIndex[] {
  return entries.map((e) => {
    const fmAny = e.frontmatter as unknown as Record<string, unknown>;
    const affects = (() => {
      const v = fmAny["affects"];
      if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
      return [];
    })();
    const titleTokens = tokenize(e.frontmatter.title);
    const bodyTokens = tokenize(e.body.slice(0, 4000));
    return {
      ref: { id: e.frontmatter.id, type: e.frontmatter.type },
      affects,
      tokens: Array.from(new Set([...titleTokens, ...bodyTokens])),
      idLower: e.frontmatter.id.toLowerCase(),
      titleTokens,
    };
  });
}

interface EpisodeContext {
  episodeId: string;
  signals: EpisodeSignals;
  /** Files touched (Edit/Write) by tools in this episode. */
  filesTouched: Set<string>;
  /** True when at least one Bash test command exited 0 in this episode. */
  hasSuccessfulTest: boolean;
  /** Bash test commands that passed — used as evidence refs. */
  passedTests: ToolLine[];
}

function deriveEpisodeContext(s: EpisodeSignals): EpisodeContext {
  const filesTouched = new Set<string>();
  const passedTests: ToolLine[] = [];
  let hasSuccessfulTest = false;
  for (const t of s.tools) {
    if (
      (t.tool_name === "Edit" || t.tool_name === "Write" || t.tool_name === "NotebookEdit") &&
      t.exit_code === 0
    ) {
      const inp = t.input ?? {};
      const fp = (inp["file_path"] ?? inp["path"]) as string | undefined;
      if (typeof fp === "string") filesTouched.add(fp);
      if (Array.isArray(t.files_touched)) {
        for (const f of t.files_touched) filesTouched.add(f);
      }
    }
    if (t.tool_name === "Bash" && t.exit_code === 0) {
      const cmd = (t.input?.["command"] as string | undefined) ?? "";
      if (TEST_COMMAND_RE.test(cmd)) {
        hasSuccessfulTest = true;
        passedTests.push(t);
      }
    }
  }
  return {
    episodeId: s.episodeId,
    signals: s,
    filesTouched,
    hasSuccessfulTest,
    passedTests,
  };
}

/** Returns true when an entry's `affects` list overlaps the episode's edited files. */
function entryTouchedInEpisode(idx: EntryIndex, ctx: EpisodeContext): boolean {
  if (idx.affects.length === 0) return false;
  for (const f of ctx.filesTouched) {
    for (const a of idx.affects) {
      if (f === a || f.endsWith(a) || a.endsWith(f)) return true;
    }
  }
  return false;
}

function scoreFromTests(idx: EntryIndex, ctx: EpisodeContext): CalibrationSignal[] {
  if (!ctx.hasSuccessfulTest) return [];
  if (!entryTouchedInEpisode(idx, ctx)) return [];
  const test = ctx.passedTests[0];
  if (!test) return [];
  return [
    {
      direction: "up",
      source: "test_pass",
      episodeId: ctx.episodeId,
      ref: `episode/${ctx.episodeId}/tools.jsonl#turn=${test.turn}`,
    },
  ];
}

function scoreFromCorrections(
  idx: EntryIndex,
  ctx: EpisodeContext,
  cfg: CalibrationConfig,
): CalibrationSignal[] {
  const out: CalibrationSignal[] = [];
  for (const c of ctx.signals.corrections) {
    const sig = signalFromCorrection(idx, c, ctx.episodeId, cfg);
    if (sig) out.push(sig);
  }
  return out;
}

function signalFromCorrection(
  idx: EntryIndex,
  c: CorrectionLine,
  episodeId: string,
  cfg: CalibrationConfig,
): CalibrationSignal | null {
  const ref = `episode/${episodeId}/corrections.jsonl#turn=${c.turn}`;

  if (c.kind === "thumbs_up" && c.target_entry_id === idx.ref.id) {
    return { direction: "up", source: "thumbs_up", episodeId, ref };
  }
  if (c.kind === "thumbs_down" && c.target_entry_id === idx.ref.id) {
    return { direction: "down", source: "thumbs_down", episodeId, ref };
  }
  if (c.kind === "correction") {
    const text = (c.user_text ?? "").trim();
    if (text.length === 0) return null;

    if (text.toLowerCase().includes(idx.idLower) && IGNORE_RE.test(text)) {
      return { direction: "down", source: "ignore_directive", episodeId, ref };
    }
    if (IGNORE_RE.test(text)) {
      const userTokens = tokenize(text);
      if (jaccard(userTokens, idx.tokens) >= cfg.correctionJaccard) {
        return { direction: "down", source: "ignore_directive", episodeId, ref };
      }
    }

    const userTokens = tokenize(text);
    if (jaccard(userTokens, idx.tokens) >= cfg.correctionJaccard) {
      return { direction: "up", source: "repeat_correction", episodeId, ref };
    }
  }
  return null;
}

function scoreFromContradictingFailures(
  idx: EntryIndex,
  ctx: EpisodeContext,
): CalibrationSignal[] {
  if (!entryTouchedInEpisode(idx, ctx)) return [];
  const out: CalibrationSignal[] = [];
  for (const f of ctx.signals.failures) {
    const sig = signalFromFailure(idx, f, ctx.episodeId);
    if (sig) out.push(sig);
  }
  return out;
}

function signalFromFailure(
  idx: EntryIndex,
  f: FailureLine,
  episodeId: string,
): CalibrationSignal | null {
  const text = `${f.error} ${f.error_signature ?? ""}`.toLowerCase();
  if (!NEGATION_RE.test(text)) return null;
  if (idx.titleTokens.length === 0) return null;
  let matches = 0;
  for (const tok of idx.titleTokens) {
    if (text.includes(tok)) matches++;
  }
  if (matches < Math.min(2, idx.titleTokens.length)) return null;
  return {
    direction: "down",
    source: "contradicting_test",
    episodeId,
    ref: `episode/${episodeId}/failures.jsonl#turn=${f.turn}`,
  };
}

/**
 * Read retrieval rows for every supplied episode and return the set of
 * (type:id) keys that appeared in any of them.
 */
async function readRetrievedEntries(
  root: string,
  episodeIds: string[],
): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const id of episodeIds) {
    const file = path.join(root, ".apex", "episodes", id, "retrievals.jsonl");
    let txt: string;
    try {
      txt = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of txt.split("\n")) {
      const t = line.trim();
      if (t.length === 0) continue;
      try {
        const row = JSON.parse(t) as { entry_id?: string; entry_type?: string };
        if (row.entry_id && row.entry_type) {
          seen.add(`${row.entry_type}:${row.entry_id}`);
        }
      } catch {
        /* skip */
      }
    }
  }
  return seen;
}

export interface AggregateOptions {
  config: CalibrationConfig;
  /**
   * Recent episode ids in time-order (newest first). Used for staleness decay
   * — when supplied, entries not retrieved in `staleDecayN` episodes get a
   * synthetic down signal.
   */
  recentEpisodeIds?: string[];
  root: string;
}

/**
 * Read every episode in `episodeIds`, then aggregate per-entry signals.
 *
 * `entries` is the full knowledge base; entries with no signal are still
 * returned with an empty signal list so callers can detect "no-op".
 */
export async function aggregateSignals(
  entries: KnowledgeEntry[],
  episodeIds: string[],
  opts: AggregateOptions,
): Promise<AggregatedSignals[]> {
  const indexed = indexEntries(entries);
  const contexts: EpisodeContext[] = [];
  for (const id of episodeIds) {
    try {
      const sig = await readEpisodeSignals(opts.root, id);
      contexts.push(deriveEpisodeContext(sig));
    } catch {
      /* skip unreadable episode */
    }
  }

  const result: AggregatedSignals[] = indexed.map((idx) => ({
    entry: idx.ref,
    signals: [],
    score: 0,
  }));

  for (let i = 0; i < indexed.length; i++) {
    const idx = indexed[i]!;
    const acc: CalibrationSignal[] = [];
    for (const ctx of contexts) {
      acc.push(...scoreFromTests(idx, ctx));
      acc.push(...scoreFromCorrections(idx, ctx, opts.config));
      acc.push(...scoreFromContradictingFailures(idx, ctx));
    }
    result[i]!.signals = acc;
  }

  if (opts.recentEpisodeIds && opts.recentEpisodeIds.length >= opts.config.staleDecayN) {
    const window = opts.recentEpisodeIds.slice(0, opts.config.staleDecayN);
    const retrieved = await readRetrievedEntries(opts.root, window);
    for (let i = 0; i < indexed.length; i++) {
      const idx = indexed[i]!;
      const key = `${idx.ref.type}:${idx.ref.id}`;
      if (!retrieved.has(key)) {
        result[i]!.signals.push({
          direction: "down",
          source: "stale",
          episodeId: window[0]!,
          ref: `staleness/${opts.config.staleDecayN}-episodes`,
        });
      }
    }
  }

  for (const r of result) {
    r.score = r.signals.reduce(
      (acc, s) => acc + (s.direction === "up" ? 1 : -1),
      0,
    );
  }

  return result;
}

export type { ToolLine };
