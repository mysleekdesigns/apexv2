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

### ✅ Phase 0 — Foundation & Spec (Week 0–1)

**Goal:** Lock down primitives, schemas, and metrics before writing code.

- [ ] Pin Claude Code minimum version (≥ 2.1.x for deferred MCP loading, agent hooks, subagent memory).
- [ ] Write the **knowledge file schema** — frontmatter spec for `decisions`, `patterns`, `gotchas`, `conventions` (id, title, source, confidence, created, last-validated, supersedes).
- [ ] Write the **episode schema** — session id, prompts, tools used, files touched, outcomes, errors, corrections.
- [ ] Define the **eval harness contract** — how a task replay measures "did APEX help?".
- [ ] Define **success metrics** (see §10).
- [ ] Choose default install method: `npx apex` (Node) for the broadest reach; document a `pip install apex-cc` mirror.
- [ ] Threat-model: what should *never* go into knowledge files (secrets, PII, proprietary external IP)? Build a redactor skill.
- [ ] Write a one-page README that a brand-new user can follow in 60 seconds.

**Exit criteria:** schemas merged, eval contract documented, install path decided.

---

### 🚀 Phase 1 — MVP: Capture + Recall (Week 1–3)

**Goal:** Working install that captures session events and surfaces relevant knowledge at session start. Deliberately small.

#### 1.1 Installer
- [ ] `npx apex init` scaffolds `CLAUDE.md`, `.claude/`, `.apex/` and a sensible `.gitignore`.
- [ ] `apex init --dry-run` previews changes.
- [ ] Idempotent re-run: detects existing APEX install and offers `apex upgrade` instead.
- [ ] Detects: language, framework, package manager, test runner, lint/format tools, CI provider — writes findings to `.apex/knowledge/conventions/stack.md`.

#### 1.2 CLAUDE.md scaffold
- [ ] Index-style CLAUDE.md under 200 lines that *imports* `.claude/rules/*.md` rather than inlining everything.
- [ ] Auto-generated sections: Project Stack, Common Commands, Where Things Live, Rules of the Road.
- [ ] Section markers (HTML comments) so APEX can rewrite specific sections without clobbering user edits.

#### 1.3 Capture hooks (the minimum useful set)
- [ ] `SessionStart` → inject top-N relevant knowledge entries (default N=5) plus a one-line stats banner.
- [ ] `UserPromptSubmit` → log prompt to the current episode; semantic-match against `gotchas/` and prepend matches as context.
- [ ] `PostToolUse` matcher `Bash` → record commands run + exit codes (test/lint signal).
- [ ] `PostToolUseFailure` → capture the failure into `.apex/episodes/<id>/failures.jsonl` for the reflector to see.
- [ ] `PreCompact` → snapshot the current todo list, open files, and recent decisions to the episode file before compaction wipes them.
- [ ] `SessionEnd` → close the episode file; enqueue a reflection job.
- [ ] All hooks ship with timeouts and never exceed 1s in the hot path.

#### 1.4 Recall skill
- [ ] `.claude/skills/apex-recall/SKILL.md` — auto-invoked when Claude needs to "check past decisions" or "look for a pattern".
- [ ] Backed by `apex-mcp` (Phase 1 ships SQLite FTS5; vector is Phase 3).
- [ ] Returns ranked snippets with file path so Claude can `Read` for full context.

#### 1.5 Bootstrap (archaeologist)
- [ ] Subagent that runs once on `apex init`: reads README, recent `git log`, top-imported files, test runner output, and proposes initial `conventions/` and `patterns/` entries for user approval.
- [ ] Writes a `conventions/_pending.md` for human review rather than silently committing claims.

**Exit criteria:** A new repo + `npx apex init` + two Claude Code sessions visibly improves on session three (a teammate trying it for the first time should say "oh, it remembered").

---

### 🧠 Phase 2 — Reflection & Distillation (Week 3–5)

**Goal:** The system extracts *durable lessons* from raw episodes and updates the knowledge base — without the user having to ask.

#### 2.1 Reflector subagent
- [ ] `.claude/agents/apex-reflector.md` — runs on `SessionEnd` (or on demand via `apex reflect`).
- [ ] Inputs: latest episode file, recent failures, recent corrections, the current knowledge base.
- [ ] Outputs: proposed knowledge entries (decisions, gotchas, patterns) as a diff, written to `.apex/proposed/`.
- [ ] Uses **two-call separation** (per reflection-pattern research): one call analyzes "what went wrong / what was learned", a second call writes the entry. Reduces correlated errors.
- [ ] Hard-grounds extraction in evidence: every proposed entry must cite the file/line/command that justifies it.

#### 2.2 Auto-promotion rules (configurable)
- [ ] **Auto-merge** when: same correction observed ≥2 times AND no conflicting entry exists. (Beginner default ON.)
- [ ] **Queue for review** when: a proposal supersedes an existing entry, or confidence < threshold.
- [ ] Power user can flip everything to manual via `apex config set auto_merge=false`.

#### 2.3 Curator subagent
- [ ] Runs weekly (or on `apex curate`): dedupes near-identical entries, merges entries that say the same thing, marks entries stale if not validated for N days.
- [ ] Writes a curation summary to `.apex/curation/<date>.md` so the user can see what changed.

#### 2.4 Tool-grounded learning
- [ ] When a `PostToolUse` failure repeats N times for the same root cause (same error signature), reflector escalates to a *gotcha* with elevated confidence.
- [ ] When a test passes after a known-failure pattern, the gotcha auto-marks "resolved at <commit>" and de-prioritizes for retrieval.

#### 2.5 Feedback capture from chat
- [ ] User says "no, do X instead" → captured as a candidate correction for reflection.
- [ ] User accepts an unusual approach without pushback → also captured (per research: confirmations are quieter signals but equally valuable).

**Exit criteria:** Run a 30-task workload on a fresh repo. After Phase 2, repeat-mistake rate is measurably lower than after Phase 1, with no manual knowledge editing.

---

### 🔍 Phase 3 — Retrieval Engine & Code Intelligence (Week 5–8)

**Goal:** The right knowledge surfaces at the right moment. Cheap, fast, opt-in advanced backends.

#### 3.1 Tiered retrieval
- [ ] **Tier 1 (default, always-on):** SQLite FTS5 keyword search over knowledge files. Sub-10ms. No external deps.
- [ ] **Tier 2 (opt-in):** LanceDB embedded vector store with local embeddings (default: a small open model via `transformers.js` so there's no API call). `apex enable vector`.
- [ ] **Tier 3 (opt-in):** Code-symbol index built with **tree-sitter** (Python, TS/JS, Go, Rust, Java to start). Lets Claude jump from "the auth handler" → exact file/symbol without grep guessing. `apex enable codeindex`.

#### 3.2 Hybrid retrieval pipeline
- [ ] BM25 (FTS5) + vector (if enabled) + rerank (LLM-as-reranker for top 20 → top 5). Reranker is opt-in because it costs tokens.
- [ ] Retrieval is always **provenance-attached**: every snippet returned cites file path + line + last-validated date.
- [ ] Cache retrieval results per (prompt, knowledge-version) tuple to avoid re-querying within a session.

#### 3.3 MCP server: `apex-mcp`
- [ ] Stdio MCP server exposing tools: `apex_search`, `apex_get_decision`, `apex_record_correction`, `apex_propose_knowledge`.
- [ ] Auto-registered into `.mcp.json` on install.
- [ ] Honors deferred tool loading (Claude Code 2026+) — tool schemas only fetched when the recall skill needs them.

#### 3.4 Knowledge graph (advanced opt-in)
- [ ] `apex enable graph` builds a lightweight property graph (SQLite-backed) linking entries: `decision → supersedes → decision`, `gotcha → applies-to → file/symbol`, `pattern → references → decision`.
- [ ] Enables queries like "what depends on the auth-rotation decision?" — surfaces blast-radius warnings.

**Exit criteria:** P50 retrieval latency < 50ms (tier 1), < 200ms (tier 2). Top-5 retrieval relevance ≥ 0.7 on the eval harness.

---

### 🎯 Phase 4 — Self-Correction & Evaluation Loop (Week 8–10)

**Goal:** The system measurably improves over time, and we can prove it.

#### 4.1 Eval harness
- [ ] Synthetic task set per language/framework (10–30 tasks each): "add a route", "fix this failing test", "rename this prop", etc.
- [ ] **Replay mode:** record a real session's prompts, then re-run them on the same starting commit with and without APEX. Compare: tools used, time-to-first-correct-edit, test pass rate, edit churn.
- [ ] `apex eval` outputs a markdown report with deltas vs the previous run.

#### 4.2 Confidence calibration
- [ ] Each knowledge entry has a `confidence: low|medium|high` field, updated by:
  - Up: confirmed by a successful test run, repeated correction observed, user thumbs-up.
  - Down: contradicted by a passing test for the opposite behavior, user explicit "ignore that", entry not retrieved in N sessions.
- [ ] Retrieval down-weights low-confidence entries by default; surface them only when explicitly searched.

#### 4.3 Drift detection
- [ ] On `apex curate`, scan knowledge entries against the *current* code: if `gotcha` references a file/symbol that no longer exists, mark `verified: false` and notify.
- [ ] Schedule with Claude Code's scheduled tasks: weekly curation + drift report.

#### 4.4 Feedback flywheel UI
- [ ] `/apex-thumbs-up <entry-id>` and `/apex-thumbs-down <entry-id>` slash commands for explicit feedback.
- [ ] Show a 1-line dashboard at session start: `APEX: 12 entries used last week (8 helpful, 1 corrected, 3 unused)`.

**Exit criteria:** Eval harness shows ≥15% reduction in repeat-mistake rate at week 4 vs week 1 on the same project. Drift detection catches ≥80% of synthetically-aged entries.

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

- [ ] **Phase 0** — Spec & schemas locked
- [ ] **Phase 1** — MVP capture + recall (3 weeks)
- [ ] **Phase 2** — Reflection + distillation (2 weeks)
- [ ] **Phase 3** — Retrieval engine + code intelligence (3 weeks)
- [ ] **Phase 4** — Self-correction + eval harness (2 weeks)
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
