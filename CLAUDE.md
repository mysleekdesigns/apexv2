# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

APEX (Adaptive Project Experience) — a self-learning project intelligence layer that ships **on top of** Claude Code's native primitives (`CLAUDE.md`, `.claude/skills/`, `.claude/agents/`, `.claude/hooks/`, `settings.json`, MCP servers). Distributed as a Node CLI (`apex`) installed into a target repo via `npx apex init`. **`PRD.md` is the canonical spec** for goals, architecture, and the phased plan — read it before making non-trivial changes.

## Commands

```bash
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit (strict; noUncheckedIndexedAccess on)
npm test            # full vitest suite (test/**/*.test.ts + src/**/*.test.ts)
npm run test:watch
npm run dev -- <args>   # tsx src/cli/index.ts <args>  (run the CLI without building)

# Run a single test file or pattern
npm test -- test/reflector/                    # everything under test/reflector/
npm test -- test/recall/store.test.ts          # one file
npm test -- -t "drift detector"                # by test-name pattern (vitest -t)
```

CI-friendly: `APEX_VECTOR_FAKE=1` substitutes deterministic 384-dim hash vectors for the Xenova/transformers model so vector tests never download weights. Set it in any test that exercises the vector tier.

## Architecture (the part you need files-spread-across-the-repo to see)

APEX has **three discrete planes**, all backed by plain markdown + SQLite under the user's repo:

```
Capture (hooks)  →  Distillation (subagents)  →  Retrieval (MCP + skills)
src/cli/commands/hook.ts    src/reflector/, src/curator/    src/recall/, src/mcp/
↓ writes JSONL              ↓ reads JSONL, writes proposals  ↓ reads knowledge, serves Claude
.apex/episodes/<id>/        .apex/proposed/<id>.md           .apex/knowledge/<type>/<id>.md
```

**The proposed/knowledge boundary is sacred.** Nothing — not the reflector, archaeologist, packs installer, sync importer, PR miner, or skill author — writes directly to `.apex/knowledge/`. They all write to `.apex/proposed/` (or `.apex/proposed-skills/`) and the existing `src/promote/` pipeline gates the move. `--force` exists but is the only escape hatch and stamps `last_validated`. If you're adding a new "we learned X" feature, your output target is `.apex/proposed/`.

**Episodes are session-scoped JSONL, not knowledge.** Hooks append to `.apex/episodes/<APEX_EPISODE_ID>/{prompts,tools,failures,corrections,retrievals,edits}.jsonl` plus `meta.json`. Episodes are gitignored and ephemeral; the reflector distills them into proposals. Schema is in `specs/episode-schema.md`. Any new capture point should follow the JSONL-append pattern in `src/cli/commands/hook.ts` and tag rows with the same `kind` field shape used elsewhere.

**Knowledge entry frontmatter is enforced by spec.** `specs/knowledge-schema.md` defines `id`, `type` (`decision|pattern|gotcha|convention`), `applies_to` (`user|team|all`), `confidence` (`low|medium|high`), `sources[]`, `created`, `last_validated`, `supersedes`, `tags`. Validate via `src/promote/validate.ts`. Every proposal must cite at least one source — ungroundable proposals are dropped. Reflection-authored entries are never `high` confidence; only `src/confidence/calibrator.ts` can promote to `high`.

**Retrieval is tiered.** Tier 1 SQLite FTS5 (always on, `src/recall/store.ts`); Tier 2 LanceDB vectors (opt-in via `apex enable vector`, `src/recall/vector/`); Tier 3 tree-sitter symbol index (opt-in, `src/codeindex/`). Hybrid fusion is **Reciprocal Rank Fusion (k=60)** in `src/recall/hybrid.ts`. Confidence weights `{low:0.5, medium:0.85, high:1.0}` multiply fused scores; `low`-confidence entries are filtered unless an explicit id appears in the query (explicit-search bypass). Don't add a "score boost" without going through the hybrid layer.

**Hooks have a hard time budget.** SessionStart `<1s`, SessionEnd `<5s`. They must `exit 0` unconditionally so they never block Claude. Heavy work (reflection, embedding) is async/post-session in subagents. The hook router lives in `src/cli/commands/hook.ts` and dispatches by event name; new hook handlers go there.

**Redactor runs on every write.** `src/redactor/` masks secrets per `specs/redactor-design.md`. Any code path that writes to `.apex/episodes/` or `.apex/knowledge/` (or proposes to either) must call the redactor on text content. Phase 5 added `npm-token`, `heroku-api-key`, `azure-client-secret`; pattern set is in `src/redactor/patterns.ts`.

**Zero external network calls in production paths.** `apex audit` enforces this — see `src/audit/scanner.ts`. `git`, `gh`, `gpg` invoked locally are fine; HTTP is not. If you add networked code, gate it behind an explicit opt-in flag and write a test that proves `apex audit` still reports zero production findings.

## Path conventions

Always derive paths via `projectPaths(root)` from `src/util/paths.ts` — never hardcode `.apex/...` or `.claude/...` strings. Templates ship at `templates/` and are resolved via `templatesDir()` in the same file (works in both `src/` dev and `dist/` packed mode).

## CLI registration pattern

`src/cli/index.ts` registers each subcommand via a `try { dynamic import } catch { /* skip */ }` wrapper. This is intentional — modules can be optional, and a broken one won't kill the whole CLI. New commands follow the existing `register<Name>` shape and call `program.addCommand(<name>Command())`. Each command file exports a `Command` factory (see `src/cli/commands/reflect.ts` as the canonical example: commander + kleur + `--cwd` + `--dry-run`).

## ESM + TypeScript gotchas

- `"type": "module"` + `moduleResolution: "bundler"`: **all relative imports must end in `.js`** even when importing a `.ts` file. `import { x } from "./foo.js"` is correct.
- `noUncheckedIndexedAccess: true` is on — array/object index access returns `T | undefined`. Use `arr[i]!` only after a length check, or assign to a temp.
- `strict: true`. No implicit `any`, no implicit `override`.
- `verbatimModuleSyntax: false` — type-only imports don't need the `type` keyword (but use it where it improves clarity).

## Subagents and skills

`templates/claude/agents/apex-*.md` are agent prompts shipped into target repos. `templates/claude/skills/apex-*/SKILL.md` are the skill files. They are **markdown for Claude to read** — not code we execute. The corresponding TS modules under `src/reflector/`, `src/curator/`, `src/archaeologist/` etc. implement the deterministic heuristics the agents call via `apex <verb> --dry-run` then `apex <verb>`. Two-call separation (analyse, then write) is a guardrail — preserve it when adding new agents.

## Phase discipline

The PRD splits work into Phase 0–6. Each phase has explicit exit criteria and is tagged in the PRD with the date it shipped. When you complete work that closes a PRD checkbox, update the PRD checkbox in the same commit. New features that don't map to an existing phase belong in Phase 6 or a new phase appended to §6.

## Running the CLI you're developing

`npm run dev -- <subcommand> --cwd /path/to/test/project` runs the unbuilt CLI against any project root. Use a tmpdir with a fake `.apex/` for fast iteration; tests already do this extensively (see `test/integration/` and any `*/integration.test.ts`).
