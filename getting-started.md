# Getting Started with APEX

APEX (Adaptive Project Experience) is a self-learning project intelligence layer that sits **on top of** Claude Code. It captures what happens in your sessions, distils durable lessons (decisions, patterns, gotchas, conventions), and surfaces them back to Claude at the right moment — so your project gets a little smarter every session.

Everything is files-on-disk: plain markdown plus SQLite, all under your repo. No SaaS, no daemons, no telemetry. The default install runs **zero external network calls** (and `apex audit` proves it).

This guide is split into two halves:

- **Part 1 — Use APEX** in your own project. Start here if you just want Claude Code to "remember" your project.
- **Part 2 — Develop APEX** (this codebase). Start here if you want to contribute, debug internals, or wire up advanced features.

---

## Table of contents

- [Part 1 — Use APEX in your project](#part-1--use-apex-in-your-project)
  - [Install in 60 seconds](#install-in-60-seconds)
  - [What just happened?](#what-just-happened)
  - [Your first session](#your-first-session)
  - [Day-to-day workflows](#day-to-day-workflows)
  - [Core concepts (read once)](#core-concepts-read-once)
- [Part 2 — Power-user features](#part-2--power-user-features)
  - [Tiered retrieval (vector + code-symbol index)](#tiered-retrieval-vector--code-symbol-index)
  - [Knowledge graph](#knowledge-graph)
  - [Eval harness](#eval-harness)
  - [Confidence calibration & drift](#confidence-calibration--drift)
  - [Teams & sharing](#teams--sharing)
  - [Knowledge packs](#knowledge-packs)
  - [Monorepos](#monorepos)
  - [Stretch features](#stretch-features)
  - [Configuration reference](#configuration-reference)
- [Part 3 — Develop APEX itself](#part-3--develop-apex-itself)
  - [Repo layout](#repo-layout)
  - [Build, test, run](#build-test-run)
  - [Architecture in one screen](#architecture-in-one-screen)
  - [Adding a new CLI command](#adding-a-new-cli-command)
  - [Adding a new capture point](#adding-a-new-capture-point)
  - [Adding a new MCP tool](#adding-a-new-mcp-tool)
  - [Conventions & gotchas](#conventions--gotchas)
- [Troubleshooting](#troubleshooting)
- [Going further](#going-further)

---

## Part 1 — Use APEX in your project

### Install in 60 seconds

```bash
cd my-project
npx apex@latest init
```

That's it. APEX detects your stack (language, framework, package manager, test runner, lint/format tools, CI), scaffolds a sensible `CLAUDE.md`, installs Claude Code skills/agents/hooks, registers the `apex-mcp` MCP server in `.mcp.json`, and runs an **archaeologist** pass over `git log`, your README, top-imported deps, and (if `gh` is available) recent PRs to bootstrap initial knowledge proposals.

Want to preview without writing anything?

```bash
npx apex init --dry-run
```

Re-running on an existing install is safe — it detects APEX and offers `apex upgrade`. If you want to start over: `npx apex init --force`.

### What just happened?

After install you'll see new files in three places:

```
my-project/
├── CLAUDE.md                          # Claude's index, < 200 lines
├── CLAUDE.local.md                    # Your personal notes (gitignored)
├── .claude/
│   ├── settings.json                  # Hooks + permissions (managed block marked)
│   ├── rules/                         # Stack rules, conventions, gotchas
│   ├── skills/apex-recall/            # Auto-invoked when you ask "did we decide…"
│   ├── skills/apex-reflect/           # Distils session events into knowledge
│   ├── skills/apex-review/            # Generates PR-ready knowledge diffs
│   ├── agents/                        # apex-reflector, apex-curator, apex-archaeologist
│   ├── commands/                      # /apex-thumbs-up, /apex-thumbs-down
│   └── hooks/                         # SessionStart/End, prompt, tool, pre-compact
├── .mcp.json                          # apex-mcp registered here
└── .apex/
    ├── config.toml                    # Your settings (commit this)
    ├── knowledge/                     # COMMIT THIS — the brain
    │   ├── decisions/<id>.md
    │   ├── patterns/<id>.md
    │   ├── gotchas/<id>.md
    │   └── conventions/<id>.md
    ├── proposed/                      # COMMIT THIS — awaits review
    ├── episodes/                      # GITIGNORED — transient session logs
    ├── index/                         # GITIGNORED — rebuildable
    └── metrics/                       # GITIGNORED
```

**Commit `.apex/knowledge/`, `.apex/proposed/`, and `.apex/config.toml`.** The rest is generated and already gitignored.

### Your first session

Open Claude Code in the repo. The next session will print something like:

```
APEX loaded — 14 patterns, 3 gotchas, 2 active conventions.
APEX: 0 entries used last week (0 helpful, 0 corrected, 0 unused)
```

Then just work. APEX captures in the background:

- Every prompt you send (and corrections like "no, use pnpm")
- Every tool Claude runs (and exit codes)
- Every failure
- Every accepted suggestion
- Every `[[wiki-link]]`-able file Claude touches

When the session ends, the **reflector** distils repeating signals (failures with the same signature, corrections, confirmations, thumbs) into proposals at `.apex/proposed/<id>.md`. Eligible proposals auto-promote to `.apex/knowledge/`; the rest queue for review.

You can also invoke things on demand:

```bash
apex search "auth flow"          # query the knowledge base
apex status                       # counts, last sync, drift warnings
apex reflect                      # distil the most recent episode now
apex reflect --all                # distil everything in episodes/
apex promote --auto               # move eligible proposals into knowledge/
apex curate                       # weekly hygiene: dedupe, stale, drift
apex review                       # PR-ready diff of pending proposals
```

### Day-to-day workflows

**When Claude does something useful, leave it alone.** APEX captured the win automatically.

**When Claude does something wrong, correct it explicitly.** Phrases like *"no, use pnpm not npm"* or *"don't put that in `lib/`, it lives in `src/lib/`"* are pattern-matched into `corrections.jsonl` and become proposed conventions/gotchas after the next reflection pass.

**When Claude does something unusual but right, confirm it.** *"Yes, exactly that"* or *"perfect, keep doing it that way"* are pattern-matched as `kind: confirmation` so the reflector knows the unusual choice was deliberate.

**Thumbs on specific entries.** If a knowledge entry helped or misled you:

```
/apex-thumbs-up gh-pnpm-not-npm
/apex-thumbs-down legacy-auth-flow
```

These flow into the confidence calibrator (`apex calibrate`) and adjust ranking weights.

**Weekly hygiene.** Run `apex curate` once a week. It dedupes near-identical entries, marks stale ones, and detects drift (a `gotcha` whose target file no longer exists).

**Before opening a PR.** Run `apex review` to produce a PR-ready summary of any pending knowledge changes. Treat `.apex/knowledge/` like any other code: review it, commit it, ship it.

### Core concepts (read once)

**Three memory types.** APEX cleanly separates:

| Type | Where it lives | What it is |
|---|---|---|
| **Episodic** | `.apex/episodes/<id>/*.jsonl` | What *happened* this session. Transient, gitignored. |
| **Semantic** | `.apex/knowledge/<type>/<id>.md` | What we *know* about the project. Committed, reviewable. |
| **Procedural** | `.claude/skills/apex-*/SKILL.md` | *How* Claude should do things in this project. |

**Four knowledge types.** Every semantic entry is one of:

- **decision** — "We chose X over Y because…"
- **pattern** — "When you do A, structure it like B."
- **gotcha** — "If you touch file/symbol X, beware Y."
- **convention** — "We always do X this way."

**The proposed/knowledge boundary is sacred.** Nothing — not the reflector, archaeologist, packs installer, sync importer, PR miner, skill author — writes directly to `.apex/knowledge/`. They all write to `.apex/proposed/` and the `apex promote` pipeline gates the move. `--force` exists but is the only escape hatch.

**Confidence is earned.** Reflection-authored entries are never `high` confidence on first write. Only `apex calibrate` (driven by signals: passing tests, repeated corrections, thumbs, retrieval references) can promote to `high`. `low`-confidence entries are filtered from default retrieval unless their explicit id appears in your query.

**Provenance is mandatory.** Every entry must cite at least one source (`episode/<id>/...`, `commit/<sha>`, `pack:<id>@<version>`, etc.). Ungroundable proposals are dropped.

---

## Part 2 — Power-user features

All of these are **opt-in**. The default install stays minimal.

### Tiered retrieval (vector + code-symbol index)

APEX has three retrieval tiers, all local:

| Tier | What | Default | Latency |
|---|---|---|---|
| **1 — FTS5** | SQLite full-text keyword search over knowledge | always on | P50 ~0.1ms |
| **2 — Vector** | LanceDB with on-device embeddings (`Xenova/all-MiniLM-L6-v2`, 384-dim, ~25MB) | opt-in | sub-200ms |
| **3 — Code symbols** | tree-sitter (WASM) symbol index over your source | opt-in | mtime-incremental |

Enable vector retrieval:

```bash
apex enable vector
apex search "auth handler" --tier hybrid     # FTS + vector, fused via RRF (k=60)
apex search "auth handler" --tier vector
apex search "auth handler" --tier fts
```

Hybrid uses **Reciprocal Rank Fusion** so the two scoring scales don't fight. Confidence weights `{low: 0.5, medium: 0.85, high: 1.0}` multiply fused scores before final ranking.

Enable the code-symbol index (TS/TSX/JS/JSX/Python):

```toml
# .apex/config.toml
[codeindex]
enabled = true
# languages = ["ts", "tsx", "js", "py"]    # optional filter
# max_file_kb = 2000
```

```bash
apex codeindex sync
apex codeindex find Service                 # by name
apex codeindex find run --kind method --exported
apex codeindex find handler --path auth     # path-substring bias
apex codeindex stats
```

`apex codeindex sync` walks the repo respecting `.gitignore`, skips `node_modules`/`dist`/`build`/`.git`/`.apex`/etc, and re-parses only changed files.

### Knowledge graph

The graph links entries to each other and to files/symbols. Useful for blast-radius questions ("what depends on the `auth-rotation` decision?").

```toml
# .apex/config.toml
[graph]
enabled = true
```

```bash
apex graph sync
apex graph deps decision:auth-rotation        # outgoing edges
apex graph dependents decision:auth-rotation  # incoming edges
apex graph blast decision:auth-rotation --depth 2
apex graph stats
```

Edge types: `supersedes`, `tagged`, `affects`, `applies-to`, `references`. The graph also exposes MCP tools (`apex_graph_dependents`, `apex_graph_dependencies`, `apex_graph_blast`) when `[graph].enabled = true`.

### Eval harness

Prove APEX is making Claude better on *your* project:

```bash
apex eval                              # run the default task set against current knowledge
apex eval --stack nextjs               # restrict to one stack's tasks
apex eval --without-apex               # ablation: strip retrievals, simulate no-APEX
apex eval --episode-glob '2026-04-*'   # replay-only window
```

Reports land in `.apex/metrics/eval-<YYYY-MM-DD>-<HHMM>.md` with:

- Repeat-mistake rate
- Knowledge hit rate (sessions where ≥1 retrieved entry was referenced)
- Time-to-first-correct-edit (median)
- User correction frequency
- Δ versus the previous run

35 synthetic tasks ship by default (12 node-typescript, 12 python, 11 nextjs); you can drop additional tasks under `templates/.apex/eval/<stack>/<id>.md`.

### Confidence calibration & drift

```bash
apex calibrate                # update confidence on most-recent episode signals
apex calibrate --all          # full sweep
apex calibrate --dry-run      # preview transitions

apex curate                   # dedupe + stale + drift
apex curate --drift-only
apex curate --mark-verified   # writes drift_report into entry frontmatter
apex curate --schedule weekly # writes a schedule descriptor for a future scheduler
```

Drift detection finds:

- **file_missing** (high) — entry references a file that no longer exists
- **symbol_missing** (medium) — referenced function/class is gone
- **reference_missing** (medium) — `references:` frontmatter points at a removed entry
- **path_missing** (low) — inline path mention no longer resolves

### Teams & sharing

`apex review` produces a clean PR-ready diff of pending proposals, classified into auto-promote vs queue-for-review:

```bash
apex review                         # human-readable
apex review --json                  # machine-readable
apex review --lint                  # surface invalid applies_to scopes
apex review --out review.md
```

Conflict resolution prefers higher `confidence`, then more recent `last_validated`, then `supersedes:` chain — deterministic and reviewable.

`applies_to: user|team|all` lets entries scope to individual contributors vs the whole team.

### Knowledge packs

Pre-built starter knowledge for common stacks. Three ship by default — Next.js, Django, Rails (5 entries each):

```bash
apex install --list                  # see available packs
apex install pack:nextjs
apex install pack:django --dry-run
```

Pack entries land in `.apex/proposed/` (never directly in knowledge), so you review and promote them like any other proposal.

### Monorepos

Auto-detection across pnpm workspaces, lerna, nx, turbo, yarn/npm workspaces, and cargo `[workspace]` (7 ecosystems). Per-package overrides resolve deterministically — package-level entries override root-level by `id`.

Linking knowledge across separate repos:

```bash
apex link ../other-repo               # creates symlink + manifest entry
apex link --list                      # health: ok / symlink missing / target unreachable
apex unlink other-repo
```

### Stretch features

All shipped, all opt-in, all local:

```bash
apex prmine [--since main] [--limit 50] [--include-reviews]
    # mine merged commits + (optional) gh PR bodies for gotchas/decisions

apex shadow prefetch --prompt "<text>" [--ttl 15]
apex shadow stats [--json]
apex shadow clear
    # speculative recall warming for the next prompt (median 0.2ms warm)

apex hookpolicy report [--window-days 14]
    # data-driven recommendation: keep | disable | insufficient-data per hook
    # writes .apex/proposed/_hook-policy-<date>.md — never edits settings.json

apex sync export --out backup.apex-bundle [--include-proposed]
apex sync import --in backup.apex-bundle [--dry-run]
    # AES-256-GCM, PBKDF2 600k iter, passphrase from env only
    # transport (S3, Dropbox, USB) is your call

apex swarm list
apex swarm reflect [--parallel <n>] [--timeout 60]
    # fan reflect across every git worktree

apex skillauthor propose [--threshold 3] [--limit 10]
apex skillauthor list
    # detects recurring tool-call workflows; drafts skills under
    # .apex/proposed-skills/ — never touches .claude/skills/

apex audit                # zero external calls in production paths — proven
apex commit-knowledge     # GPG-sign every knowledge entry (writes <entry>.md.asc)
apex verify-knowledge     # gpg --verify pass/fail counts
```

### Configuration reference

`.apex/config.toml` is the single source of user-tunable settings. The full default file is at `templates/.apex/config.toml.tpl`. Notable blocks:

```toml
[auto_merge]
enabled = true                # auto-promote eligible proposals
threshold = 2                 # min sources required
require_no_conflict = true
min_confidence = "medium"

[vector]
enabled = false               # apex enable vector flips this

[codeindex]
enabled = false
# languages = ["ts", "tsx", "js", "py"]
# max_file_kb = 2000

[graph]
enabled = false
```

---

## Part 3 — Develop APEX itself

This section is for contributors to the apexV2 repo.

### Repo layout

```
apexV2/
├── PRD.md                   # canonical spec — read before non-trivial changes
├── CLAUDE.md                # in-repo guidance for Claude Code
├── specs/                   # schemas + design contracts (knowledge, episode, eval, redactor, threat-model, install, metrics, compatibility)
├── src/
│   ├── cli/                 # commander entrypoints (one file per subcommand)
│   ├── scaffold/            # apex init writes here
│   ├── detect/              # stack detection (language, package manager, ...)
│   ├── archaeologist/       # bootstrap from git/README/PRs
│   ├── reflector/           # episode → proposal heuristics
│   ├── curator/             # dedupe, stale, drift
│   ├── promote/             # proposal → knowledge gate
│   ├── recall/              # tier 1 (FTS5) + tier 2 (vector) + hybrid (RRF)
│   ├── codeindex/           # tier 3 (tree-sitter symbols)
│   ├── graph/               # property graph
│   ├── confidence/          # calibrator + signals
│   ├── eval/                # task runner, replay, metrics, reporter
│   ├── mcp/                 # apex-mcp stdio server
│   ├── redactor/            # secret masking — runs on every write
│   ├── audit/               # zero-external-call scanner + GPG signing
│   ├── plugin/              # Claude Code plugin packaging
│   ├── review/              # PR-ready knowledge diffs
│   ├── packs/               # knowledge pack format
│   ├── monorepo/            # workspace discovery + override resolution
│   ├── prmining/            # commit/PR mining (Phase 6)
│   ├── shadow/              # speculative prefetch (Phase 6)
│   ├── hookpolicy/          # data-driven hook recommendations (Phase 6)
│   ├── sync/                # encrypted bundle export/import (Phase 6)
│   ├── swarm/               # multi-worktree reflect fan-out (Phase 6)
│   ├── skillauthor/         # skill auto-authoring (Phase 6)
│   ├── config/              # config.toml loader (smol-toml)
│   └── util/                # paths, fs helpers
├── templates/               # everything shipped to target repos
│   ├── CLAUDE.md.tmpl
│   ├── .mcp.json.tpl
│   ├── claude/              # skills, agents, hooks, commands, rules
│   └── packs/               # nextjs, django, rails
└── test/                    # vitest, mirrors src/
```

`PRD.md` is the canonical spec. `CLAUDE.md` is the short guidance for Claude Code working in the repo — read both before making non-trivial changes.

### Build, test, run

```bash
npm install
npm run build              # tsc → dist/
npm run typecheck          # tsc --noEmit, strict + noUncheckedIndexedAccess
npm test                   # vitest run, full suite (1009 tests across 87 files)
npm run test:watch
npm run dev -- <args>      # tsx src/cli/index.ts <args>  — run unbuilt CLI

# Single file or pattern
npm test -- test/reflector/
npm test -- test/recall/store.test.ts
npm test -- -t "drift detector"

# Run the dev CLI against a different project root
npm run dev -- search "auth" --cwd /path/to/test/project
```

`APEX_VECTOR_FAKE=1` substitutes deterministic 384-dim hash vectors for the Xenova model, so vector tests never download weights. Set it in any test exercising the vector tier and in CI.

Node ≥20 required (`package.json` engines). The package is ESM (`"type": "module"`).

### Architecture in one screen

```
Capture (hooks)        →    Distillation (subagents)      →    Retrieval (MCP + skills)
src/cli/commands/hook.ts   src/reflector/, src/curator/        src/recall/, src/mcp/
↓ writes JSONL              ↓ reads JSONL, writes proposals    ↓ reads knowledge, serves Claude
.apex/episodes/<id>/        .apex/proposed/<id>.md             .apex/knowledge/<type>/<id>.md
```

Three planes, each owned by a clear directory. Keep concerns separated:

- Hooks are **fast** (`SessionStart` <1s, `SessionEnd` <5s) and `exit 0` unconditionally. Heavy work is async or post-session.
- The reflector is **deterministic** (heuristics over JSONL signals) — the LLM-side reflection happens via the agent prompt in `templates/claude/agents/apex-reflector.md`, which calls the deterministic engine via `apex reflect --dry-run` then `apex reflect`.
- Retrieval **never modifies** knowledge. New "we learned X" features write to `.apex/proposed/` (or `.apex/proposed-skills/`).
- The redactor (`src/redactor/`) runs on **every** write to `.apex/episodes/` or `.apex/knowledge/`. New write paths must call it.
- `apex audit` enforces **zero production network calls**. Adding networked code requires an explicit opt-in flag and a test proving `apex audit` still reports zero production findings.

### Adding a new CLI command

`src/cli/index.ts` registers each subcommand via a `try { dynamic import } catch { /* skip */ }` wrapper — modules can be optional, and a broken one won't kill the whole CLI.

1. Create `src/cli/commands/<name>.ts` exporting a `<name>Command(): Command` factory. Use `src/cli/commands/reflect.ts` as the canonical example (commander + kleur + `--cwd` + `--dry-run`).
2. Implement the verb against `projectPaths(root)` from `src/util/paths.ts` — never hardcode `.apex/...` strings.
3. Add a `register<Name>` block to `src/cli/index.ts`.
4. Add tests under `test/<name>/` and an integration test if the command writes to disk.

For commands that mutate knowledge state, follow the **two-call separation** guardrail: an analyse pass (`--dry-run`) returns a plan; a write pass applies it. The accompanying agent prompt (under `templates/claude/agents/`) instructs Claude to do both in order.

### Adding a new capture point

Capture lives in `src/cli/commands/hook.ts`. The router dispatches by event name. To add a new signal:

1. Append a new `kind` to the relevant JSONL file under `.apex/episodes/<id>/` (see `specs/episode-schema.md` for the schema).
2. Wire the matching hook handler in `hook.ts`. Keep it under the time budget and `exit 0` unconditionally.
3. Run all text through the redactor before writing.
4. Update the reflector signals (`src/reflector/signals.ts`) to consume the new `kind`.
5. Add a test in `test/hooks/integration.test.ts`.

### Adding a new MCP tool

`src/mcp/tools.ts` declares all tools in a single array (`apex_search`, `apex_get`, `apex_get_decision`, `apex_record_correction`, `apex_propose`, `apex_stats`). Adding a tool:

1. Append to the array with a zod input schema and an async handler.
2. Keep the SQLite recall handle **lazy** — `tools/list` must not touch disk.
3. Bump `serverInfo.version` and update `serverInfo.instructions` if the supported tool set changes.
4. The `tools.listChanged` capability is advertised, so newer Claude Code clients refresh automatically.

### Conventions & gotchas

These are the ones that bite contributors. They are documented inline in `CLAUDE.md` too.

- **All relative imports end in `.js`.** `"type": "module"` + `moduleResolution: "bundler"` means `import { x } from "./foo.js"` is correct even when importing a `.ts` file.
- **`noUncheckedIndexedAccess: true`.** Array/object index access returns `T | undefined`. Use `arr[i]!` only after a length check, or assign to a temp.
- **Templates live at `templates/`.** Resolve via `templatesDir()` in `src/util/paths.ts` — works in both `src/` dev mode and packed `dist/`.
- **Subagents and skills are markdown for Claude to read — not code we execute.** Their TS counterparts live under `src/reflector/`, `src/curator/`, `src/archaeologist/` etc and implement deterministic heuristics the agents call.
- **Two-call separation is a guardrail.** When adding a new agent, preserve the analyse-then-write flow.
- **Phase discipline.** PRD §6 splits work into phases. When you complete work that closes a checkbox, update `PRD.md` in the same commit.

---

## Troubleshooting

**`apex search` returns nothing** — your knowledge base may be empty. Run `apex status` to confirm counts. If proposals exist but knowledge doesn't, run `apex promote --auto`. If episodes exist but proposals don't, run `apex reflect --all`.

**Vector search isn't matching what FTS finds** — the embedding model may not have synced. Run `apex enable vector` again (idempotent) to force a sync, or delete `.apex/index/vectors.lance/` and re-enable.

**Hooks are slow** — check `.claude/settings.json` for hook timeouts (`SessionStart` should be ≤1s). Run `apex hookpolicy report` to see which hooks actually produce signals; disable the rest.

**Knowledge file feels wrong / stale** — drop a `/apex-thumbs-down <entry-id>` in chat. Then `apex calibrate` to update confidence. If the file references something that no longer exists, `apex curate --drift-only` will flag it.

**MCP tools aren't showing up** — confirm `.mcp.json` has the `apex` entry: `cat .mcp.json | jq .mcpServers.apex`. Re-register with `apex init` (idempotent). The `_apex_managed: true` tag identifies APEX-owned entries.

**Tests want network** — set `APEX_VECTOR_FAKE=1`. Any test still failing without network is genuinely networked and should be flagged in PR review.

**Uninstalling** — `apex uninstall` removes APEX-owned files (skills, agents, hooks, MCP entry) and leaves `.apex/knowledge/` intact. Everything is markdown — `git rm -rf .apex/` is also fair game.

---

## Going further

- Read `PRD.md` for the full spec, phase plan, success metrics, and architectural decisions.
- Read `specs/knowledge-schema.md` and `specs/episode-schema.md` for the file formats.
- Read `specs/redactor-design.md` and `specs/threat-model.md` for the privacy posture.
- Read `specs/eval-harness.md` for how "did APEX help?" is measured.
- Look at any `*/integration.test.ts` for end-to-end examples — they spin up tmpdir fixtures and exercise full flows.

If you only remember three things:

1. **Files first.** Everything is markdown or SQLite under your repo. Diff it, review it, delete it. No lock-in.
2. **The proposed/knowledge boundary is sacred.** New "we learned X" features write to `.apex/proposed/`, never `.apex/knowledge/`.
3. **Tool-grounded over self-grounded.** Confidence comes from passing tests, repeated corrections, and explicit user signals — not from the model's self-critique.
