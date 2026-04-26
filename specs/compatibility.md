# Claude Code Compatibility

Defines the minimum Claude Code surface APEX depends on, the events APEX subscribes to, and the file formats APEX writes. Anything not in this document is not a supported integration point.

## Pinned minimum version

```
claude-code >= 2.1.0
```

Documented in `package.json` `engines.claudeCode` once Claude Code publishes such a field; until then, `apex init` runs a runtime check via `claude --version` and refuses to install on older builds.

### Why 2.1.0 (feature-by-feature)

| Feature APEX needs | Why we need it |
|---|---|
| Deferred MCP tool loading | `apex-mcp` exposes 5+ tools; loading schemas eagerly inflates every session start. Deferred load means schemas only fetch when the recall skill actually triggers. |
| Agent / subagent hooks (SessionStart, SessionEnd, PreCompact, PostToolUse, PostToolUseFailure, UserPromptSubmit) with stdin-JSON contract | The capture layer is hooks; without all six events APEX cannot maintain the episode log or trigger reflection. |
| Subagent isolated-context memory (per-subagent SKILL files surfaced into context) | Reflector and curator must have their own memory and not pollute the main session. |
| `${CLAUDE_PROJECT_DIR}` / `${CLAUDE_PLUGIN_DATA}` env vars in hook scripts | Hook scripts need a stable cwd reference and a plugin-upgrade-safe state path. |
| `.claude/skills/<name>/SKILL.md` auto-discovery with frontmatter `description` matching | The recall skill is auto-invoked based on its `description`; pre-2.1 versions required explicit invocation. |
| `settings.json` schema with per-event hook arrays and `matcher` filtering | We attach `Bash`-only matchers on `PostToolUse`; older formats applied hooks globally and were too noisy. |

## Feature-to-primitive mapping

| APEX feature | Claude Code primitive | Min version stable |
|---|---|---|
| Capture hooks | `.claude/settings.json` `hooks` blocks (SessionStart, UserPromptSubmit, PostToolUse, PostToolUseFailure, PreCompact, SessionEnd) | 2.1.0 |
| Recall skill | `.claude/skills/<name>/SKILL.md` with frontmatter description-based auto-invocation | 2.1.0 |
| Reflector / curator / archaeologist subagents | `.claude/agents/<name>.md` with isolated context window | 2.1.0 |
| `apex-mcp` server | MCP stdio transport per `.mcp.json`, deferred tool loading | 2.1.0 |
| Project + user + local memory layering | `CLAUDE.md`, `~/.claude/CLAUDE.md`, `CLAUDE.local.md` hierarchy | 2.0.0 (predates pin) |
| `@import` includes from CLAUDE.md to `.claude/rules/*.md` | CLAUDE.md `@<path>` import syntax | 2.1.0 |
| Plugin packaging (Phase 5) | Claude Code plugin manifest + `${CLAUDE_PLUGIN_DATA}` | 2.2.0 (gated; APEX core does not require this until Phase 5) |
| Scheduled tasks (Phase 4 drift) | Claude Code scheduled tasks runtime | 2.3.0 (gated; opt-in only) |

## Hook event subscription

APEX subscribes to exactly six events. Each row is a contract: APEX assumes Claude Code sends the listed payload to the hook on stdin (JSON), and APEX writes the listed artefact.

| Event name (Claude Code) | APEX hook script | Payload contract APEX assumes (stdin JSON) | APEX side effect |
|---|---|---|---|
| `SessionStart` | `.claude/hooks/on-session-start.sh` | `{ session_id, started_at, model, claude_code_version, repo_head_sha?, cwd }` | Create `.apex/episodes/<id>/`, write `meta.json`, export `APEX_EPISODE_ID`, inject top-N knowledge entries on stdout (≤ 2 KiB tokens) |
| `UserPromptSubmit` | `.claude/hooks/on-prompt-submit.sh` | `{ session_id, ts, turn, prompt }` | Append redacted line to `prompts.jsonl`; emit semantic-matched gotchas on stdout for prepend |
| `PostToolUse` | `.claude/hooks/on-post-tool.sh` | `{ session_id, ts, turn, tool_call_id, tool_name, input, output, exit_code, duration_ms, error?, files_touched? }` | Append to `tools.jsonl`; if `exit_code != 0` also append to `failures.jsonl` |
| `PostToolUseFailure` | `.claude/hooks/on-post-tool-failure.sh` | `{ session_id, ts, turn, tool_call_id, tool_name, error, exit_code, stderr? }` | Idempotent append to `failures.jsonl` keyed by `tool_call_id` |
| `PreCompact` | `.claude/hooks/on-pre-compact.sh` | `{ session_id, ts, turn, todos?, open_files?, recent_messages? }` | Write `snapshots/pre-compact-<n>.json` |
| `SessionEnd` | `.claude/hooks/on-session-end.sh` | `{ session_id, ts, ended_at, hooks_fired_count? }` | Update `meta.json.ended_at`, enqueue reflection job |

**Matchers**: APEX uses Claude Code's hook `matcher` to scope `PostToolUse` to the `Bash`, `Edit`, `Write`, and `Read` tools (cheap to log). All other hooks have no matcher and fire unconditionally.

**Timeouts**: every APEX hook entry in `settings.json` carries `timeout: 1000` (ms). SessionStart's hot-path budget is 800ms p99 (per PRD §10).

**Stdout protocol**: SessionStart and UserPromptSubmit may emit text on stdout, which Claude Code injects into context (per documented hook contract). Other hooks write to stdout only for diagnostics and emit nothing functional.

### Payload-shape resilience

Claude Code is on a fast cadence; payload field names may shift. Each APEX hook script:
1. Pipes stdin to `jq` with a defensive selector (e.g. `.tool_name // .toolName // .name`).
2. Logs unrecognised payloads to `.apex/metrics/hook-warnings.jsonl` with the unknown shape.
3. Exits 0 even on parse failure, so a payload regression never blocks Claude Code.

## MCP transport

- **Transport**: stdio (per PRD §3.3 and Claude Code MCP defaults). HTTP transport is not supported by APEX in v1.
- **Registration**: `apex init` adds an entry to `.mcp.json`:
  ```json
  {
    "mcpServers": {
      "apex": {
        "type": "stdio",
        "command": "node",
        "args": ["${CLAUDE_PROJECT_DIR}/.apex/mcp/server.js"],
        "env": { "APEX_PROJECT_DIR": "${CLAUDE_PROJECT_DIR}" }
      }
    }
  }
  ```
- **Deferred tool loading**: APEX ships tool *names* in the server's `list_tools` response with minimal metadata; full input schemas are returned only when Claude Code requests a specific tool's schema (typically via the recall skill). This keeps SessionStart cheap.
- **Tools exposed** (per PRD §7.4): `apex_search`, `apex_get`, `apex_record_correction`, `apex_propose`, `apex_stats`.

## File format versions APEX writes

Every persistent artefact embeds an explicit version so future APEX releases can migrate older files in place.

| File | Version field | Current value |
|---|---|---|
| `.claude/skills/apex-*/SKILL.md` | YAML frontmatter `apex_skill_format` | `1` |
| `.claude/agents/apex-*.md` | YAML frontmatter `apex_agent_format` | `1` |
| `.claude/settings.json` (APEX-managed block, delimited by `// APEX:BEGIN` / `// APEX:END` comments — Claude Code preserves these in JSONC mode) | top-level `apex_settings_version` (advisory; not part of Claude Code's schema) | `1` |
| `.apex/knowledge/**/*.md` frontmatter | implicit via `schema_version` not currently emitted; rely on field-presence migration. Reserved for v2. | n/a |
| `.apex/episodes/<id>/meta.json` and JSONL lines | `schema_version` field | `1` |
| `.apex/config.toml` | `version` key | `1` |
| `.mcp.json` | Claude Code's own schema; APEX writes only the `mcpServers.apex` entry. | n/a |

## Claude Code skill / agent / settings format assumptions

- **SKILL.md** — YAML frontmatter REQUIRED with `name`, `description`, plus APEX-specific `apex_skill_format`. Body is freeform Markdown. Auto-invocation triggered by `description` keyword match (Claude Code 2.1+ behaviour).
- **agent.md** — YAML frontmatter REQUIRED with `name`, `description`, `tools` (array of allowed tool names; restricting tools is the compatibility-load-bearing field — older versions ignored it), `model` (optional), plus APEX-specific `apex_agent_format`.
- **settings.json** — APEX writes inside fenced markers so the user (and APEX itself) can rewrite the block without clobbering user hooks. APEX never edits outside its markers. Hook entries follow Claude Code's `{ matcher, hooks: [{ type, command, timeout }] }` shape.

## Forward-compatibility and graceful degradation

`apex init` and the SessionStart hook both perform a Claude Code version check. Decision tree:

1. **`claude --version` returns < 2.1.0** → `apex init` refuses, prints upgrade instructions; SessionStart hook (if installed by an old project) emits a one-line warning and skips its work.
2. **Major version newer than APEX has tested (e.g. Claude Code 3.x while APEX targets 2.x)** → APEX continues with a *compat warning* logged to `.apex/metrics/compat-warnings.jsonl`, runs in safe mode: capture hooks still write to episodes, but reflector auto-merge is forced OFF (everything routes to `.apex/proposed/` for human review). User sees `APEX: running in compat mode against Claude Code 3.x. Run apex upgrade.`
3. **Unknown hook event fires** (Claude Code added a new event APEX doesn't subscribe to) → no-op; APEX is not affected.
4. **Known hook event payload changed shape** (renamed field) → defensive `jq // fallback` selectors recover; if all selectors miss, the hook logs to `hook-warnings.jsonl` and exits 0.
5. **MCP tool schema rejected by newer Claude Code** → `apex-mcp` returns a degraded tool list that excludes the unsupported tool; recall skill falls back to file-system grep.
6. **`SKILL.md` or `agent.md` frontmatter format changed** → `apex doctor` detects mismatch via `apex_skill_format` / `apex_agent_format`, refuses to overwrite user files, prints a one-page migration plan.

The invariant: APEX never blocks Claude Code. A compatibility failure degrades capture or reflection but never breaks the developer's session.
