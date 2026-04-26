# APEX

> Adaptive Project Experience — a self-learning project intelligence layer for [Claude Code](https://claude.com/code). It captures what happens in each session, distills durable lessons, and surfaces the right knowledge at the right moment so Claude gets measurably better at *your* project after every session.

**Status:** 🚧 Phase 0 — Foundation & Spec. This repo currently contains the PRD and specs only; no installable package yet. Track progress in [PRD.md](./PRD.md).

---

## 60-second install (when Phase 1 ships)

```bash
cd my-project
npx apex@latest init
```

Expected output:

```
APEX will:
  • Write to: CLAUDE.md, .claude/, .mcp.json, .apex/, .gitignore
  • Install 6 hooks (SessionStart, UserPromptSubmit, PostToolUse, ...)
  • Register 1 MCP server: apex-mcp (stdio, local-only, no network)
  • Make zero network calls. `apex audit` proves this.
Continue? [y/N] y

APEX installed.
  stack:        Node 20 / TypeScript / Next.js / pnpm / vitest / GitHub Actions
  hooks:        6 installed in .claude/settings.json
  knowledge:    0 entries (archaeologist running in background)
  next session: APEX will load at SessionStart automatically.
```

That's it. No global install, no daemon, no SaaS.

## What just happened

- **`CLAUDE.md`** — a short, index-style memory file Claude reads at the start of every session. Imports rules from `.claude/rules/`.
- **`.claude/skills/apex-*/`** — small skills Claude invokes to recall past decisions, reflect on what just happened, and review knowledge.
- **`.claude/hooks/`** — fast scripts that fire at session start, after each tool, and at session end. They capture what happened; they don't slow Claude down (each is budgeted under 1s).
- **`.apex/knowledge/`** — plain Markdown files for decisions, patterns, gotchas, and conventions APEX learns about your project. Commit them; review them; diff them.
- **`.apex/episodes/`** — transient session logs (gitignored). Reflection turns these into durable knowledge.
- **An archaeologist subagent** runs once in the background to bootstrap an initial knowledge base from your `git log`, README, tests, and any open PRs. It writes proposals to `.apex/proposed/` for you to approve — nothing is auto-committed.

## Your next session

The next time you open Claude Code in this repo, the first thing you'll see is a one-line stats banner:

```
APEX loaded — 14 patterns, 3 gotchas, 2 active conventions.
```

Then, when you ask Claude to do something, it will quietly check past decisions and surface anything relevant. When you correct it ("no, we use pnpm here"), APEX captures that and surfaces it next time. Over a few sessions you should notice Claude stops repeating mistakes you've already corrected.

Power-user commands when you want them:

```bash
apex status         # knowledge stats and last reflection time
apex search "auth"  # query the knowledge base directly
apex review         # PR-ready diff of pending knowledge proposals
apex eval           # run the eval harness (Phase 4)
apex audit          # list every external call APEX makes (default: zero)
```

## If you don't use Node

```bash
pipx install apex-cc && apex init
```

`pipx` (not `pip`) keeps APEX isolated from your project's Python environment. See [`specs/install.md`](./specs/install.md#2-mirror-pipx-install-apex-cc) for why.

## Where to learn more

- [PRD.md](./PRD.md) — full product spec, architecture, phased plan.
- [specs/install.md](./specs/install.md) — install path, file ownership, upgrade and uninstall behaviour.
- [specs/compatibility.md](./specs/compatibility.md) — minimum Claude Code version and primitive feature matrix. *(sibling spec)*
- [specs/threat-model.md](./specs/threat-model.md) — what must never enter knowledge files. *(sibling spec)*
- [specs/redactor-design.md](./specs/redactor-design.md) — the secret-redaction layer that activates on first install. *(sibling spec)*

## License

MIT. See [LICENSE](./LICENSE) (to be added).

Built on the documented primitives of Anthropic's [Claude Code](https://claude.com/code). APEX is an independent project and not affiliated with Anthropic.
