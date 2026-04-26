# Episode Schema

Episodes are the raw, append-only transcript of a Claude Code session. Hooks write to them; the reflector reads them; the eval harness replays them. They are **gitignored, transient**, and durable lessons get promoted into `.apex/knowledge/` by the reflector.

## Directory layout

```
.apex/episodes/<episode-id>/
├── meta.json           # session-wide metadata (single object, rewritten on session end)
├── prompts.jsonl       # one line per UserPromptSubmit
├── tools.jsonl         # one line per PostToolUse (success or failure)
├── failures.jsonl      # one line per PostToolUseFailure (subset of tools.jsonl, easier to scan)
├── corrections.jsonl   # one line per detected user correction or confirmation
├── edits.jsonl         # one line per file edit (Edit/Write/NotebookEdit tool result)
├── retrievals.jsonl    # one line per knowledge entry surfaced by the recall skill
├── snapshots/          # PreCompact snapshots, optional
│   └── pre-compact-<n>.json
└── summary.md          # written by reflector at SessionEnd; human-readable narrative
```

- All files are append-only **except** `meta.json` (overwritten at SessionEnd) and `summary.md` (written once).
- `failures.jsonl` is a convenience denormalisation of `tools.jsonl` filtered to non-zero exit. Both files MUST agree.
- Missing files are valid: a session with no failures has no `failures.jsonl`.

## Episode ID format

```
YYYY-MM-DD-HHMM-<4charhash>
```

- Date and time are the `started_at` UTC timestamp truncated to minute precision.
- `<4charhash>` is the first 4 hex chars of `sha1(uuidv4())`, lowercase. Provides collision resistance when two sessions start in the same minute.
- Regex: `^\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{4}$`.
- Example: `2026-04-26-1432-9bc4`.

This format is sortable lexicographically by start time, deterministic, and unambiguous.

## Lifecycle

1. **SessionStart** hook fires →
   - Computes episode id, exports `APEX_EPISODE_ID` for downstream hooks.
   - Creates `.apex/episodes/<id>/`.
   - Writes initial `meta.json` with `started_at`, `model`, `claude_code_version`, `repo_head_sha`.
2. **UserPromptSubmit** → append to `prompts.jsonl`.
3. **PostToolUse** → append to `tools.jsonl`. If `exit_code != 0` or `error` is non-null, also append to `failures.jsonl`. If the tool is `Edit`/`Write`/`NotebookEdit` and exit_code is 0, also append to `edits.jsonl`.
4. **PostToolUseFailure** (event distinct from PostToolUse on some Claude Code versions) → append to `failures.jsonl`. The hook MUST be idempotent against PostToolUse already having written a failure row for the same `tool_call_id`.
5. **PreCompact** → snapshot todos, open files, recent decisions to `snapshots/pre-compact-<n>.json` (n = monotonically increasing).
6. Correction detection (in-process or post-hoc): when a UserPromptSubmit matches a correction heuristic (`/^(no|nope|don't|stop|actually|use .* instead)/i`, or explicit `/apex-thumbs-down`), append a row to `corrections.jsonl`.
7. **Recall skill invocation** (the `apex-recall` skill or `apex_search` MCP tool) → append one row per surfaced entry to `retrievals.jsonl`. The reflector backfills `referenced: true` after SessionEnd if a subsequent assistant turn cited the entry id.
8. **SessionEnd** →
   - Update `meta.json` with `ended_at`, final `hooks_fired_count`.
   - Enqueue a reflection job (`apex-reflector`) referencing this episode id.
9. **Reflector** (async) → reads all files, writes `summary.md`, may write proposed knowledge to `.apex/proposed/`.

## Retention

- `.apex/episodes/` is gitignored by default. Episodes are transient working memory.
- Default local retention: 30 days. `apex curate` deletes episodes older than the configured window once their `summary.md` exists and the reflector has marked them processed.
- An episode without a `summary.md` is never deleted automatically (failed reflection is recoverable).

## `meta.json` schema

Single JSON object. Rewritten in full at SessionEnd.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://apex.dev/schemas/episode-meta.json",
  "title": "APEX Episode Meta",
  "type": "object",
  "required": [
    "episode_id",
    "session_id",
    "started_at",
    "model",
    "claude_code_version",
    "repo_head_sha",
    "schema_version"
  ],
  "properties": {
    "schema_version": { "const": 1 },
    "episode_id": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}-\\d{4}-[0-9a-f]{4}$" },
    "session_id": { "type": "string", "description": "Claude Code's session id (opaque)" },
    "started_at": { "type": "string", "format": "date-time" },
    "ended_at": { "type": ["string", "null"], "format": "date-time" },
    "model": { "type": "string", "description": "e.g. claude-opus-4-7" },
    "claude_code_version": { "type": "string", "description": "Reported by Claude Code at SessionStart" },
    "repo_head_sha": { "type": "string", "pattern": "^[0-9a-f]{7,40}$" },
    "repo_branch": { "type": ["string", "null"] },
    "cwd": { "type": "string", "description": "Absolute path of session cwd" },
    "hooks_fired_count": {
      "type": "object",
      "properties": {
        "session_start": { "type": "integer", "minimum": 0 },
        "user_prompt_submit": { "type": "integer", "minimum": 0 },
        "post_tool_use": { "type": "integer", "minimum": 0 },
        "post_tool_use_failure": { "type": "integer", "minimum": 0 },
        "pre_compact": { "type": "integer", "minimum": 0 },
        "session_end": { "type": "integer", "minimum": 0 }
      },
      "additionalProperties": false
    },
    "reflection": {
      "type": "object",
      "properties": {
        "status": { "enum": ["pending", "in_progress", "complete", "failed"] },
        "completed_at": { "type": ["string", "null"], "format": "date-time" },
        "proposed_entries": { "type": "array", "items": { "type": "string" } }
      }
    }
  },
  "additionalProperties": false
}
```

## JSONL line schemas

Every JSONL file: one JSON object per line, UTF-8, `\n` terminated, no trailing comma. Every line MUST include `ts` (ISO 8601 timestamp) and `turn` (zero-based monotonic per-episode counter, increments on each `UserPromptSubmit`). Lines on disk MUST be redacted before write — see `knowledge-schema.md` validation rules 9 (same regex set).

### `prompts.jsonl`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://apex.dev/schemas/episode-prompt.json",
  "type": "object",
  "required": ["ts", "turn", "prompt", "schema_version"],
  "properties": {
    "schema_version": { "const": 1 },
    "ts": { "type": "string", "format": "date-time" },
    "turn": { "type": "integer", "minimum": 0 },
    "prompt": { "type": "string", "description": "Redacted user prompt text" },
    "prompt_hash": { "type": "string", "pattern": "^[0-9a-f]{64}$", "description": "sha256 of pre-redaction prompt, for replay determinism" },
    "attached_files": { "type": "array", "items": { "type": "string" } },
    "injected_knowledge_ids": { "type": "array", "items": { "type": "string" }, "description": "knowledge entry ids surfaced to Claude this turn" }
  },
  "additionalProperties": false
}
```

### `tools.jsonl`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://apex.dev/schemas/episode-tool.json",
  "type": "object",
  "required": ["ts", "turn", "tool_call_id", "tool_name", "exit_code", "schema_version"],
  "properties": {
    "schema_version": { "const": 1 },
    "ts": { "type": "string", "format": "date-time" },
    "turn": { "type": "integer", "minimum": 0 },
    "tool_call_id": { "type": "string", "description": "Stable id for this invocation" },
    "tool_name": { "type": "string", "description": "e.g. Bash, Read, Edit, mcp__apex__apex_search" },
    "input": { "type": "object", "description": "Redacted tool input" },
    "input_hash": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
    "output_excerpt": { "type": "string", "description": "First 2 KiB of tool output, redacted" },
    "output_size_bytes": { "type": "integer", "minimum": 0 },
    "exit_code": { "type": "integer" },
    "duration_ms": { "type": "integer", "minimum": 0 },
    "error": { "type": ["string", "null"] },
    "files_touched": { "type": "array", "items": { "type": "string" } }
  },
  "additionalProperties": false
}
```

### `failures.jsonl`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://apex.dev/schemas/episode-failure.json",
  "type": "object",
  "required": ["ts", "turn", "tool_call_id", "tool_name", "error", "schema_version"],
  "properties": {
    "schema_version": { "const": 1 },
    "ts": { "type": "string", "format": "date-time" },
    "turn": { "type": "integer", "minimum": 0 },
    "tool_call_id": { "type": "string" },
    "tool_name": { "type": "string" },
    "exit_code": { "type": "integer" },
    "error": { "type": "string", "description": "Redacted error message" },
    "error_signature": { "type": ["string", "null"], "description": "Stable substring used for repeat-failure detection" },
    "stderr_excerpt": { "type": ["string", "null"] }
  },
  "additionalProperties": false
}
```

### `corrections.jsonl`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://apex.dev/schemas/episode-correction.json",
  "type": "object",
  "required": ["ts", "turn", "kind", "evidence_ref", "schema_version"],
  "properties": {
    "schema_version": { "const": 1 },
    "ts": { "type": "string", "format": "date-time" },
    "turn": { "type": "integer", "minimum": 0 },
    "kind": { "enum": ["correction", "confirmation", "thumbs_up", "thumbs_down"] },
    "evidence_ref": { "type": "string", "description": "e.g. prompts.jsonl#L7 or tools.jsonl#L23" },
    "target_entry_id": { "type": ["string", "null"], "description": "knowledge entry id this signal applies to, if known" },
    "user_text": { "type": "string", "description": "The redacted text that triggered the signal" },
    "claude_action_summary": { "type": "string", "description": "What Claude was about to do or had just done" }
  },
  "additionalProperties": false
}
```

### `edits.jsonl`

One line per successful file mutation by `Edit`, `Write`, or `NotebookEdit`. Consumed by the eval harness for edit-churn scoring (`specs/eval-harness.md`) and by metrics (`specs/metrics.md`).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://apex.dev/schemas/episode-edit.json",
  "type": "object",
  "required": ["ts", "turn", "tool", "path", "added", "removed", "schema_version"],
  "properties": {
    "schema_version": { "const": 1 },
    "ts": { "type": "string", "format": "date-time" },
    "turn": { "type": "integer", "minimum": 0 },
    "tool_call_id": { "type": "string", "description": "Joins to tools.jsonl row" },
    "tool": { "enum": ["Edit", "Write", "NotebookEdit"] },
    "path": { "type": "string", "description": "Repo-relative POSIX path" },
    "added": { "type": "integer", "minimum": 0, "description": "Lines inserted" },
    "removed": { "type": "integer", "minimum": 0, "description": "Lines deleted" },
    "is_new_file": { "type": "boolean", "default": false }
  },
  "additionalProperties": false
}
```

### `retrievals.jsonl`

One line per knowledge entry surfaced by the recall path (skill or MCP). The `referenced` field is backfilled by the reflector after SessionEnd: `true` iff a subsequent assistant turn quoted the entry id, file path, or a ≥ 16-char substring of the entry body. Consumed by the knowledge-hit-rate metric (`specs/metrics.md` §3.2).

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://apex.dev/schemas/episode-retrieval.json",
  "type": "object",
  "required": ["ts", "turn", "entry_id", "rank", "score", "surfaced", "schema_version"],
  "properties": {
    "schema_version": { "const": 1 },
    "ts": { "type": "string", "format": "date-time" },
    "turn": { "type": "integer", "minimum": 0, "description": "Turn that triggered the recall" },
    "query": { "type": "string", "description": "Redacted query string passed to the retriever" },
    "entry_id": { "type": "string", "description": "Knowledge entry id (kebab-case slug)" },
    "entry_type": { "enum": ["decision", "pattern", "gotcha", "convention"] },
    "rank": { "type": "integer", "minimum": 1, "description": "Position in the returned ranking, 1-indexed" },
    "score": { "type": "number", "description": "Retriever score for this entry" },
    "tier": { "enum": ["fts", "vector", "hybrid", "graph"], "description": "Retrieval backend that produced the result" },
    "surfaced": { "type": "boolean", "description": "True if the entry was actually shown to the model (top-k cutoff applied)" },
    "referenced": { "type": ["boolean", "null"], "description": "Backfilled by reflector. null until SessionEnd processes it." }
  },
  "additionalProperties": false
}
```

### `snapshots/pre-compact-<n>.json`

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://apex.dev/schemas/episode-snapshot.json",
  "type": "object",
  "required": ["ts", "turn_at_snapshot", "schema_version"],
  "properties": {
    "schema_version": { "const": 1 },
    "ts": { "type": "string", "format": "date-time" },
    "turn_at_snapshot": { "type": "integer", "minimum": 0 },
    "todos": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["content", "status"],
        "properties": {
          "content": { "type": "string" },
          "status": { "enum": ["pending", "in_progress", "completed"] }
        }
      }
    },
    "open_files": { "type": "array", "items": { "type": "string" } },
    "recent_decisions": { "type": "array", "items": { "type": "string" }, "description": "free-form one-liners for the reflector to consider" }
  },
  "additionalProperties": false
}
```

## `summary.md` template

Reflector writes this once at SessionEnd. Eval harness uses it as a quick session-level diff target.

```markdown
---
episode_id: 2026-04-26-1432-9bc4
schema_version: 1
session_duration_minutes: 47
turns: 8
tools_invoked: 23
failures: 2
corrections: 1
proposed_knowledge:
  - decisions/api-pagination-cursor
  - gotchas/zod-default-vs-optional
---

## Goal
<one paragraph: what the user was trying to do, inferred from prompts.jsonl>

## What happened
<chronological narrative, 5–15 bullets, citing turn numbers>

## Failures and resolutions
<bullets keyed to failures.jsonl rows, each one citing the eventual fix or "unresolved">

## Corrections received
<bullets keyed to corrections.jsonl>

## Proposed knowledge
<list of entries the reflector wrote into .apex/proposed/, with one-line justification each>

## Open threads
<anything left unfinished that should bias the next session's SessionStart retrieval>
```

## Worked example — 8-turn session

Episode id: `2026-04-26-1432-9bc4`. Repo: a Next.js + Prisma TypeScript web app. User asks Claude to add a `/api/projects` route with pagination.

### `meta.json` (final state at SessionEnd)

```json
{
  "schema_version": 1,
  "episode_id": "2026-04-26-1432-9bc4",
  "session_id": "ccs_01HVZK9Q4M3X8Y2N7B6T5R3PQA",
  "started_at": "2026-04-26T14:32:11Z",
  "ended_at": "2026-04-26T15:19:42Z",
  "model": "claude-opus-4-7",
  "claude_code_version": "2.4.1",
  "repo_head_sha": "a1b2c3d4e5f6",
  "repo_branch": "feat/projects-api",
  "cwd": "/Users/dev/work/acme-app",
  "hooks_fired_count": {
    "session_start": 1,
    "user_prompt_submit": 8,
    "post_tool_use": 23,
    "post_tool_use_failure": 2,
    "pre_compact": 0,
    "session_end": 1
  },
  "reflection": {
    "status": "complete",
    "completed_at": "2026-04-26T15:21:09Z",
    "proposed_entries": [
      "decisions/api-pagination-cursor",
      "gotchas/zod-default-vs-optional"
    ]
  }
}
```

### `prompts.jsonl` (8 lines, abbreviated)

```jsonl
{"schema_version":1,"ts":"2026-04-26T14:32:14Z","turn":0,"prompt":"Add a paginated /api/projects route returning { items, nextCursor }.","prompt_hash":"3f9c...","attached_files":[],"injected_knowledge_ids":["conventions/gh-pnpm-not-npm","patterns/zod-route-input-validation"]}
{"schema_version":1,"ts":"2026-04-26T14:38:02Z","turn":1,"prompt":"Use cursor-based pagination, not offset.","prompt_hash":"7e22...","injected_knowledge_ids":[]}
{"schema_version":1,"ts":"2026-04-26T14:44:10Z","turn":2,"prompt":"Run the tests.","prompt_hash":"1a8b...","injected_knowledge_ids":[]}
{"schema_version":1,"ts":"2026-04-26T14:48:55Z","turn":3,"prompt":"That zod schema is wrong — use .optional(), not .default(undefined).","prompt_hash":"9d44...","injected_knowledge_ids":[]}
{"schema_version":1,"ts":"2026-04-26T14:55:27Z","turn":4,"prompt":"Re-run the tests.","prompt_hash":"2c11...","injected_knowledge_ids":[]}
{"schema_version":1,"ts":"2026-04-26T15:02:18Z","turn":5,"prompt":"Add a test for the cursor edge case (empty next page).","prompt_hash":"6b77...","injected_knowledge_ids":[]}
{"schema_version":1,"ts":"2026-04-26T15:11:09Z","turn":6,"prompt":"pnpm typecheck.","prompt_hash":"4a05...","injected_knowledge_ids":["conventions/gh-pnpm-not-npm"]}
{"schema_version":1,"ts":"2026-04-26T15:18:33Z","turn":7,"prompt":"Looks good, commit.","prompt_hash":"8f12...","injected_knowledge_ids":[]}
```

### `tools.jsonl` (excerpt — 4 of 23 lines)

```jsonl
{"schema_version":1,"ts":"2026-04-26T14:33:02Z","turn":0,"tool_call_id":"tc_001","tool_name":"Read","input":{"file_path":"/Users/dev/work/acme-app/apps/api/src/routes/users.ts"},"input_hash":"a0b1...","output_size_bytes":4310,"exit_code":0,"duration_ms":12,"error":null,"files_touched":["apps/api/src/routes/users.ts"]}
{"schema_version":1,"ts":"2026-04-26T14:42:18Z","turn":1,"tool_call_id":"tc_007","tool_name":"Edit","input":{"file_path":"/Users/dev/work/acme-app/apps/api/src/routes/projects.ts"},"input_hash":"d4e5...","output_size_bytes":120,"exit_code":0,"duration_ms":8,"error":null,"files_touched":["apps/api/src/routes/projects.ts"]}
{"schema_version":1,"ts":"2026-04-26T14:46:02Z","turn":2,"tool_call_id":"tc_011","tool_name":"Bash","input":{"command":"pnpm test apps/api/src/routes/projects.test.ts"},"input_hash":"f1a2...","output_excerpt":"FAIL  apps/api/src/routes/projects.test.ts\n  ● expected cursor to be undefined when omitted...","output_size_bytes":1820,"exit_code":1,"duration_ms":4210,"error":"1 test failing","files_touched":[]}
{"schema_version":1,"ts":"2026-04-26T15:13:44Z","turn":6,"tool_call_id":"tc_021","tool_name":"Bash","input":{"command":"pnpm typecheck"},"input_hash":"3b9c...","output_excerpt":"Done in 6.4s","output_size_bytes":80,"exit_code":0,"duration_ms":6420,"error":null,"files_touched":[]}
```

### `failures.jsonl` (2 lines)

```jsonl
{"schema_version":1,"ts":"2026-04-26T14:46:02Z","turn":2,"tool_call_id":"tc_011","tool_name":"Bash","exit_code":1,"error":"1 test failing","error_signature":"expected cursor to be undefined when omitted","stderr_excerpt":"  ● expected cursor to be undefined when omitted\n    Received: undefined was wrapped in default(undefined)..."}
{"schema_version":1,"ts":"2026-04-26T14:54:11Z","turn":4,"tool_call_id":"tc_017","tool_name":"Bash","exit_code":1,"error":"typecheck error","error_signature":"Type 'string | undefined' is not assignable to type 'string'","stderr_excerpt":"apps/api/src/routes/projects.ts(34,7): error TS2322..."}
```

### `corrections.jsonl` (1 line)

```jsonl
{"schema_version":1,"ts":"2026-04-26T14:48:55Z","turn":3,"kind":"correction","evidence_ref":"prompts.jsonl#L4","target_entry_id":null,"user_text":"That zod schema is wrong — use .optional(), not .default(undefined).","claude_action_summary":"Defined cursor as z.string().default(undefined) on the query schema in apps/api/src/routes/projects.ts."}
```

### `summary.md` (reflector output)

```markdown
---
episode_id: 2026-04-26-1432-9bc4
schema_version: 1
session_duration_minutes: 47
turns: 8
tools_invoked: 23
failures: 2
corrections: 1
proposed_knowledge:
  - decisions/api-pagination-cursor
  - gotchas/zod-default-vs-optional
---

## Goal
Add a cursor-paginated `/api/projects` route to the Next.js API, including tests.

## What happened
- Turn 0: Claude scaffolded the route mirroring the existing `users` route, applied the `zod-route-input-validation` pattern.
- Turn 1: User specified cursor pagination. Claude defined a Zod query schema with a `cursor` field.
- Turn 2: Tests failed — `cursor` was wrapped in `.default(undefined)`, parsed to `undefined` literal not `optional`.
- Turn 3: User corrected the schema usage.
- Turn 4: Typecheck failed downstream because the handler narrowed wrongly; Claude fixed by switching to `.optional()`.
- Turn 5–6: Added an edge-case test, ran typecheck (passing).
- Turn 7: Session ended on user accept.

## Failures and resolutions
- `tc_011` (turn 2): test fail "expected cursor to be undefined when omitted" — root cause `.default(undefined)`. Resolved at turn 4 by switch to `.optional()`.
- `tc_017` (turn 4): typecheck `Type 'string | undefined' is not assignable to type 'string'` — same root cause, resolved in same edit.

## Corrections received
- Turn 3: User taught the `.optional()` vs `.default(undefined)` distinction. Strong candidate for a gotcha.

## Proposed knowledge
- `decisions/api-pagination-cursor` — explicit team choice for cursor over offset, justified by turns 0–1.
- `gotchas/zod-default-vs-optional` — `.default(undefined)` keeps the field required-typed; use `.optional()` for truly absent fields. Cited turns 2–4.

## Open threads
- The `users` route still uses offset pagination; consider migration in a follow-up.
```

This entire example would parse as valid YAML / JSON / JSONL against the schemas above. The eval harness can deterministically replay this episode by reading `prompts.jsonl` in `turn` order, with `prompt_hash` providing a tamper-check.
