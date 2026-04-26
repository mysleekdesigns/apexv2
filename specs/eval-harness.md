# APEX Eval Harness — Contract & Implementation Spec

**Status:** Phase 0 spec, frozen for Phase 1 build.
**Owners:** APEX core.
**Source of truth:** PRD §6.4, §10.
**Forward references:** episode schema is defined in [`./episode-schema.md`](./episode-schema.md). This spec consumes that schema; it does not redefine it.

---

## 1. Purpose

The eval harness is the system that proves the claim **"APEX is making Claude better at this project."** It is the only mechanism by which Phase 4 (`§6.4`) can ship its exit criterion (`≥15% reduction in repeat-mistake rate at week 4 vs week 1`).

The harness has two evaluation modes — **synthetic** and **replay** — that share a scoring rubric, a run-isolation model, and a single CLI surface (`apex eval`).

---

## 2. Evaluation modes

### 2.1 Synthetic mode

A curated, reproducible task set per supported stack. Every task starts from a frozen commit (or fixture archive) and must pass deterministic success criteria.

**Supported stacks (Phase 0 starter set):**
- `node-ts` — Node.js + TypeScript
- `python` — Python 3.11+
- `go` — Go 1.22+
- `rust` — Rust 1.75+

**Task file format** — YAML, one task per file, stored at `eval/tasks/<stack>/<task-id>.yaml`. Task IDs are kebab-case slugs.

```yaml
# eval/tasks/node-ts/add-route-health.yaml
id: add-route-health
stack: node-ts
title: Add a /health route returning 200 OK
description: |
  Wire a new GET /health route into the existing Express app that returns
  status 200 with body {"status":"ok"}.
fixture:
  kind: git_commit            # git_commit | tarball
  repo: fixtures/node-ts/express-skeleton
  commit: 9f3e2a1
prompt: |
  Add a GET /health endpoint to the Express app. It should return
  HTTP 200 with JSON body {"status": "ok"}. Add a test for it.
success_criteria:
  - kind: command_passes
    cmd: "pnpm test -- health.test.ts"
    timeout_seconds: 60
  - kind: file_contains
    path: src/routes/health.ts
    substring: "res.status(200)"
  - kind: diff_scope
    allowed_paths:
      - src/routes/health.ts
      - src/app.ts
      - src/__tests__/health.test.ts
    forbid_outside: true
  - kind: no_new_dependencies
weight: 1.0
budget:
  wall_seconds: 300
  max_tool_calls: 80
tags: [routing, express, http]
```

**Required fields:** `id`, `stack`, `fixture`, `prompt`, `success_criteria`. **Optional:** `weight` (default 1.0), `budget`, `tags`, `description`.

**Success criterion kinds (closed set):**

| `kind` | Pass condition |
|---|---|
| `command_passes` | Shell command exits 0 within `timeout_seconds` |
| `command_fails` | Shell command exits non-zero (used for negative tests) |
| `file_exists` | Path exists |
| `file_absent` | Path does not exist |
| `file_contains` | UTF-8 substring match in file |
| `file_regex` | ECMAScript regex match in file |
| `diff_scope` | Working-tree diff vs starting commit only touches `allowed_paths`; if `forbid_outside: true` any other change is a fail |
| `no_new_dependencies` | `package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml` deps unchanged vs starting commit |
| `test_count_delta` | Test count increases by `>= n` (parsed from configured runner) |
| `lint_clean` | Configured linter exits 0 |

A task **passes** iff every criterion in its list passes. Criteria are evaluated in declaration order; a single failure short-circuits to fail.

### 2.2 Replay mode

Re-run a previously recorded session's user prompts on the same starting commit, with and without APEX. Compare outcomes head-to-head. Implements PRD §6.4.1.

**Inputs:**
- An episode directory `.apex/episodes/<session-id>/` (per `episode-schema.md`).
- A `prompts.jsonl` file inside the episode (per the assumed contract in §3.4 below).
- The recorded `starting_commit` from the episode's `meta.json` (per `specs/episode-schema.md`).

**Procedure (per replay):**
1. Materialize a temp worktree at `starting_commit`.
2. Spawn a Claude Code session in that worktree under one of two profiles:
   - `apex-on` — full APEX install with current knowledge base.
   - `apex-off` — same Claude Code version, APEX hooks/skills/MCP disabled (`APEX_DISABLED=1`).
3. Feed user prompts from `prompts.jsonl` in order, one per turn, waiting for each turn to complete.
4. Record outcomes via the episode capture pipeline into a fresh episode under `.apex/metrics/eval/<run-id>/episodes/<profile>/<session-id>/`.
5. Apply the **scoring rubric** (§3) using the *original* episode's success signals as the reference.

**Comparison metrics (per replay pair, `apex-on` minus `apex-off`):**

| Metric | Definition |
|---|---|
| `tools_used_count` | Total tool invocations recorded in the new episode |
| `unique_tools_used` | Distinct tool names |
| `time_to_first_correct_edit_ms` | Wall ms from session-start until the first edit that — when applied to a temp checkout — passes the original task's `success_criteria` (or, if the original episode lacks them, until the first edit accepted by the user in the original episode) |
| `test_pass_rate` | Passing / total test runs recorded across the session |
| `edit_churn_lines` | Sum of additions+deletions from the running diff over all turns; lower is better |
| `prompt_count_to_done` | Number of user prompts consumed before all `success_criteria` pass; `null` if never passed |

A replay **passes** for a profile iff all `success_criteria` pass within `budget`. A replay **wins** for `apex-on` iff `apex-on` passes and `apex-off` does not, **or** both pass and `apex-on` strictly improves on every monotone metric (`time_to_first_correct_edit_ms`, `edit_churn_lines`, `prompt_count_to_done`) by ≥10% with no regression on `test_pass_rate`.

---

## 3. Scoring rubric

### 3.1 Per-task score (synthetic)

```
task_score(t) = (criteria_passed(t) / criteria_total(t)) * weight(t)
task_pass(t)  = (criteria_passed(t) == criteria_total(t)) ? 1 : 0
```

Both numbers are emitted; aggregations use `task_pass` for headline pass-rate and `task_score` for partial-credit trending.

### 3.2 Aggregated run score

Across a run with task set `T`:

```
run_pass_rate    = sum(task_pass(t)) / |T|
run_weighted     = sum(task_score(t)) / sum(weight(t))
run_p50_latency  = median over t of (wall_seconds_used(t))
run_tool_calls   = sum over t of (tool_calls_observed(t))
```

### 3.3 Per-replay score (replay)

`replay_score = 1.0` if `apex-on` wins (per §2.2), `0.5` if both pass with no clear win, `0.0` otherwise. Aggregated as `replay_win_rate = sum(replay_score) / |replays|`.

### 3.4 Episode-schema contract (cross-reference)

This harness reads from `.apex/episodes/<session-id>/` per `specs/episode-schema.md`. The load-bearing files for replay and scoring:

- `meta.json` — `started_at`, `repo_head_sha`, `claude_code_version`, plus the fields defined in `episode-schema.md`. Replay uses `repo_head_sha` as the starting commit.
- `prompts.jsonl` — replay feeds these in `turn` order.
- `tools.jsonl` — scoring counts invocations and exit codes.
- `failures.jsonl` — scoring counts unique error signatures.
- `edits.jsonl` — scoring computes added/removed line totals for churn.
- `retrievals.jsonl` — used to compute knowledge-hit rate within the run.

Replay mode reads `meta.json` and `prompts.jsonl`. Scoring reads `tools.jsonl`, `failures.jsonl`, `edits.jsonl`, and `retrievals.jsonl`. The episode schema is authoritative for field shapes.

---

## 4. Run isolation

Every eval run is hermetic. No two runs share state.

1. **Worktree per task.** For each task, the harness materializes a fresh `git worktree` (or extracts the tarball fixture) into `${TMPDIR}/apex-eval/<run-id>/<task-id>/`. The worktree is removed on success unless `--keep-worktrees` is set.
2. **APEX state per profile.** When APEX is on, `${APEX_HOME}` is pointed at a per-run scratch dir (`${TMPDIR}/apex-eval/<run-id>/apex-home/`) seeded by symlinking the project's `.apex/knowledge/` read-only and creating a fresh `.apex/episodes/` and `.apex/index/`. When APEX is off, `APEX_DISABLED=1` is exported and `.claude/hooks/` is shadowed by an empty dir.
3. **Network isolation.** Default `APEX_EVAL_OFFLINE=1` blocks outbound network for the worktree process via the platform's standard mechanism (`unshare -n` on Linux, no-op + lint on macOS — fixtures must vendor deps).
4. **Determinism env vars** set on every Claude Code invocation:
   - `ANTHROPIC_MODEL` — pinned (default `claude-opus-4-7`).
   - `ANTHROPIC_TEMPERATURE=0.0`.
   - `APEX_RANDOM_SEED=<run-id-hash>` — propagated to any APEX-side sampling.
5. **No cross-run contamination.** The harness asserts `git status` is clean in the parent repo before/after a run; any dirty state aborts.

---

## 5. CLI contract — `apex eval`

```
apex eval run     [--mode synthetic|replay|both]
                  [--stack <stack>...]
                  [--tasks <glob>]
                  [--episodes <glob>]
                  [--profile apex-on,apex-off]
                  [--run-id <slug>]      # default: ISO8601 timestamp slug
                  [--budget-multiplier <float>]
                  [--keep-worktrees]
                  [--offline | --online]
                  [--max-parallel <n>]   # default: 1
                  [-o <out-dir>]         # default: .apex/metrics/eval/<run-id>/

apex eval diff    <run-a> <run-b>        # markdown delta to stdout

apex eval report  <run-id>               # re-render report.md from raw results.jsonl

apex eval list                           # table of recent runs
```

**Run output directory layout:**

```
.apex/metrics/eval/<run-id>/
├── manifest.json           # config, seeds, versions, git rev
├── results.jsonl           # one line per task or replay
├── report.md               # human-readable summary (see §6)
├── episodes/               # captured episodes from this run
└── worktrees/              # only if --keep-worktrees
```

**Exit codes:**

| Code | Meaning |
|---|---|
| `0` | All tasks passed AND no regression vs previous run on any aggregate metric |
| `1` | At least one task failed |
| `2` | Regression vs previous run on `run_pass_rate` or `replay_win_rate` |
| `3` | Harness error (fixture missing, worktree failure, timeout exceeded) |
| `4` | Misconfiguration (bad task YAML, unknown stack) |

`apex eval diff` exit codes mirror `0`/`2`/`3`. `apex eval report` exits `0` on success, `3` on missing run.

---

## 6. Report shape

`.apex/metrics/eval/<run-id>/report.md` follows this template. Deltas reference the previous run found by lexical sort of sibling directories under `.apex/metrics/eval/`.

### 6.1 Template

```markdown
# APEX Eval Report — <run-id>

**Generated:** <iso8601>
**Mode:** synthetic | replay | both
**Stacks:** node-ts, python, go, rust
**Claude Code:** <version>   **APEX:** <version>   **Model:** <model>@<temp>
**Compared to:** <previous-run-id> (<iso8601>)

## Headline

| Metric | This run | Previous | Delta |
|---|---:|---:|---:|
| Synthetic pass rate | x / y (z%) | x / y (z%) | ±Δ pp |
| Synthetic weighted score | 0.xx | 0.xx | ±Δ |
| Replay win rate | x / y (z%) | x / y (z%) | ±Δ pp |
| p50 task wall seconds | n | n | ±Δ |
| Total tool calls | n | n | ±Δ |

## Task-level results

| Task | Stack | Result | Δ vs prev | Time (s) | Tool calls | Notes |
|---|---|---|---|---:|---:|---|
| ... | ... | PASS/FAIL | improved/regressed/new | ... | ... | ... |

## Improvements

- **<task-id>**: failed → passed. <one-line cause from logs>.

## Regressions

- **<task-id>**: passed → failed. <one-line cause from logs>.

## Replay deltas (apex-on vs apex-off)

| Episode | Outcome | Δ time-to-first-correct (ms) | Δ edit churn | Δ tool calls |
|---|---|---:|---:|---:|
| ... | win/tie/loss | ... | ... | ... |

## Configuration & reproducibility

- Run seed: <hash>
- Fixtures: <commit>
- Knowledge base @ run start: <count> entries, sha256:<hash>
- Command: `apex eval run --mode both ...`
```

### 6.2 Worked example (3 improvements, 1 regression)

```markdown
# APEX Eval Report — 2026-04-26-1830-eval

**Generated:** 2026-04-26T18:34:12Z
**Mode:** both
**Stacks:** node-ts, python, go, rust
**Claude Code:** 2.4.1   **APEX:** 0.3.0   **Model:** claude-opus-4-7@0.0
**Compared to:** 2026-04-19-1815-eval (2026-04-19T18:19:44Z)

## Headline

| Metric | This run | Previous | Delta |
|---|---:|---:|---:|
| Synthetic pass rate | 7 / 8 (87.5%) | 4 / 8 (50.0%) | +37.5 pp |
| Synthetic weighted score | 0.89 | 0.58 | +0.31 |
| Replay win rate | 3 / 4 (75.0%) | 1 / 4 (25.0%) | +50.0 pp |
| p50 task wall seconds | 142 | 188 | -46 |
| Total tool calls | 612 | 781 | -169 |

## Task-level results

| Task | Stack | Result | Δ vs prev | Time (s) | Tool calls | Notes |
|---|---|---|---|---:|---:|---|
| add-route-health | node-ts | PASS | improved (FAIL→PASS) | 96 | 38 | Knowledge entry `gh-pnpm-not-npm` applied |
| rename-prop-camel | node-ts | PASS | improved (FAIL→PASS) | 154 | 71 | Used codemod pattern from `patterns/ts-rename` |
| fix-failing-pytest | python | PASS | unchanged | 88 | 44 | — |
| add-pydantic-model | python | PASS | improved (FAIL→PASS) | 132 | 59 | Gotcha `python-no-typing-any` retrieved |
| add-cobra-subcommand | go | PASS | unchanged | 121 | 52 | — |
| fix-go-race | go | FAIL | regressed (PASS→FAIL) | 300 | 110 | Hit wall budget; new gotcha proposal queued |
| derive-clone-cargo | rust | PASS | unchanged | 178 | 88 | — |
| async-trait-bound | rust | PASS | unchanged | 211 | 150 | — |

## Improvements

- **add-route-health**: failed → passed. Previous run used `npm install`; APEX retrieved `gh-pnpm-not-npm` (confidence: high) on first prompt and Claude used `pnpm` directly.
- **rename-prop-camel**: failed → passed. Pattern `patterns/ts-rename` provided the codemod recipe; edit churn dropped from 412 → 88 lines.
- **add-pydantic-model**: failed → passed. Gotcha `python-no-typing-any` steered Claude away from `typing.Any` toward concrete `BaseModel` fields.

## Regressions

- **fix-go-race**: passed → failed. Wall-clock budget exhausted at 300s. Trace shows Claude looped on `go test -race` with the same intermittent failure; no APEX entry covered this case yet. **Action:** reflector has queued a `gotchas/go-race-flaky-rngseed` proposal for review.

## Replay deltas (apex-on vs apex-off)

| Episode | Outcome | Δ time-to-first-correct (ms) | Δ edit churn | Δ tool calls |
|---|---|---:|---:|---:|
| 2026-04-21-1f3e-auth-refactor | win | -41,200 | -312 | -22 |
| 2026-04-22-3a09-pnpm-migration | win | -18,900 | -47 | -9 |
| 2026-04-23-7c11-error-boundary | win | -9,400 | -110 | -14 |
| 2026-04-24-9d22-flaky-tests | tie | +1,200 | +0 | -3 |

## Configuration & reproducibility

- Run seed: sha256:8f3a…
- Fixtures: commit a4c12e1
- Knowledge base @ run start: 47 entries, sha256:b9e1…
- Command: `apex eval run --mode both --max-parallel 2`
```

---

## 7. Replay determinism

To keep run-to-run variance bounded:

1. **Model + temperature pinned** via env (`ANTHROPIC_MODEL`, `ANTHROPIC_TEMPERATURE=0.0`). Mismatch is a hard error.
2. **Seed propagation.** A run-id-derived seed is passed to APEX (`APEX_RANDOM_SEED`). Any sampling APEX does (e.g., breaking ties in retrieval) must consume it.
3. **Fixture pinning.** Each task fixture pins a commit hash; fixtures live in `eval/fixtures/<stack>/<repo>/` as bare git repos or tarballs with sha256 manifest.
4. **Tool version pinning.** Required toolchain versions are declared in the fixture's `eval-tools.lock` (e.g., `node@22.5.0`, `pnpm@9.6.0`); harness verifies via `--version` before the task runs and fails fast on mismatch.
5. **Retries policy.** A task is run **once** for the official score. The harness additionally re-runs each failed task **up to 2 times** to compute a `flake_rate = failures / attempts`. If `flake_rate > 0.34` the task is marked `flaky` and excluded from headline pass-rate (counted separately).
6. **Network blocked by default.** Fixtures vendor all deps. Any network attempt is logged and counted as a determinism violation.
7. **Wall-clock cap.** `budget.wall_seconds` (default 300) and `budget.max_tool_calls` (default 80) are hard limits; hitting either is a fail with reason `budget_exceeded`.

---

## 8. Eval task starter set (8 tasks, 2 per stack)

| ID | Stack | Description | Headline success criterion |
|---|---|---|---|
| `add-route-health` | node-ts | Add a `GET /health` Express route returning `{"status":"ok"}` | `pnpm test -- health.test.ts` passes |
| `rename-prop-camel` | node-ts | Rename `user_name` → `userName` across a 6-file React component tree, including tests | `pnpm typecheck && pnpm test` passes; no `user_name` remains |
| `fix-failing-pytest` | python | A single failing pytest in a 3-test suite must be fixed without modifying the test | `pytest -q` exits 0; test file diff is empty |
| `add-pydantic-model` | python | Add a `User` Pydantic v2 model with email validation and a parsing test | `pytest tests/test_user.py` passes; `pyproject.toml` deps unchanged |
| `add-cobra-subcommand` | go | Add a `version` subcommand to a Cobra CLI printing semver from a const | `go test ./...` passes; `go run . version` prints `1.0.0` |
| `fix-go-race` | go | Fix a data race in a small worker pool flagged by `-race` | `go test -race ./...` passes |
| `derive-clone-cargo` | rust | Add `#[derive(Clone, Debug)]` to a struct so a downstream call compiles | `cargo test` passes; `cargo clippy -- -D warnings` clean |
| `async-trait-bound` | rust | Fix a missing `Send + 'static` bound on an async trait method | `cargo test --features tokio` passes |

These are the floor for Phase 1 CI; Phase 4 expands per-stack to 10–30 (PRD §6.4.1).

---

## 9. Phase gate hookup

| Eval mode / artifact | Validates exit criterion |
|---|---|
| `apex eval run --mode synthetic` (full pass) | **Phase 1** (§6.1) "two sessions visibly improves on session three" — synthetic regression catches knowledge-base breakage on every commit. |
| Replay mode aggregate `replay_win_rate` ≥ 0.6 over a 30-task workload | **Phase 2** (§6.2) "repeat-mistake rate is measurably lower than after Phase 1, with no manual knowledge editing." |
| Synthetic `run_p50_latency` regression budget + retrieval latency emitted alongside | **Phase 3** (§6.3) "P50 retrieval latency < 50ms (tier 1), < 200ms (tier 2). Top-5 retrieval relevance ≥ 0.7 on the eval harness." |
| `apex eval diff <week-1> <week-4>` showing ≥15% reduction in repeat-mistake rate (sourced from `metrics.md` §10.1) | **Phase 4** (§6.4) "Eval harness shows ≥15% reduction in repeat-mistake rate at week 4 vs week 1." |
| Plugin-installed APEX produces a green eval run on a fresh repo | **Phase 5** (§6.5) "A second team installs APEX … and ships a knowledge pack PR within a week." |

---

## 10. Out of scope (Phase 0)

- Adversarial / red-team tasks.
- LLM-as-judge scoring (every criterion is mechanical).
- Cross-stack tasks (each task pins one `stack`).
- Cost / token-spend metrics — tracked in `metrics.md`, not here.
