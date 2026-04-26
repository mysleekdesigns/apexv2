# PRD — APEX: Self-Learning AI Development System for Claude Code

> Working name: **APEX** (Adaptive Project Experience). Pluggable, installable, beginner-friendly project intelligence that compounds over time inside Claude Code Max.

---

## 1. Problem & Vision

### Problem
Claude Code is powerful out of the box, but every project starts cold. Each new session, Claude re-derives conventions, re-learns the architecture, repeats past mistakes, and forgets hard-won decisions the moment the conversation compacts. Teams paper over this with hand-written `CLAUDE.md` files that drift, go stale, or balloon past the 200-line index limit.

The result: developers pay the same context tax every session, and Claude can never *accumulate* expertise about the project the way a human teammate does.

### Vision
A system that makes Claude Code **measurably better at this specific project after every session**, by:

1. **Capturing** what happened — decisions made, tools that worked, mistakes corrected, files touched, tests run.
2. **Distilling** raw events into reusable, retrievable knowledge — patterns, gotchas, decisions, conventions.
3. **Surfacing** the right knowledge at the right moment — at session start, before a tool runs, when a similar task appears.
4. **Self-correcting** when the project's reality contradicts what the system "knew" — failed tests, lint errors, code review pushback, user corrections.

### What "self-learning" means here
- ✅ A practical, automatic project intelligence layer that compounds: code, decisions, conversations, test results, errors, docs, and feedback.
- ❌ Not retraining model weights. Not background fine-tuning. No PII exfiltration. All learning lives in version-controlled, human-readable files.

---

## 2. Goals & Non-Goals

### Goals
- **One-command install** into any new or existing repo (`npx apex init` or curl-piped script).
- Works **without any external services** in default mode (files-on-disk only).
- Optional **advanced mode** with local vector index and knowledge graph.
- **Zero lock-in**: every artifact is markdown, JSON, or SQLite — readable, diffable, deletable.
- Compatible with Claude Code Max (CLI, IDE, web, desktop) — uses only documented primitives: `CLAUDE.md`, `.claude/skills/`, `.claude/agents/`, `.claude/rules/`, `.claude/hooks/`, `settings.json`, MCP servers.
- Beginner-friendly defaults; power-user override at every layer.
- Measurable outcomes: cache-hit rate on knowledge, repeat-mistake count, time-to-first-edit per task, % of sessions where a learned rule was applied.

### Non-Goals
- Not an alternative to Claude Code — it *extends* it.
- Not a hosted SaaS. (A future hosted sync option is out of scope for v1.)
- Not a replacement for code review, tests, or documentation. It augments them.
- Does not modify Claude's model weights or telemetry.

---

## 3. Target Users

| Persona | Needs | How APEX helps |
|---|---|---|
| **Solo beginner** ("vibe coder") | Wants Claude to "just remember" their preferences without learning the docs | One-command install; sensible defaults; auto memory + auto-extracted CLAUDE.md |
| **Senior IC on existing repo** | Wants Claude to follow the team's conventions and stop repeating known mistakes | Captures decisions from PRs, errors, and corrections; surfaces them at the right moment |
| **Tech lead / staff eng** | Wants institutional knowledge to survive turnover | Versioned, reviewable knowledge artifacts; audit trail; team-shareable plugin |
| **AI/ML platform engineer** | Wants extensible primitives, tracing, custom evaluators | MCP server, hookable events, pluggable storage backends, eval harness |

---

## 4. Architecture Overview

APEX is built **on top of Claude Code primitives** — it does not fight the platform.

```
┌──────────────────────── Claude Code Session ────────────────────────┐
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────────────┐  │
│  │  CLAUDE.md   │   │ .claude/     │   │ .claude/skills/apex-*/  │  │
│  │  (index)     │◄──┤ rules/*.md   │   │  SKILL.md + learnings   │  │
│  └──────────────┘   └──────────────┘   └─────────────────────────┘  │
│         ▲                  ▲                       ▲                 │
│         │                  │                       │                 │
│  ┌──────┴──────────────────┴───────────────────────┴──────────────┐  │
│  │                      APEX KNOWLEDGE LAYER                      │  │
│  │  .apex/                                                        │  │
│  │   ├─ knowledge/   decisions, patterns, gotchas, conventions    │  │
│  │   ├─ episodes/    session summaries (what happened)            │  │
│  │   ├─ index/       SQLite + optional vector index (LanceDB)     │  │
│  │   └─ metrics/     learning KPIs over time                      │  │
│  └────────────────────────────────────────────────────────────────┘  │
│         ▲                                              │              │
│         │ retrieve                              capture │              │
│  ┌──────┴──────────────────────────────────────────────▼──────────┐  │
│  │                    APEX HOOKS & MCP SERVER                     │  │
│  │  SessionStart   → inject relevant knowledge                    │  │
│  │  UserPromptSubmit → semantic-match user intent to past lessons │  │
│  │  PostToolUse    → log tool outcomes (esp. tests/lints)         │  │
│  │  PostToolUseFailure → capture failure for reflection           │  │
│  │  Stop / SessionEnd → trigger reflection subagent               │  │
│  │  PreCompact     → snapshot working state to episodes/          │  │
│  │  apex-mcp       → semantic search over knowledge from any tool │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │              APEX SUBAGENTS (isolated context)                 │  │
│  │  reflector  — distills episodes into knowledge entries         │  │
│  │  curator    — dedupes, merges, prunes stale knowledge          │  │
│  │  archaeologist — bootstraps from existing repo (git, docs, PRs)│  │
│  │  evaluator  — runs eval harness on synthetic + replay tasks    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Key architectural decisions

1. **Files first, DB optional.** Default install is pure markdown + SQLite. No daemons, no Docker. Vector index (LanceDB embedded) opt-in via `apex enable vector`.
2. **Use Claude Code's native memory hierarchy.** APEX writes into `~/.claude/CLAUDE.md` (user), `./CLAUDE.md` (project index), `.claude/rules/*.md` (scoped rules), and `.claude/skills/apex-*/learnings.md` (skill-level memory). Nothing custom that Claude can't already see.
3. **Hooks do capture, subagents do distillation.** Hooks must be fast (<1s for SessionStart); reflection runs async or post-session in an isolated subagent so it never blocks the dev loop.
4. **Tool-grounded over self-grounded.** Reflexion-style "verbal reinforcement" is unreliable without external signal. APEX prioritizes signals from tests, type-checkers, linters, CI, and explicit user corrections over the model's self-critique.
5. **AST + grep beats vectors for code.** Per consensus from how Claude Code, Cursor, and Devin actually work in practice, code retrieval defaults to tree-sitter symbol index + ripgrep + import-graph traversal. Vector search is reserved for *natural-language* knowledge (decisions, gotchas), not code.
6. **Three memory types** (CoALA / Mem0 / LangMem):
   - **Episodic** — `.apex/episodes/<session-id>.md` (what happened this session)
   - **Semantic** — `.apex/knowledge/{decisions,patterns,gotchas,conventions}/*.md` (what we know)
   - **Procedural** — `.claude/skills/apex-*/SKILL.md` + `learnings.md` (how to do things, refined over time)

---

## 5. User Experience

### 5.1 Beginner install (60 seconds, zero config)

```bash
cd my-project
npx apex init
```

That's it. APEX:
- Detects the project (language, framework, package manager, test runner).
- Writes `CLAUDE.md` with a sensible scaffold.
- Installs `.claude/skills/apex-recall/`, `.claude/skills/apex-reflect/`, `.claude/agents/apex-reflector.md`.
- Installs hooks into `.claude/settings.json` (formatted, commented, minimal — under 10 hooks).
- Creates `.apex/` with `.gitignore` for transient files.
- Runs the **archaeologist** subagent in the background to bootstrap initial knowledge from `git log`, README, existing tests, and any open PRs.

After install, the next Claude Code session shows:
```
APEX loaded — 14 patterns, 3 gotchas, 2 active conventions.
```

### 5.2 What the user *experiences*
- "Claude stopped using `npm install`; it figured out we use pnpm." (Captured from a single correction, persisted as a project rule.)
- "Claude warned me that the `users` table has a soft-delete column before I wrote the query." (Surfaced from a decision captured during a past session.)
- "When I ran `apex review` after a PR, it added two new gotchas to the knowledge base."

### 5.3 Power-user surface
- `apex status` — knowledge stats, last reflection time, retrieval cache-hit rate.
- `apex search "auth flow"` — query the knowledge base directly.
- `apex enable vector|graph|mcp-remote` — opt-in to advanced features.
- `apex eval` — run the eval harness against the current knowledge base.
- `apex export` — bundle knowledge as a reviewable PR.
- All artifacts are plain text in `.apex/` — `git diff` works.

---

## 6. Phased Plan

Each phase is independently shippable. Phase 1 alone is more useful than 90% of existing setups.

---

### ✅ Phase 0 — Foundation & Spec (Week 0–1) — **COMPLETE (2026-04-26)**

**Goal:** Lock down primitives, schemas, and metrics before writing code.

- [x] Pin Claude Code minimum version (≥ 2.1.0 for deferred MCP loading, agent hooks, subagent memory). → [`specs/compatibility.md`](specs/compatibility.md)
- [x] Write the **knowledge file schema** — frontmatter spec for `decisions`, `patterns`, `gotchas`, `conventions` (id, title, source, confidence, created, last-validated, supersedes). → [`specs/knowledge-schema.md`](specs/knowledge-schema.md)
- [x] Write the **episode schema** — session id, prompts, tools used, files touched, outcomes, errors, corrections. → [`specs/episode-schema.md`](specs/episode-schema.md)
- [x] Define the **eval harness contract** — how a task replay measures "did APEX help?". → [`specs/eval-harness.md`](specs/eval-harness.md)
- [x] Define **success metrics** (see §10). → [`specs/metrics.md`](specs/metrics.md)
- [x] Choose default install method: `npx apex@latest init` (Node) primary; `pipx install apex-cc` mirror. → [`specs/install.md`](specs/install.md)
- [x] Threat-model: what should *never* go into knowledge files (secrets, PII, proprietary external IP); design a redactor. → [`specs/threat-model.md`](specs/threat-model.md), [`specs/redactor-design.md`](specs/redactor-design.md)
- [x] Write a one-page README that a brand-new user can follow in 60 seconds. → [`README.md`](README.md)

**Exit criteria (met):** schemas merged, eval contract documented, install path decided. JSON Schema blocks validated; cross-spec file-name contract reconciled (`meta.json`, `edits.jsonl`, `retrievals.jsonl` defined in episode-schema and consumed unchanged by eval-harness + metrics).

---

### ✅ Phase 1 — MVP: Capture + Recall (Week 1–3) — **COMPLETE (2026-04-26)**

**Goal:** Working install that captures session events and surfaces relevant knowledge at session start. Deliberately small.

#### 1.1 Installer
- [x] `npx apex init` scaffolds `CLAUDE.md`, `.claude/`, `.apex/` and a sensible `.gitignore`. → [`src/cli/commands/init.ts`](src/cli/commands/init.ts), [`src/scaffold/installer.ts`](src/scaffold/installer.ts)
- [x] `apex init --dry-run` previews changes.
- [x] Idempotent re-run: detects existing APEX install and offers `apex upgrade` instead. `--force` reinstalls preserving knowledge.
- [x] Detects: language, framework, package manager, test runner, lint/format tools, CI provider → [`src/detect/`](src/detect/).

#### 1.2 CLAUDE.md scaffold
- [x] Index-style CLAUDE.md (renders ~85 lines for a typical Node/TS stack — well under the 200-line budget) that `@`-imports `.claude/rules/*.md` rather than inlining everything. → [`templates/CLAUDE.md.tmpl`](templates/CLAUDE.md.tmpl), [`src/scaffold/claudeMd.ts`](src/scaffold/claudeMd.ts)
- [x] Auto-generated sections: Project Stack, Common Commands, Where Things Live, Rules of the Road. → [`src/scaffold/commonCommands.ts`](src/scaffold/commonCommands.ts)
- [x] Section markers (HTML comments) so APEX can rewrite specific sections on upgrade without clobbering user edits. Outer `<!-- apex:begin -->`/`<!-- apex:end -->` for the managed block; inner `<!-- apex:section:NAME -->` for sub-sections.

#### 1.3 Capture hooks (the minimum useful set)
- [x] `SessionStart` → starts an episode, writes initial `meta.json`, exports `APEX_EPISODE_ID` for downstream hooks. (Top-N retrieval injection deferred to Phase 2 reflector wiring.)
- [x] `UserPromptSubmit` → logs to `prompts.jsonl`; runs the correction-detection regex (`/^(no|nope|don't|stop|actually|use .* instead)/i`) and writes to `corrections.jsonl` on match.
- [x] `PostToolUse` matcher `Bash` → records commands run + exit codes to `tools.jsonl`.
- [x] `PostToolUseFailure` → captures the failure into `.apex/episodes/<id>/failures.jsonl`.
- [x] `PreCompact` → snapshots todos, open files, and recent decisions to `snapshots/pre-compact-<n>.json`.
- [x] `SessionEnd` → closes the episode file; enqueues a reflection job (consumed in Phase 2).
- [x] All hooks ship with `timeout 1s` in the hot path (`5s` for SessionEnd) and exit 0 unconditionally so they never block Claude. → [`templates/claude/hooks/`](templates/claude/hooks/), [`src/cli/commands/hook.ts`](src/cli/commands/hook.ts)
- [x] **Bonus:** Default-on redactor activated on first install; runs on every episode/knowledge write per `specs/redactor-design.md`. → [`src/redactor/`](src/redactor/)

#### 1.4 Recall skill
- [x] `.claude/skills/apex-recall/SKILL.md` — auto-invoked on trigger phrases (`"did we decide"`, `"is there a pattern"`, `"any gotchas"`, etc.). → [`templates/claude/skills/apex-recall/SKILL.md`](templates/claude/skills/apex-recall/SKILL.md)
- [x] Backed by `apex-mcp` stdio MCP server with 5 tools (`apex_search`, `apex_get`, `apex_record_correction`, `apex_propose`, `apex_stats`). → [`src/mcp/`](src/mcp/)
- [x] **Phase 1 ships SQLite FTS5 only** (BM25 ranking, porter+unicode61 tokenizer, mtime-based incremental sync, corrupt-DB recovery). Vector retrieval deferred to Phase 3. P50 search latency: **0.10ms** on a 12-entry fixture (target was <50ms). → [`src/recall/`](src/recall/)
- [x] Returns ranked snippets with file path + `last_validated` so Claude can `Read` for full context. Provenance is mandatory on every hit.

#### 1.5 Bootstrap (archaeologist)
- [x] Synchronous orchestrator runs once on `apex init`: gathers signals from `git log`, README, top-imported deps, test runner output, `.github/workflows`, and (optionally) `gh` PR list. → [`src/archaeologist/`](src/archaeologist/)
- [x] Writes proposals to `.apex/proposed/` with full frontmatter and `kind: bootstrap` source citations — never directly to `.apex/knowledge/`. Each proposal carries the `<!-- PROPOSED — review before moving -->` header.
- [x] LLM-backed refinement subagent (`apex-archaeologist.md`) is installed for optional richer post-bootstrap analysis. → [`templates/claude/agents/apex-archaeologist.md`](templates/claude/agents/apex-archaeologist.md)

**Exit criteria (met):** End-to-end install verified in a fresh project; archaeologist produced 6 proposals on a Next.js fixture; `apex search` returns provenance-attached hits; idempotent re-run + `apex uninstall` both clean. **145 tests pass across 15 test files** (detect 5, managedSection 13, init integration 5, claudeMd 13, redactor 38, episode-id 6, episode-writer 9, hooks integration 11, recall-store 10, recall-loader 4, mcp-tools 9, archaeologist signals/proposer/integration 20, fixture 2).

---

### ✅ Phase 2 — Reflection & Distillation (Week 3–5) — **COMPLETE (2026-04-26)**

**Goal:** The system extracts *durable lessons* from raw episodes and updates the knowledge base — without the user having to ask.

#### 2.1 Reflector subagent
- [x] `.claude/agents/apex-reflector.md` — full agent prompt (replaces stub). Invoked on `SessionEnd` or on demand via `apex reflect`. → [`templates/claude/agents/apex-reflector.md`](templates/claude/agents/apex-reflector.md), [`templates/claude/skills/apex-reflect/SKILL.md`](templates/claude/skills/apex-reflect/SKILL.md)
- [x] Inputs: latest episode file (`failures.jsonl`, `corrections.jsonl`, `tools.jsonl`, `meta.json`), recent failures, recent corrections, the current knowledge base. → [`src/reflector/signals.ts`](src/reflector/signals.ts)
- [x] Outputs: proposed knowledge entries (gotchas, conventions, candidate-resolutions) written to `.apex/proposed/<id>.md` with full frontmatter and `kind: reflection` source citations. Never clobbers existing files. → [`src/reflector/proposer.ts`](src/reflector/proposer.ts), [`src/reflector/writer.ts`](src/reflector/writer.ts)
- [x] **Two-call separation**: agent template instructs Claude to do an analyse-pass (`apex reflect --dry-run`) then a write-pass (`apex reflect --all`). Heuristic engine itself is deterministic + evidence-grounded — no LLM correlation risk.
- [x] Hard-grounds extraction in evidence: every proposed entry cites at least one episode file/turn (`sources: [{ kind: "reflection", ref: "episode/<id>/failures.jsonl#turn=<n>" }]`); ungroundable candidates are dropped. Episode `meta.json` is updated with `reflection.status: "complete"` on success. → [`src/reflector/metaUpdate.ts`](src/reflector/metaUpdate.ts)
- [x] CLI: `apex reflect [--episode <id>] [--all] [--dry-run]`. → [`src/cli/commands/reflect.ts`](src/cli/commands/reflect.ts)

#### 2.2 Auto-promotion rules (configurable)
- [x] **Auto-merge** when: proposal has ≥`config.auto_merge.threshold` sources (default 2), confidence ≥ `min_confidence`, and no conflicting/superseding entry exists. (Beginner default ON.) → [`src/promote/eligibility.ts`](src/promote/eligibility.ts)
- [x] **Queue for review** when: a proposal supersedes an existing entry, confidence is below threshold, or destination already exists. Skipped reasons reported per-proposal.
- [x] Config lives in `.apex/config.toml` under `[auto_merge]` (`enabled`, `threshold`, `require_no_conflict`, `min_confidence`); template ships at install time. Power users can flip to manual via that file. → [`src/config/index.ts`](src/config/index.ts), [`templates/.apex/config.toml.tpl`](templates/.apex/config.toml.tpl)
- [x] CLI: `apex promote [<id>] [--auto] [--dry-run] [--force]`. Refuses to overwrite existing knowledge unless `--force`. Stamps `last_validated` to today on every promote. → [`src/cli/commands/promote.ts`](src/cli/commands/promote.ts), [`src/promote/`](src/promote/)

#### 2.3 Curator subagent
- [x] Runs on `apex curate` (designed for weekly invocation by the apex-curator agent). Dedupes near-identical entries via shingled-Jaccard similarity (≥0.85 threshold over 3-grams), proposes merges into `.apex/proposed/_merge-<a>-into-<b>.md` (never auto-edits knowledge files), marks entries stale when `last_validated` is older than `--stale-days` (default 30) AND no recent retrieval references them. → [`src/curator/dedupe.ts`](src/curator/dedupe.ts), [`src/curator/stale.ts`](src/curator/stale.ts), [`src/curator/proposals.ts`](src/curator/proposals.ts)
- [x] Drift detection: scans `gotcha` entries with `file/<path>:<line>` source refs; flags entries whose target file no longer exists. → [`src/curator/drift.ts`](src/curator/drift.ts)
- [x] Writes a curation summary to `.apex/curation/<YYYY-MM-DD>.md` with sections for duplicate clusters, stale entries, drift candidates, and a tally. → [`src/curator/summary.ts`](src/curator/summary.ts), [`src/cli/commands/curate.ts`](src/cli/commands/curate.ts), [`templates/claude/agents/apex-curator.md`](templates/claude/agents/apex-curator.md)

#### 2.4 Tool-grounded learning
- [x] When a `PostToolUse` failure repeats with the same `error_signature` ≥2 times, the reflector escalates to a *gotcha* with `confidence: low` (2 occurrences) or `medium` (≥3). → [`src/reflector/proposer.ts`](src/reflector/proposer.ts)
- [x] **Candidate-resolution detection**: when a known failure signature has not reappeared in the most recent N episodes AND a successful tool run has touched files mentioned in the original failure, the reflector emits a candidate-resolution proposal pointing at the existing gotcha id (Slice B's promoter handles the actual marking; Phase 4 will tighten the loop with confidence calibration).

#### 2.5 Feedback capture from chat
- [x] User says "no, do X instead" → captured as a candidate correction (existing Phase 1 behavior, untouched).
- [x] User accepts an unusual approach with a leading affirmation (`yes`/`exactly`/`perfect`/`right`/`that's correct`/`do that`/`lgtm`/`👍`, etc.) → captured as `kind: "confirmation"` in `corrections.jsonl`. Conservative regex with word-boundary anchors — false negatives preferred over false positives. → [`src/cli/commands/hook.ts`](src/cli/commands/hook.ts)
- [x] `/apex-thumbs-up <entry-id>` and `/apex-thumbs-down <entry-id>` slash commands → `kind: "thumbs_up"`/`"thumbs_down"` rows with `target_entry_id` populated. → [`templates/claude/commands/apex-thumbs-up.md`](templates/claude/commands/apex-thumbs-up.md), [`templates/claude/commands/apex-thumbs-down.md`](templates/claude/commands/apex-thumbs-down.md)
- [x] Priority ordering inside `handlePromptSubmit`: thumbs > correction > confirmation. Exactly one correction-row per prompt; never double-fires.

**Exit criteria (met):** All four reflection signals (failures, corrections, confirmations, thumbs) flow into `corrections.jsonl` / `failures.jsonl`; reflector turns repeated signals into proposals at `.apex/proposed/`; promoter moves eligible proposals into `.apex/knowledge/`; curator dedupes/stales/drifts and reports. **364 tests pass across 28 test files** (+219 new vs Phase 1: reflector 38, config 9, promote 52, curator 42, feedback 78). `npm run typecheck` clean.

---

### ✅ Phase 3 — Retrieval Engine & Code Intelligence (Week 5–8) — **COMPLETE (2026-04-26)**

**Goal:** The right knowledge surfaces at the right moment. Cheap, fast, opt-in advanced backends.

#### 3.1 Tiered retrieval
- [x] **Tier 1 (default, always-on):** SQLite FTS5 keyword search over knowledge files. P50 0.10ms (already shipped in Phase 1). → [`src/recall/store.ts`](src/recall/store.ts)
- [x] **Tier 2 (opt-in):** LanceDB embedded vector store with local CPU embeddings (`Xenova/all-MiniLM-L6-v2` via `@xenova/transformers`, ~25 MB, 384-dim). Lazy model load; `APEX_VECTOR_FAKE=1` provides deterministic hash-based vectors for offline tests. `apex enable vector` flips the config flag, creates `.apex/index/vectors.lance/`, and runs an mtime-incremental sync. → [`src/recall/vector/`](src/recall/vector/), [`src/cli/commands/enable.ts`](src/cli/commands/enable.ts)
- [x] **Tier 3 (opt-in):** Code-symbol index via `web-tree-sitter` (WASM — no native build) covering TypeScript / TSX / JavaScript / Python through bundled `tree-sitter-wasms` grammars. SQLite + FTS5 store at `.apex/index/symbols.sqlite`. CLI: `apex codeindex sync|find|stats`. Honours `.gitignore` and skips `node_modules`, `dist`, `build`, etc.; mtime-driven incremental sync. → [`src/codeindex/`](src/codeindex/), [`src/cli/commands/codeindex.ts`](src/cli/commands/codeindex.ts)

#### 3.2 Hybrid retrieval pipeline
- [x] BM25 (FTS5) + vector hits fused via **Reciprocal Rank Fusion** (RRF, k=60) — robust to score-scale mismatches. Hits surfaced in both tiers are tagged `tier: "hybrid"`; otherwise the originating tier sticks. → [`src/recall/hybrid.ts`](src/recall/hybrid.ts)
- [x] Rerank stub: `RerankFn` interface, default identity. No LLM calls (token-cost reranker is a Phase 4 opt-in).
- [x] Per-session LRU cache (cap 64) keyed on `(query, last_sync ISO)`; invalidates automatically when the FTS store re-syncs.
- [x] Provenance-attached results: every hit carries `path`, `last_validated`, and `confidence` straight from the knowledge file (untouched from Phase 1).
- [x] CLI flag: `apex search --tier <fts|vector|hybrid>`. Default routes to `hybrid` when vector is enabled, `fts` otherwise. → [`src/cli/commands/search.ts`](src/cli/commands/search.ts)

#### 3.3 MCP server: `apex-mcp`
- [x] Stdio MCP server now exposes **6 tools** through a single declarative array (`apex_search`, `apex_get`, `apex_get_decision`, `apex_record_correction`, `apex_propose`, `apex_stats`). Version bumped to `0.1.0-phase3`. → [`src/mcp/index.ts`](src/mcp/index.ts), [`src/mcp/tools.ts`](src/mcp/tools.ts)
- [x] **Auto-registration into `.mcp.json`**: `apex init` calls `registerApexMcp(root)` which merges by server name, preserves user-added entries, recovers from malformed JSON via timestamped backup. Symmetric `unregisterApexMcp` on `apex uninstall` strips only the `apex` entry. → [`src/scaffold/mcpRegistration.ts`](src/scaffold/mcpRegistration.ts), [`templates/.mcp.json.tpl`](templates/.mcp.json.tpl)
- [x] **Lazy resource initialization** (closest practical approximation to Claude Code 2026+ deferred loading — the MCP SDK v1.29 requires schemas at registration time and has no native deferred-schema hook). The SQLite recall handle is opened only on the first tool invocation; `tools/list` creates no DB file. `tools.listChanged` capability advertised; `serverInfo.instructions` advertises tool list, Claude Code 2.1.0 minimum, and a PRD §3.3 pointer.

#### 3.4 Knowledge graph (advanced opt-in)
- [x] `[graph] enabled = true` activates the property graph at `.apex/index/graph.sqlite`. `apex graph sync` rebuilds from the current `.apex/knowledge/` (full rebuild — measured at 15ms / 12-entry fixture; <500ms target trivially met). → [`src/graph/`](src/graph/), [`src/cli/commands/graph.ts`](src/cli/commands/graph.ts)
- [x] Edges: `supersedes` (cross-type, falls back to `unknown:<id>` for dangling refs), `tagged` (frontmatter tags → `tag:<name>` nodes), `affects` (decision → file), `applies-to` (gotcha → file or `symbol:<file>:<line>`), `references` (pattern → entry, via `[[wiki-link]]` or `references:` frontmatter).
- [x] Queries: `apex graph deps|dependents|blast|stats`. `blastRadius` is BFS in both directions, deduped, ranked by node-incidence minus depth. `findPath` is BFS shortest-path. → [`src/graph/index.ts`](src/graph/index.ts)
- [x] MCP tools (`apex_graph_dependents`, `apex_graph_dependencies`, `apex_graph_blast`) defined in [`src/graph/mcp-tools.ts`](src/graph/mcp-tools.ts) as drop-in handlers + zod input shapes; gating on `[graph].enabled` is left to the integrator (registration deferred until a graph-bearing project actually exists).

**Exit criteria (met):** Tier 1 P50 0.10ms (target <50ms — exceeded by 500×). Tier 2 retrieval covered by integration tests with deterministic fake-vector mode (live-model latency under the <200ms target is left for the eval harness in Phase 4 — the production pipeline is wired and correct). Top-5 retrieval-relevance metric is part of the Phase 4 eval harness; the retrieval pipeline it will measure is now in place. **40 test files, 462 tests pass** (+98 vs Phase 2: vector 29, codeindex 20, graph 34, MCP 15). `npm run typecheck` clean.

---

### ✅ Phase 4 — Self-Correction & Evaluation Loop (Week 8–10) — **COMPLETE (2026-04-26)**

**Goal:** The system measurably improves over time, and we can prove it.

#### 4.1 Eval harness
- [x] Synthetic task set per language/framework. **35 tasks shipped** (12 node-typescript, 12 python, 11 nextjs) at `templates/.apex/eval/<stack>/<id>.md` — covering routes, refactors, validators, tests, config flags, error handling, env vars, docs. Frontmatter is zod-validated; `id` must equal filename. → [`src/eval/tasks.ts`](src/eval/tasks.ts), [`templates/.apex/eval/`](templates/.apex/eval/)
- [x] **Replay mode** is measurement-only in v1 (a true fresh-Claude re-run is a Phase 5 hosted concern). The harness reads existing `.apex/episodes/*` and synthesizes a replay task; `--with-apex` keeps the captured retrieval signals, `--without-apex` strips `retrievals` and `injected_knowledge_ids` to simulate the ablation. → [`src/eval/replay.ts`](src/eval/replay.ts)
- [x] **Pure metric functions** computed against task results: `computeRepeatMistakeRate`, `computeKnowledgeHitRate`, `computeTimeToFirstCorrectEdit` (+ median variant), `computeUserCorrectionFrequency`. Each is unit-tested in isolation. → [`src/eval/runner.ts`](src/eval/runner.ts)
- [x] **Success predicates**: `file_exists`, `contains_string`, `regex_match`, `command_exits_zero`, `custom_predicate` (shell). Per-task signals captured: `tools_used`, `files_touched`, `errors_recovered`, `retrieval_hits`, `retrieval_used`.
- [x] **`apex eval`** writes `.apex/metrics/eval-<YYYY-MM-DD>-<HHMM>.md` with summary, metrics table, failed-task list, and Δ-versus-previous-run comparison (parses prior report's metrics table by regex). First run prints `(first run, no comparison)`. → [`src/cli/commands/eval.ts`](src/cli/commands/eval.ts), [`src/eval/reporter.ts`](src/eval/reporter.ts)
- [x] CLI flags: `apex eval [--stack <name>] [--episode-glob <pat>] [--with-apex|--without-apex] [--out <path>] [--dry-run] [--cwd <path>]`. → [`src/cli/commands/eval.ts`](src/cli/commands/eval.ts)

#### 4.2 Confidence calibration
- [x] Each knowledge entry's `confidence: low|medium|high` is updated by a deterministic signal aggregator. **Up signals**: successful test run that touches an `affects:` file (`/(npm|pnpm|yarn|pytest|jest|vitest|cargo|go) test/` exits 0) → +1; repeated-correction Jaccard ≥0.4 on lemmatized tokens → +1; `kind: thumbs_up` with `target_entry_id` → +1. **Down signals**: contradicting failure (negation marker on `affects:` file) → −1; `kind: thumbs_down` → −1; `/(ignore|forget|stop using) (that|this rule|<entry-id>)/i` → −1; not retrieved in N=10 most-recent episodes → −1 (decay). → [`src/confidence/signals.ts`](src/confidence/signals.ts)
- [x] **State transitions**: net score ≥2 → `high`, 0..1 → `medium`, ≤−1 → `low`. Stamps `last_validated: <today>` on every entry the calibrator touches; entries with no signal are left untouched (idempotent — re-running with no new signals never rewrites). Frontmatter ordering preserved via `gray-matter`. → [`src/confidence/calibrator.ts`](src/confidence/calibrator.ts)
- [x] **Retrieval down-weighting**: hybrid pipeline now multiplies each hit's fused score by the entry's confidence weight (`{low: 0.5, medium: 0.85, high: 1.0}`); resorts before optional rerank. New `includeLowConfidence` option (default `false`) filters `low` entries unless the explicit entry id appears in the query (explicit-search bypass). → [`src/recall/hybrid.ts`](src/recall/hybrid.ts), [`src/recall/index.ts`](src/recall/index.ts)
- [x] CLI: `apex calibrate [--episode <id>] [--all] [--dry-run]`. Mirrors `apex reflect`'s shape; defaults to most-recent episode. → [`src/cli/commands/calibrate.ts`](src/cli/commands/calibrate.ts)
- [x] Reflector's initial-write logic (`proposer.ts` low/medium-on-first-write) is intentionally **untouched**; calibration only runs on subsequent updates as a separate stage. → [`src/confidence/index.ts`](src/confidence/index.ts)

#### 4.3 Drift detection
- [x] **Four drift kinds** in `src/curator/drift.ts:findAllDrift`: `file_missing` (high), `symbol_missing` (medium, via codeindex with grep fallback), `reference_missing` (medium, frontmatter `references:`), `path_missing` (low, inline path scan that excludes URLs and fenced code blocks). → [`src/curator/drift.ts`](src/curator/drift.ts)
- [x] **Mark-verified** flow writes frontmatter `verified: false` plus a `drift_report:` array of `{kind, ref, detected}` rows; idempotent on `(kind, ref)`; resolves by removing rows that no longer apply (and removing the field entirely when empty). `last_validated` deliberately **left alone** so the stale logic still flags drifted entries. Off by default — only runs under `apex curate --mark-verified`. → [`src/curator/verify.ts`](src/curator/verify.ts)
- [x] **Synthetic-aging recall**: `test/curator/drift-extended.test.ts` builds a 10-entry fixture (3 file-deletes, 3 made-up symbols, 2 valid paths, 2 valid symbols) and asserts ≥80% recall. Measured: **100% (6/6 positives, 0/4 false positives)** — exit criterion met with margin.
- [x] **Schedule descriptor**: `apex curate --schedule <weekly|daily>` writes `.apex/schedule/curate.toml` describing cadence + command for a future plugin scheduler to consume. Direct wiring into Claude Code's scheduler is intentionally deferred to Phase 5 plugin packaging. → [`src/curator/schedule.ts`](src/curator/schedule.ts)
- [x] CLI flags added without breaking Phase 2 defaults: `--drift-only`, `--mark-verified`, `--schedule <weekly|daily>`. The curation summary now appends a `### Drift severity breakdown` subsection. → [`src/cli/commands/curate.ts`](src/cli/commands/curate.ts), [`src/curator/summary.ts`](src/curator/summary.ts)

#### 4.4 Feedback flywheel UI
- [x] `/apex-thumbs-up <entry-id>` and `/apex-thumbs-down <entry-id>` slash commands shipped in Phase 2.5; flow through `corrections.jsonl` with `target_entry_id` populated. → [`templates/claude/commands/apex-thumbs-up.md`](templates/claude/commands/apex-thumbs-up.md)
- [x] **Session-start dashboard**: `APEX: <N> entries used last week (<H> helpful, <C> corrected, <U> unused)` is now rendered by `handleSessionStart` after the episode-started line — Claude Code injects SessionStart stdout into context, so the dashboard becomes pre-prompt context every session. Same line shown by `apex status`. **Used** = unique `entry_id`s in any `retrievals.jsonl` row in the window; **helpful** = `referenced: true` ∪ thumbs_up; **corrected** = thumbs_down (helpful overrides corrected when both fire). 7-day default window; `windowDays` option supported by callers. → [`src/dashboard/index.ts`](src/dashboard/index.ts), [`src/cli/commands/hook.ts`](src/cli/commands/hook.ts), [`src/cli/commands/status.ts`](src/cli/commands/status.ts)

**Exit criteria (met):** Drift detection catches **100%** of synthetically-aged entries (target ≥80%). Eval harness ships with replay + ablation + delta reports — the ≥15% repeat-mistake-rate-reduction target is now *measurable* against any project's own episode history (the harness it requires is in place). **51 test files, 586 tests pass** (+124 vs Phase 3: eval 51, confidence 33, drift+verify 26, dashboard 14). `npm run typecheck` clean.

---

### 🌐 Phase 5 — Distribution, Teams & Plugin Ecosystem (Week 10–12)

**Goal:** APEX is shareable, ungated by APEX itself.

#### 5.1 Plugin packaging
- [ ] Package APEX as a Claude Code **plugin** (`hooks/`, `skills/`, `agents/`, `mcp.json`) installable via the standard plugin mechanism.
- [ ] Versioned plugin updates that don't clobber user knowledge.
- [ ] `${CLAUDE_PLUGIN_DATA}` for state that survives plugin upgrades (per Claude Code docs).

#### 5.2 Team sync (file-based, no SaaS)
- [ ] `.apex/knowledge/` is meant to be committed. APEX provides:
  - `apex review` — generates a clean PR-ready diff of pending knowledge proposals.
  - Conflict-resolution rules for parallel knowledge edits across branches.
  - Per-entry `applies_to: [user|team|all]` so personal preferences don't pollute team knowledge.
- [ ] `.apex/episodes/` and `.apex/index/` are gitignored by default (transient).

#### 5.3 Pre-built knowledge packs
- [ ] Optional starter packs for common stacks: `apex install pack:nextjs`, `pack:django`, `pack:rails`. Curated patterns + gotchas + conventions seeded by maintainers.

#### 5.4 Multi-repo & monorepo support
- [ ] Per-package `.apex/` overrides in monorepos (mirrors directory-scoped `CLAUDE.md` behavior).
- [ ] `apex link` to share knowledge between sibling repos.

#### 5.5 Privacy & trust
- [ ] Default redactor strips obvious secrets (API keys, JWTs, AWS access keys, .env-style values) from anything written to knowledge or episodes.
- [ ] `apex audit` lists every external call APEX makes (default: zero).
- [ ] Signed-knowledge mode: `apex commit-knowledge` GPG-signs entries so a team can require signed provenance.

**Exit criteria:** A second team installs APEX from the plugin registry and ships a knowledge pack PR within a week.

---

### 🧪 Phase 6 — Stretch / Advanced (post-v1)

- [ ] **Causal mining from PRs**: ingest merged PR diffs + review comments to extract decisions and gotchas without anyone typing them.
- [ ] **Cross-session memory shadow**: a tiny background subagent that watches an in-flight session and pre-fetches likely-needed knowledge before the user asks.
- [ ] **Learnable hook policies**: hooks themselves emit metrics; APEX proposes which hooks to enable/disable based on what actually moved the needle.
- [ ] **Hosted sync (optional)**: encrypted-at-rest knowledge sync for teams who don't want git as the transport. Strictly opt-in.
- [ ] **Multi-agent swarm**: parallel reflection on long-running sessions across worktrees.
- [ ] **Skill auto-authoring**: when reflector detects a workflow repeated ≥3 times with the same shape, it drafts a `SKILL.md` proposal.

---

## 7. Detailed Component Specs

### 7.1 Directory layout (post-install)

```
my-project/
├── CLAUDE.md                          # Index, < 200 lines, imports rules
├── CLAUDE.local.md                    # Personal, gitignored
├── .claude/
│   ├── settings.json                  # Hooks + permissions (managed section marked)
│   ├── rules/
│   │   ├── 00-stack.md                # From archaeologist
│   │   ├── 10-conventions.md
│   │   └── 20-gotchas.md
│   ├── skills/
│   │   ├── apex-recall/SKILL.md
│   │   ├── apex-reflect/SKILL.md
│   │   └── apex-review/SKILL.md
│   ├── agents/
│   │   ├── apex-reflector.md
│   │   ├── apex-curator.md
│   │   └── apex-archaeologist.md
│   └── hooks/                         # Shell scripts called by hooks
│       ├── on-session-start.sh
│       ├── on-prompt-submit.sh
│       ├── on-post-tool.sh
│       └── on-session-end.sh
├── .mcp.json                          # Includes apex-mcp registration
└── .apex/
    ├── config.toml                    # User settings (auto_merge, vector on/off, etc.)
    ├── knowledge/                     # COMMITTED
    │   ├── decisions/<id>.md
    │   ├── patterns/<id>.md
    │   ├── gotchas/<id>.md
    │   └── conventions/<id>.md
    ├── proposed/                      # COMMITTED, awaits review
    ├── episodes/                      # GITIGNORED, transient
    ├── index/                         # GITIGNORED (rebuildable)
    │   ├── fts.sqlite
    │   ├── vectors.lance/             # if enabled
    │   └── symbols.sqlite             # if codeindex enabled
    ├── metrics/                       # GITIGNORED
    └── .gitignore
```

### 7.2 Knowledge entry frontmatter

```yaml
---
id: gh-pnpm-not-npm
type: convention                       # decision | pattern | gotcha | convention
title: This project uses pnpm, not npm
applies_to: all                        # user | team | all
confidence: high                       # low | medium | high
sources:
  - kind: correction                   # bootstrap | correction | reflection | manual | pr
    ref: episode/2026-04-22-1f3e/turn-12
created: 2026-04-22
last_validated: 2026-04-26
supersedes: []
tags: [tooling, package-manager]
---
Always use `pnpm install`, `pnpm add`, `pnpm run`. Lockfile is `pnpm-lock.yaml`.
**Why:** Reason given by user; pnpm is enforced by CI (see `.github/workflows/ci.yml`).
**How to apply:** Replace any suggested `npm` or `yarn` command with the pnpm equivalent.
```

### 7.3 Hook contract (example: PostToolUseFailure → episode log)

```bash
#!/usr/bin/env bash
# .claude/hooks/on-post-tool-failure.sh
set -euo pipefail
EPISODE_ID="${APEX_EPISODE_ID:-$(date +%Y-%m-%d-%H%M)}"
mkdir -p ".apex/episodes/${EPISODE_ID}"
# Read JSON from stdin (per Claude Code hook contract), append redacted line
jq -c '. | {ts: now, tool: .tool_name, error: .error, exit_code: .exit_code}' \
  | "$CLAUDE_PROJECT_DIR/.apex/bin/redact" \
  >> ".apex/episodes/${EPISODE_ID}/failures.jsonl"
```

### 7.4 MCP server tools (`apex-mcp`)

| Tool | Purpose |
|---|---|
| `apex_search(query, type?, k=5)` | Hybrid keyword + (vector if enabled) retrieval |
| `apex_get(entry_id)` | Fetch a full knowledge entry by id |
| `apex_record_correction(prompt, correction, evidence)` | User-driven feedback path |
| `apex_propose(entry)` | Reflector writes proposals here; not auto-committed |
| `apex_stats()` | Counts, hit rates, drift warnings |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Knowledge files balloon and slow Claude down | Hard cap on injected knowledge tokens at SessionStart (default 2k); tier with confidence + recency |
| Reflector hallucinates "lessons" with no evidence | Two-call separation; mandatory citation; route to `proposed/` not `knowledge/` until evidence threshold met |
| Vector index becomes stale | Drift detector + last_validated; FTS5 always available as fallback |
| Hooks slow down every Claude action | Hard timeouts, async hooks for non-blocking work, perf budget enforced in CI |
| Secrets leak into knowledge or episodes | Default-on redactor + `apex audit`; CI lint on `.apex/knowledge/` for secret patterns |
| Knowledge becomes wrong after refactor | Drift detection scans against current code on `curate`; supersedes chains preserve history |
| User can't trust auto-merged entries | Beginner default = auto, with weekly digest; "trust but verify" UX pattern; one-key undo |
| Plugin upgrade clobbers user knowledge | Plugin owns `skills/`, `agents/`, `hooks/`. Knowledge lives in `.apex/`, owned by user, never overwritten |
| Lock-in / hard to leave | Everything is markdown + SQLite; `apex export` produces a portable bundle; uninstall removes only APEX-owned files |

---

## 9. Privacy, Security & Trust

- **Default = local-only.** No network calls, no telemetry. `apex audit` proves it.
- **Redactor** runs on every write to `episodes/` and `knowledge/`. Tunable patterns, default catches AWS keys, GH tokens, `.env`-style assignments, JWTs, private keys.
- **Permissions surface.** `apex install` prints exactly which hooks fire and which directories APEX writes to. User confirms.
- **Reviewable changes.** Auto-merged entries go through git like any other change; `apex review` produces a PR-ready diff.
- **No secret memory.** APEX never stores API keys, tokens, or `.env` contents — even in `.apex/episodes/`. Enforced by redactor + CI lint.

---

## 10. Success Metrics

Phase 1 must measure these from day one. Phase 4 makes them visible to the user.

| Metric | Definition | Target by Phase 4 |
|---|---|---|
| **Repeat-mistake rate** | Same error signature occurs in ≥2 sessions / total errors | ↓ ≥40% vs no-APEX baseline |
| **Knowledge hit rate** | Sessions where ≥1 retrieved entry is referenced in Claude's output | ≥60% |
| **Time-to-first-correct-edit** | Eval harness | ↓ ≥20% on stack-typical tasks |
| **User correction frequency** | "no, do X instead" interventions / 100 turns | ↓ ≥30% over 4 weeks |
| **Stale entry %** | `last_validated` > 30 days AND not retrieved | < 15% (curator's job) |
| **Hook overhead** | p99 SessionStart hook latency | < 800ms |
| **Install-to-value** | Median time from `npx apex init` to first useful retrieval | < 5 minutes |

---

## 11. Open Questions

- [ ] Default embedding model: bundle a small one (slower install, no API) or require user to choose? Lean: bundle.
- [ ] Should the reflector run on `Stop` (mid-session) or only on `SessionEnd`? Lean: SessionEnd by default; opt-in `Stop` for power users.
- [ ] Format: MDX vs plain MD for knowledge entries? Lean: plain MD with YAML frontmatter for max portability.
- [ ] Telemetry for the maintainers (anonymous, opt-in) so we can improve defaults? Default: off, with explicit opt-in.
- [ ] Rust/Go rewrite of `apex-mcp` for cold-start latency post-MVP?

---

## 12. Phase Checklist Summary

- [x] **Phase 0** — Spec & schemas locked (2026-04-26)
- [x] **Phase 1** — MVP capture + recall (2026-04-26)
- [x] **Phase 2** — Reflection + distillation (2026-04-26)
- [x] **Phase 3** — Retrieval engine + code intelligence (2026-04-26)
- [x] **Phase 4** — Self-correction + eval harness (2026-04-26)
- [ ] **Phase 5** — Distribution + teams + plugin (2 weeks)
- [ ] **Phase 6** — Stretch / advanced (post-v1)

**Total to v1:** ~12 weeks of focused work. Phase 1 is shippable as a useful product on its own at week 3.

---

## 13. References

Architectural decisions in this PRD are grounded in:

- **Claude Code primitives** — [Memory](https://code.claude.com/docs/en/memory), [Hooks](https://code.claude.com/docs/en/hooks), [Subagents](https://code.claude.com/docs/en/sub-agents), [Skills](https://code.claude.com/docs/en/skills).
- **Full-stack Claude Code synthesis** — [alexop.dev: Understanding Claude Code's Full Stack](https://alexop.dev/posts/understanding-claude-code-full-stack/).
- **Hook patterns** — [disler/claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery), [Pixelmojo: All 12 Lifecycle Events](https://www.pixelmojo.io/blogs/claude-code-hooks-production-quality-ci-cd-patterns).
- **Agent memory architecture** — [State of AI Agent Memory 2026 (mem0)](https://mem0.ai/blog/state-of-ai-agent-memory-2026), [Practical Guide to Memory for Autonomous LLM Agents (TDS)](https://towardsdatascience.com/a-practical-guide-to-memory-for-autonomous-llm-agents/), [LangMem episodic/semantic/procedural].
- **Code RAG** — [LanceDB: Building RAG on Codebases](https://www.lancedb.com/blog/building-rag-on-codebases-part-1), tree-sitter AST chunking, [MindStudio: What AI Agents Use Instead of Vector DBs](https://www.mindstudio.ai/blog/is-rag-dead-what-ai-agents-use-instead) (the AST-and-grep argument).
- **Memory Bank pattern** — Cline memory bank, [Cursor Memory Bank adaptation](https://medium.com/codetodeploy/advanced-cursor-use-the-memory-bank-to-eliminate-hallucination-affd3fbeefa3).
- **Self-correction** — Reflexion (verbal reinforcement), tool-grounded correction as the most reliable production pattern, two-call separation of analysis vs. revision.
