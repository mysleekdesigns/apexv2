---
id: spec-install
title: APEX Install Path & Bootstrap
status: draft
phase: 0
last_updated: 2026-04-26
owner: foundation
---

# APEX Install Path & Bootstrap

This spec defines how a user gets APEX onto a project, what files appear, what the user sees, and how upgrades and uninstalls behave. Cross-references: PRD §0.7, §3, §5.1, §7.1, §9; sibling specs `specs/compatibility.md` (Claude Code minimum version) and `specs/threat-model.md` + `specs/redactor-design.md` (the redactor that activates on first install).

---

## 1. Default install: `npx apex@latest init`

```bash
cd my-project
npx apex@latest init
```

### Why npx is the default

- **No global install.** A user can try APEX in a single repo without `sudo`, without polluting `$PATH`, and without committing to a global toolchain. Critical for the "vibe-coder" persona in PRD §3 who is one curl-pipe away from giving up.
- **Ubiquity.** Anyone running Claude Code on a project that already has `package.json` already has Node. Even on Python/Go/Rust repos, Node is the most commonly pre-installed runtime on developer machines.
- **Speed.** `npx` resolves and runs in seconds; no install step appears in the user's history or shell rc files.
- **Versioning.** `npx apex@latest` and `npx apex@next` give us channel control without asking users to remember flags.
- **Per-project versioning.** Each project's `.apex/install.json` (see §5) pins the APEX version that ran `init`, so a future re-run does not silently upgrade.

### What npx does *not* do, and how we mitigate

- npx caches binaries; users on flaky networks see a slow first run. Mitigation: the install banner prints "fetching APEX (≈2 MB)…" so the wait is explained, not mysterious.
- Users without Node fall back to the pipx mirror (§2) or the curl-pipe (§3).

---

## 2. Mirror: `pipx install apex-cc`

```bash
pipx install apex-cc
apex init
```

### Why pipx, not pip

- **Isolation.** `pipx` installs each CLI in its own venv, so APEX's deps never collide with the user's project deps. `pip install apex-cc` into a global or project env is a known foot-gun on Python projects.
- **CLI exposure.** `pipx` puts the `apex` binary on `$PATH` automatically. `pip` requires manual `python -m apex_cc` invocation or shimming.
- **Update story.** `pipx upgrade apex-cc` is one command; a `pip` install requires the user to remember which env they put it in.

`pip install apex-cc` is documented as a tertiary option for environments where pipx is unavailable (locked-down CI), but is not recommended.

---

## 3. Distribution channels

| Channel | Package / URL | Status |
|---|---|---|
| npm | `apex-cc` | TODO: reserve `apex-cc` on npm before public announce. The shorter `apex` is taken; `apex-cc` (Adaptive Project Experience for Claude Code) is the canonical reservation. Until reserved, treat as unverified. |
| PyPI | `apex-cc` | TODO: reserve `apex-cc` on PyPI in the same window as npm. |
| curl-pipe | `curl -fsSL https://apex.dev/install \| bash` | For environments without Node or Python. Detects platform, downloads a single static binary (Phase 5: today, scripted shim that requires Node or Python anyway). |
| Claude Code plugin registry | `apex` | Phase 5; not part of v1 install path. |

The npm package and the PyPI package are functionally equivalent: same CLI, same bootstrap, same files written. The Node version is the build-of-record; the Python version vendors a thin wrapper that shells out to a bundled Node runtime, or (Phase 5) ships a native Python rewrite.

---

## 4. Install flow

```
User                  apex CLI                     Filesystem              Background
 │                       │                              │                       │
 │  npx apex@latest init │                              │                       │
 ├──────────────────────►│                              │                       │
 │                       │  detect repo + stack         │                       │
 │                       ├──── read package.json,       │                       │
 │                       │     pyproject.toml, go.mod,  │                       │
 │                       │     Cargo.toml, lockfiles,   │                       │
 │                       │     .github/workflows, etc.  │                       │
 │                       │                              │                       │
 │  permissions banner   │                              │                       │
 │◄──────────────────────┤                              │                       │
 │  [y/N] confirm        │                              │                       │
 ├──────────────────────►│                              │                       │
 │                       │  write files (§6)            │                       │
 │                       ├─────────────────────────────►│                       │
 │                       │  activate redactor           │                       │
 │                       │  (see specs/redactor-design) │                       │
 │                       │                              │                       │
 │                       │  spawn archaeologist agent   │                       │
 │                       ├──────────────────────────────┼──────────────────────►│
 │                       │                              │   reads git log,      │
 │                       │                              │   README, tests, PRs  │
 │                       │                              │   writes proposals    │
 │                       │                              │   to .apex/proposed/  │
 │  stats banner         │                              │                       │
 │◄──────────────────────┤                              │                       │
 │                       │                              │                       │
```

Numbered:

1. **Detect.** Inspect repo (§7).
2. **Confirm.** Print the permissions surface (§8) and stack findings; require `y` (skipped with `--yes` or `CI=true`).
3. **Write files.** Atomic: stage to `.apex/.staging/`, then move into place. Existing user files are never overwritten; conflicts (e.g. a pre-existing `CLAUDE.md`) are merged via section markers or saved as `.apex.bak`.
4. **Activate redactor.** Required before any episode or knowledge file can be written. See `specs/redactor-design.md`.
5. **Spawn archaeologist** in background (detached subagent invocation). Writes to `.apex/proposed/` only — never auto-merges.
6. **Print stats banner**:

```
APEX installed.
  stack:        Node 20 / TypeScript / Next.js / pnpm / vitest / eslint / GitHub Actions
  hooks:        5 installed in .claude/settings.json
  knowledge:    0 entries (archaeologist running in background; check `apex status` in ~30s)
  next session: APEX will load at SessionStart automatically.

Run `apex status` for details. `apex uninstall` removes everything.
```

---

## 5. Idempotency & version pinning

A re-run of `npx apex init` detects a prior install and switches to upgrade mode:

```
$ npx apex@latest init
APEX is already installed (v0.3.1, installed 2026-04-22 via npx).
  Did you mean: apex upgrade?
  Or re-run init with --force to reinstall (your knowledge will be preserved).
```

### `.apex/install.json`

APEX-owned. Written on first install, updated on every upgrade. Single source of truth for "what version of APEX is in this repo".

```json
{
  "apex_version": "0.3.1",
  "installed_at": "2026-04-26T14:32:11Z",
  "last_upgraded_at": "2026-04-26T14:32:11Z",
  "source_channel": "npm",
  "source_command": "npx apex@latest init",
  "schema_versions": {
    "knowledge": 1,
    "episode": 1,
    "config": 1
  },
  "claude_code_min_version": "2.1.0"
}
```

`apex upgrade` reads this file, runs schema migrations if needed, rewrites only APEX-owned files (§6), and updates `last_upgraded_at`. Knowledge files are never touched.

---

## 6. Files written

| Path | Owner | Notes |
|---|---|---|
| `CLAUDE.md` | both | Created if missing. If present, APEX adds a managed section delimited by `<!-- apex:begin -->` / `<!-- apex:end -->` markers. User edits outside the markers are preserved on upgrade. |
| `CLAUDE.local.md` | user | APEX never writes here. Created empty + gitignored on first install only. |
| `.claude/settings.json` | both | Hooks block is APEX-managed (delimited by markers in JSON via a `_apex_managed: true` key on each hook entry). User permission entries are preserved. |
| `.claude/rules/00-stack.md` | apex | Auto-generated from detection (§7). Re-rewritten on upgrade. |
| `.claude/rules/10-conventions.md` | apex | Stub on install; populated by curator. |
| `.claude/rules/20-gotchas.md` | apex | Stub on install; populated by reflector. |
| `.claude/skills/apex-recall/SKILL.md` | apex | Replaced verbatim on upgrade. |
| `.claude/skills/apex-reflect/SKILL.md` | apex | Replaced verbatim on upgrade. |
| `.claude/skills/apex-review/SKILL.md` | apex | Replaced verbatim on upgrade. |
| `.claude/agents/apex-reflector.md` | apex | Replaced on upgrade. |
| `.claude/agents/apex-curator.md` | apex | Replaced on upgrade. |
| `.claude/agents/apex-archaeologist.md` | apex | Replaced on upgrade. |
| `.claude/hooks/on-session-start.sh` | apex | Replaced on upgrade. Executable bit set. |
| `.claude/hooks/on-prompt-submit.sh` | apex | Replaced on upgrade. |
| `.claude/hooks/on-post-tool.sh` | apex | Replaced on upgrade. |
| `.claude/hooks/on-post-tool-failure.sh` | apex | Replaced on upgrade. |
| `.claude/hooks/on-pre-compact.sh` | apex | Replaced on upgrade. |
| `.claude/hooks/on-session-end.sh` | apex | Replaced on upgrade. |
| `.mcp.json` | both | Adds `apex-mcp` entry inside an APEX-managed block. Other MCP servers preserved. |
| `.apex/install.json` | apex | §5. |
| `.apex/config.toml` | user | Defaults written on first install only; never overwritten on upgrade. |
| `.apex/knowledge/{decisions,patterns,gotchas,conventions}/` | user | Empty dirs on install. APEX never overwrites contents. |
| `.apex/proposed/` | apex-then-user | Archaeologist writes here; user reviews and moves to `knowledge/`. |
| `.apex/episodes/` | apex | Gitignored. Transient. |
| `.apex/index/` | apex | Gitignored. Rebuildable. |
| `.apex/metrics/` | apex | Gitignored. |
| `.apex/.gitignore` | apex | Replaced on upgrade. |
| `.gitignore` | both | APEX appends `CLAUDE.local.md` and any missing `.apex/` ignores inside an APEX-managed block. |

"Both" means a managed-section pattern: APEX owns a delimited region, user owns everything else. "User" means written once and never touched again. "apex" means owned outright and replaced on upgrade.

---

## 7. Detection rules

APEX runs detectors in order. First match wins for primary language; multiple frameworks may be detected.

### Language

| Language | Signals (any match) |
|---|---|
| Node / TS | `package.json`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `tsconfig.json` |
| Python | `pyproject.toml`, `requirements*.txt`, `Pipfile`, `setup.py`, `poetry.lock`, `uv.lock` |
| Go | `go.mod`, `go.sum` |
| Rust | `Cargo.toml`, `Cargo.lock` |

### Framework (Node)

- Next.js: `next` in `package.json` deps OR `next.config.{js,ts,mjs}`.
- Remix: `@remix-run/*` in deps OR `remix.config.js`.
- Express / Fastify / Hono: dep presence.
- Vue / Nuxt / Svelte / SvelteKit: dep presence + config file.

### Framework (Python)

- Django: `django` in deps OR `manage.py`.
- FastAPI / Flask: dep presence.
- Pydantic-only / lib-only: no framework match → marked "library".

### Package manager

- Node: precedence `pnpm-lock.yaml` > `yarn.lock` > `bun.lockb` > `package-lock.json` > `packageManager` field.
- Python: precedence `uv.lock` > `poetry.lock` > `Pipfile.lock` > `requirements.txt`.
- Go: `go.mod` is canonical.
- Rust: `Cargo.lock` is canonical.

### Test runner

- Node: `vitest`, `jest`, `mocha`, `playwright`, `cypress` in deps; `test` script in `package.json`.
- Python: `pytest`, `unittest`, `nose2` in deps; `pyproject.toml` `[tool.pytest]`.
- Go: `go test` is canonical.
- Rust: `cargo test` is canonical.

### Lint / format

- Node: `eslint`, `biome`, `prettier`, `oxlint`.
- Python: `ruff`, `black`, `flake8`, `mypy`, `pyright`.
- Go: `gofmt`, `golangci-lint` (config file).
- Rust: `cargo fmt`, `clippy`.

### CI provider

- `.github/workflows/*.yml` → GitHub Actions.
- `.gitlab-ci.yml` → GitLab CI.
- `.circleci/config.yml` → CircleCI.
- `.buildkite/*` → Buildkite.
- `azure-pipelines.yml` → Azure Pipelines.

Findings are written to `.claude/rules/00-stack.md` and `.apex/knowledge/conventions/_pending-stack.md` (queued for user approval, per PRD §1.5).

---

## 8. Permissions surface

Before writing anything, APEX prints exactly:

```
APEX will:
  • Write to: CLAUDE.md, .claude/, .mcp.json, .apex/, .gitignore
  • Install 6 hooks: SessionStart, UserPromptSubmit, PostToolUse,
                    PostToolUseFailure, PreCompact, SessionEnd
  • Register 1 MCP server: apex-mcp (stdio, local-only, no network)
  • Run 1 background subagent once: apex-archaeologist (reads git, README, tests)
  • Make zero network calls. `apex audit` proves this.

Continue? [y/N]
```

Hook list mirrors PRD §1.3. The redactor (sibling spec `specs/redactor-design.md`) activates immediately and gates every write to `.apex/episodes/` and `.apex/knowledge/`.

---

## 9. Uninstall: `npx apex uninstall`

Removes only APEX-owned files and managed sections:

- All of `.claude/skills/apex-*/`.
- All of `.claude/agents/apex-*.md`.
- All of `.claude/hooks/on-*.sh` written by APEX (idempotency token in file header).
- The APEX-managed block in `.claude/settings.json`.
- The APEX-managed block in `.mcp.json`.
- The APEX-managed block in `CLAUDE.md` (the rest of `CLAUDE.md` is preserved; if APEX wrote the whole file and it has no user edits since, the file is removed).
- The APEX-managed block in `.gitignore`.
- `.apex/install.json`, `.apex/config.toml`, `.apex/episodes/`, `.apex/index/`, `.apex/metrics/`, `.apex/.gitignore`.

Explicitly **not** removed:

- `.apex/knowledge/` — user data. Uninstall prints: "Your knowledge files are kept in `.apex/knowledge/`. Delete the directory yourself if you don't want them."
- `.apex/proposed/` — same rationale.
- `CLAUDE.local.md` — user data.

`npx apex uninstall --purge` adds the knowledge and proposed directories to the removal set, with a second confirmation.

---

## 10. Failure modes

| Condition | Behavior |
|---|---|
| Non-git repo | Warn: "APEX works best in a git repo so knowledge can be reviewed and shared. Continue anyway? [y/N]". On confirm, install proceeds; archaeologist skips git-log mining. |
| Claude Code not installed | Refuse: "APEX requires Claude Code ≥ X.Y.Z (see specs/compatibility.md). Install it from https://claude.com/code and re-run." Exit 2. |
| Claude Code present but below minimum version | Refuse with the same message; quote the detected version. Cross-reference `specs/compatibility.md` for the canonical minimum. |
| Windows (native, not WSL) | Hooks are bash scripts. Refuse with: "APEX hooks require a POSIX shell. Install WSL2 and re-run inside your WSL distribution. Native PowerShell support is on the roadmap." Exit 2. |
| Corporate proxy | Honor `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` for the npx download. The install itself is offline after fetch (no network calls during init). Document `--offline` for fully airgapped runs (requires a pre-fetched tarball). |
| `.apex/` exists but `install.json` is missing | Treat as a corrupted install. Print recovery instructions; require `--force` to overwrite. |
| Disk full / permission denied | Roll back staged writes from `.apex/.staging/`. Exit 1 with the underlying error. |

---

## 11. Versioning

- **Semver.** `MAJOR.MINOR.PATCH`. Schema versions in `install.json` are bumped independently of the CLI version; an upgrade migration is required when any schema version increments.
- **Channels.** `@latest` (stable), `@next` (pre-release), `@<exact>` (pin). Identical channels exist on PyPI via `apex-cc==X.Y.Z`.
- **Minimum Claude Code version.** Defined in `specs/compatibility.md`. APEX reads that value at build time and embeds it in the published package; the install-time check is the enforcement point.
- **Deprecation policy.** Two minor versions of forward compatibility for knowledge schemas. A schema bump that breaks reads ships with a one-shot migrator invoked by `apex upgrade`.

---

## 12. Open items

- [ ] Reserve `apex-cc` on npm and PyPI.
- [ ] Decide on the bundled-Node fallback for the curl-pipe path (single static binary vs. shim that requires Node anyway).
- [ ] Native Windows hook story: PowerShell rewrite or WSL-only forever?
- [ ] `apex upgrade --dry-run` parity with `apex init --dry-run`.
