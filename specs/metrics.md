# APEX Metrics — Definition, Collection & Storage Spec

**Status:** Phase 0 spec, frozen for Phase 1 build.
**Owners:** APEX core.
**Source of truth:** PRD §4, §7, §10.
**Forward references:** episode artifacts referenced below are defined in [`./episode-schema.md`](./episode-schema.md). Eval-run artifacts are defined in [`./eval-harness.md`](./eval-harness.md). This spec consumes those; it does not redefine them.

---

## 1. Principles

1. **Every metric is a counter or a timing.** No prompt content, no file contents, no identifiers — only numeric measurements with categorical labels drawn from a closed enum (see §7).
2. **One measurement = one JSONL line.** Metrics live in `.apex/metrics/<metric-name>.jsonl`. Append-only.
3. **Math is unambiguous.** Each metric specifies numerator, denominator, and time window. No "approximately."
4. **Collectible at Phase 1.** Every metric below is computable from data the Phase 1 hooks already capture.
5. **Storage is bounded.** §8 caps every file and defines rotation.

---

## 2. Common JSONL line schema

Every line in every `metrics/*.jsonl` file conforms to:

```json
{
  "metric": "<metric-name>",
  "ts": "<iso8601-utc>",
  "window": "session|day|eval-run",
  "session_id": "<id|null>",
  "eval_run_id": "<id|null>",
  "value": <number>,
  "numerator": <number|null>,
  "denominator": <number|null>,
  "labels": { "<key>": "<closed-enum-value>", ... },
  "schema_version": 1
}
```

`metric` matches the filename stem. `value` is the headline number (typically `numerator/denominator`, or a raw count/timing). `labels` is an object whose keys/values are constrained per metric in §3.

---

## 3. Base metrics (PRD §10)

The seven metrics below correspond 1:1 to PRD §10. Each subsection gives: definition, source, cadence, storage, threshold.

### 3.1 Repeat-mistake rate

- **Definition.** Numerator: count of distinct error signatures observed in ≥2 sessions in the window. Denominator: count of distinct error signatures observed in ≥1 session in the window. **Window:** rolling 7 days (default), aligned to UTC midnight. Recomputed daily.
- **Error signature.** SHA-256 of `(tool_name, exit_code, normalized_error_first_line)`. `normalized_error_first_line` strips absolute paths, line numbers, and hex addresses via the redactor's `error_normalizer` ruleset.
- **Data source.** `.apex/episodes/<session-id>/failures.jsonl` (per `episode-schema.md`, written by `PostToolUseFailure` hook per PRD §1.3).
- **Cadence.** Recomputed daily at session start (first session of the UTC day) and at the end of every eval run.
- **Storage.** `.apex/metrics/repeat-mistake-rate.jsonl`. Schema additions: `labels.scope ∈ {session, day, eval-run}`, `labels.stack ∈ {node-ts, python, go, rust, mixed, unknown}`.
- **Alarm threshold.** Warn if `value > 0.30` over 7 days **and** trend over the last 3 daily measurements is non-decreasing. Surfaced via `apex stats` and the session-start banner.

### 3.2 Knowledge hit rate

- **Definition.** Numerator: sessions in the window where ≥1 knowledge entry retrieved by `apex_search` (or surfaced at `SessionStart`) was *referenced* by Claude's output. Denominator: total sessions in the window where ≥1 knowledge entry was retrieved or surfaced. **Window:** rolling 7 days.
- **"Referenced"** = the entry's `id` appears in any tool input emitted by Claude in that session, OR Claude's assistant text in that session contains the entry's `title` substring (case-insensitive, exact).
- **Data source.** `.apex/episodes/<session-id>/retrievals.jsonl` and `.apex/episodes/<session-id>/tools.jsonl` (per `episode-schema.md`).
- **Cadence.** Per-session at `SessionEnd` (writes one line for that session); aggregated daily.
- **Storage.** `.apex/metrics/knowledge-hit-rate.jsonl`. `labels.scope ∈ {session, day}`.
- **Alarm threshold.** Warn if rolling 7-day `value < 0.40` (target per PRD §10 is ≥0.60 by Phase 4).

### 3.3 Time-to-first-correct-edit

- **Definition.** For an eval task: wall milliseconds from session start until the first file edit that, applied in isolation, makes all `success_criteria` pass. **Window:** per eval task; aggregated per eval run as the median across tasks.
- **Data source.** Eval-run `episodes/<profile>/<session-id>/edits.jsonl` (eval harness §3.4) and `results.jsonl`.
- **Cadence.** Per eval task; written at end of task. Aggregated at end of eval run.
- **Storage.** `.apex/metrics/time-to-first-correct-edit.jsonl`. `labels.scope ∈ {task, run}`, `labels.stack`, `labels.profile ∈ {apex-on, apex-off}`, `labels.task_id`.
- **Alarm threshold.** Warn if median `value` for `apex-on` over the last eval run regresses by ≥20% vs the prior run on the same task set.

### 3.4 User correction frequency

- **Definition.** Numerator: count of user prompts classified as **corrections** in the window. Denominator: total user prompts in the window, divided by 100 (i.e., reported per-100-turns). **Window:** rolling 7 days.
- **Correction classifier.** A prompt is a correction if **any** of:
  1. Starts with one of the closed-set lead-ins: `no,`, `actually,`, `wait,`, `don't`, `stop`, `undo`, `revert`, `instead`, `correction:` (case-insensitive, after trimming).
  2. Contains the substring `do X instead` template per PRD §2.5 (regex `/\b(do|use)\s+\S+\s+instead\b/i`).
  3. Followed within the same session by an `apex_record_correction` MCP call referencing the prompt's turn id.
  Classification runs in the `UserPromptSubmit` hook, on prompt text only (no LLM call), and emits a label only — never the prompt body.
- **Data source.** `.apex/episodes/<session-id>/prompts.jsonl` (`is_correction: bool` field, written at submit time).
- **Cadence.** Per session at `SessionEnd`; aggregated daily.
- **Storage.** `.apex/metrics/user-correction-frequency.jsonl`. `labels.scope ∈ {session, day}`.
- **Alarm threshold.** Warn if rolling 7-day `value > 8.0` (corrections per 100 turns).

### 3.5 Stale entry percentage

- **Definition.** Numerator: count of knowledge entries with `last_validated` older than 30 days **and** not retrieved in any session in the last 30 days. Denominator: total knowledge entries. **Window:** snapshot at compute time.
- **Data source.** `.apex/knowledge/**/*.md` frontmatter (`last_validated`); retrieval history from `.apex/episodes/*/retrievals.jsonl` aggregated over 30 days.
- **Cadence.** Recomputed on every `apex curate` and at the end of every eval run.
- **Storage.** `.apex/metrics/stale-entry-pct.jsonl`. `labels.scope = snapshot`. `denominator` = total entries.
- **Alarm threshold.** Warn if `value > 0.15`.

### 3.6 Hook overhead (p99 SessionStart latency)

- **Definition.** p99 of `SessionStart` hook wall-millisecond duration over the last 100 hook invocations. **Window:** sliding count of 100 invocations (not time-based).
- **Data source.** Each hook script wraps its body with `start=$(date +%s%N) … end=$(date +%s%N)` and appends `{ts, hook, duration_ms}` to `.apex/metrics/_hook-latency.raw.jsonl`. The aggregator reads the last 100 lines for `hook=SessionStart` and computes p50/p95/p99.
- **Cadence.** Recomputed on every hook fire (cheap).
- **Storage.** Raw: `.apex/metrics/_hook-latency.raw.jsonl` (rotated per §8). Aggregated: `.apex/metrics/hook-overhead.jsonl`. `labels.hook ∈ {SessionStart, UserPromptSubmit, PostToolUse, PostToolUseFailure, PreCompact, SessionEnd}`, `labels.percentile ∈ {p50, p95, p99}`.
- **Alarm threshold.** Warn if `labels.hook = SessionStart` p99 `value > 800` ms (per PRD §10) — ERROR if `> 1000` ms (the PRD §4 hook budget).

### 3.7 Install-to-value

- **Definition.** Wall seconds from the timestamp of `apex init` completion to the timestamp of the first session in which a retrieved knowledge entry is referenced (per §3.2 reference rule). One measurement per install.
- **Data source.** `.apex/install.json` (written by installer with `installed_at`); first qualifying session identified from `.apex/episodes/*/meta.json` and `retrievals.jsonl`.
- **Cadence.** Computed once, at the first session that satisfies the condition.
- **Storage.** `.apex/metrics/install-to-value.jsonl` (one line ever, per install). `labels.scope = install`.
- **Alarm threshold.** Warn if `value > 1800` seconds (30 min). Target per PRD §10 is < 5 minutes.

---

## 4. Derived metrics

Two derived metrics, fully expressible from §3 sources:

### 4.1 Knowledge yield

- **Definition.** Numerator: count of knowledge entries promoted from `proposed/` to `knowledge/` in the window. Denominator: count of sessions in the window. **Window:** rolling 7 days.
- **Data source.** Git log of `.apex/knowledge/` and `.apex/proposed/` (file moves with `git log --diff-filter=A --follow`); session count from `.apex/episodes/*/meta.json`.
- **Storage.** `.apex/metrics/knowledge-yield.jsonl`. `labels.scope = day`.
- **Threshold.** Warn if `value < 0.10` over 7 days *and* `repeat-mistake-rate` (§3.1) `> 0.30` — together they imply the reflector is starving.

### 4.2 Correction half-life

- **Definition.** Median wall hours between a correction event for a given error signature and the timestamp at which that signature's per-day occurrence rate has fallen and stayed below 50% of the at-correction rate for 3 consecutive days. **Window:** computed over corrections in the last 30 days.
- **Data source.** Joined: `.apex/episodes/*/prompts.jsonl` (corrections via §3.4 classifier) and `.apex/episodes/*/failures.jsonl` (signatures via §3.1).
- **Cadence.** Recomputed daily.
- **Storage.** `.apex/metrics/correction-half-life.jsonl`. `value` in hours; `denominator` = number of (signature, correction) pairs in the sample.
- **Threshold.** Warn if median `value > 168` (one week). A growing half-life means corrections aren't sticking.

---

## 5. `apex stats` CLI

```
apex stats [--window 1d|7d|30d] [--json] [--since <iso8601>]
```

Default window is 7d. `--json` emits the raw aggregated object; without it, prints the one-screen summary below.

### 5.1 Sample mocked output

```
APEX status — project: my-project (window: last 7 days)
─────────────────────────────────────────────────────────────────
Knowledge base    47 entries  (38 high · 7 medium · 2 low confidence)
Last reflection   2026-04-26 09:14 UTC  ·  Last curation  2026-04-22

Core metrics                       value     target    trend (vs prior 7d)
  Repeat-mistake rate              0.18      ≤ 0.20    ↓  (-0.07)   OK
  Knowledge hit rate               0.62      ≥ 0.60    ↑  (+0.05)   OK
  User correction freq /100 turns  4.1                 ↓  (-1.3)    OK
  Stale entry %                    0.09      ≤ 0.15    flat         OK
  SessionStart hook p99 (ms)       412       ≤ 800     ↑  (+38)     OK
  Knowledge yield (entries/sess)   0.34                ↑  (+0.11)   OK
  Correction half-life (hours)     38.2                ↓  (-12.4)   OK

Eval (last run 2026-04-26-1830-eval)
  Synthetic pass rate              7 / 8     ↑ from 4 / 8
  Replay win rate                  3 / 4     ↑ from 1 / 4
  Time-to-first-correct (median)   132 s     ↓ from 178 s

Alerts                             none.
─────────────────────────────────────────────────────────────────
Run `apex eval run` to refresh eval metrics. `apex stats --json` for raw.
```

If any alarm threshold from §3–§4 trips, it appears under **Alerts** with the exact threshold violated and a one-line remediation hint.

---

## 6. Session-start dashboard banner

Per PRD §4.4, on every `SessionStart` APEX prints a one-line banner. The exact format:

```
APEX: <ENTRIES_USED> entries used last week (<HELPFUL> helpful, <CORRECTED> corrected, <UNUSED> unused)
```

Each number is sourced as follows. **Window:** rolling 7 days ending at session start.

| Token | Source |
|---|---|
| `ENTRIES_USED` | Distinct knowledge entry IDs appearing in `.apex/episodes/*/retrievals.jsonl` lines with `surfaced: true` over the window. |
| `HELPFUL` | Of those entries, the count that were *referenced* (per §3.2 "Referenced" rule) **and** preceded a successful tool outcome (next `tools.jsonl` entry in the same session has `exit_code == 0` or `null` for non-shell tools). |
| `CORRECTED` | Of those entries, the count that were referenced **and** followed within the same session by a `prompts.jsonl` entry with `is_correction: true` (per §3.4). |
| `UNUSED` | `ENTRIES_USED − HELPFUL − CORRECTED`. May be 0; never negative (computation guarantees disjoint partition by precedence: HELPFUL takes precedence over CORRECTED takes precedence over UNUSED). |

If the window contains zero retrievals (e.g., fresh install), the banner reads:
```
APEX: 0 entries used last week (warming up — first reflection pending)
```

The banner is a derived view; nothing new is persisted by the banner itself.

---

## 7. Closed-enum labels

The complete set of allowed `labels` keys and values (any other key/value is rejected at write time):

| Key | Allowed values |
|---|---|
| `scope` | `session`, `day`, `eval-run`, `task`, `run`, `snapshot`, `install` |
| `stack` | `node-ts`, `python`, `go`, `rust`, `mixed`, `unknown` |
| `profile` | `apex-on`, `apex-off` |
| `hook` | `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PostToolUseFailure`, `PreCompact`, `SessionEnd` |
| `percentile` | `p50`, `p95`, `p99` |
| `task_id` | kebab-case slug; must exist in `eval/tasks/<stack>/` |
| `confidence` | `low`, `medium`, `high` |

---

## 8. Privacy

Metrics writers MUST NOT persist any of the following — enforced by the same redactor that runs on `episodes/` and `knowledge/` (PRD §9):

- Prompt text, assistant text, tool inputs, tool outputs.
- File paths beyond the closed `labels` enums.
- Repository contents.
- User identifiers, emails, hostnames, IP addresses.
- Environment variable values.

What metrics MAY contain: counters, timings, percentiles, ISO 8601 timestamps, opaque IDs (`session_id`, `eval_run_id`, knowledge entry IDs — all kebab-case slugs minted by APEX), and label values from the §7 closed enum.

A CI lint (`apex audit metrics`) regex-scans every `.apex/metrics/*.jsonl` for the redactor's secret patterns and for any field outside the §2 schema; failure blocks the commit.

---

## 9. Storage budget & rotation

- **Per-file cap:** 10 MiB per `.apex/metrics/<name>.jsonl`. On overflow, the file is renamed to `<name>.<YYYYMMDD>.jsonl` and a fresh file is started.
- **Total cap for `.apex/metrics/`:** 100 MiB. Oldest rotated files are deleted first when total exceeds cap.
- **Raw hook latency file** (`_hook-latency.raw.jsonl`): hard cap 1000 lines (ring buffer; oldest line dropped on append).
- **Aggregated metric files** retain at minimum 90 days of measurements regardless of size cap (rotation respects this floor by keeping the most recent dated rotation file even if over total cap; if total cap and 90-day floor conflict, a warning is emitted via `apex stats` rather than data being deleted).
- `.apex/metrics/` is gitignored by default (per PRD §7.1).

---

## 10. Out of scope (Phase 0)

- Cost / token-spend metrics (deferred — needs a billing-side signal).
- Cross-project / team aggregates (Phase 5 concern).
- LLM-as-judge "helpfulness" scores (we use the mechanical reference rule in §3.2).
- Historical backfill from pre-Phase-1 sessions.
