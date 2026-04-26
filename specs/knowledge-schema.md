# Knowledge Schema

Authoritative spec for entries under `.apex/knowledge/`. Every entry is a Markdown file with YAML frontmatter followed by free-form Markdown body. The frontmatter is machine-validated; the body is human-readable guidance.

## File path convention

```
.apex/knowledge/{decisions,patterns,gotchas,conventions}/<id>.md
```

- The directory matches the entry `type`.
- The filename (minus `.md`) MUST equal the frontmatter `id`.
- IDs MUST be unique within a `type`. The same `id` MAY exist across types (rare; avoid).

## ID format

- Kebab-case slug: `[a-z0-9]+(-[a-z0-9]+)*`
- Length: 1–64 characters.
- SHOULD be human-readable and stable. Examples: `gh-pnpm-not-npm`, `auth-rotation-2026q2`, `nextjs-app-router-default`.
- MUST NOT contain dates that aren't semantically part of the lesson. Use the `created` field for chronology.

## Common frontmatter — every entry type

| Field | Type | Req | Description | Allowed values | Example |
|---|---|---|---|---|---|
| `id` | string | yes | Kebab-case slug, ≤ 64 chars, unique within type | `^[a-z0-9]+(-[a-z0-9]+)*$` | `gh-pnpm-not-npm` |
| `type` | enum | yes | Entry type | `decision \| pattern \| gotcha \| convention` | `convention` |
| `title` | string | yes | Single-sentence summary, ≤ 120 chars | — | `This project uses pnpm, not npm` |
| `applies_to` | enum | yes | Audience scope | `user \| team \| all` | `all` |
| `confidence` | enum | yes | Trust level (see ladder below) | `low \| medium \| high` | `high` |
| `sources` | array | yes | At least 1 entry citing provenance | see schema | see below |
| `created` | date | yes | First-created date, ISO 8601 (`YYYY-MM-DD`) | — | `2026-04-22` |
| `last_validated` | date | yes | Last date evidence reconfirmed entry, ISO 8601 | — | `2026-04-26` |
| `supersedes` | array<string> | no | List of `id`s this entry replaces (within same type) | — | `[old-pkg-rule]` |
| `archived` | boolean | no | `true` if superseded; default `false` | — | `false` |
| `tags` | array<string> | no | Free-form tags (kebab-case recommended) | — | `[tooling, package-manager]` |
| `verified` | boolean | no | `false` when drift detector finds a referenced file/symbol missing | — | `true` |

### `sources[]` schema

Every `sources` entry is an object:

| Field | Type | Req | Description |
|---|---|---|---|
| `kind` | enum | yes | `bootstrap \| correction \| reflection \| manual \| pr` |
| `ref` | string | yes | Stable reference. Free-form but conventional forms: `episode/<episode-id>/turn-<n>`, `git/<sha>`, `pr/<number>`, `file/<path>:<line>`, `manual/<author>` |
| `note` | string | no | One-line clarifier |

Every entry MUST have at least one source. An entry with `sources: []` is invalid.

## Per-type sub-schema

### `decision` (one-time architectural or process choice)

Required additions:

| Field | Type | Req | Description |
|---|---|---|---|
| `decision` | string | yes | The choice made, imperative voice |
| `rationale` | string | yes | Why this over alternatives |
| `outcome` | string | yes | Observed result so far (or `pending` if too new) |
| `alternatives` | array<string> | no | What was rejected, one phrase each |
| `affects` | array<string> | no | Files/dirs/symbols this decision binds |

Body convention: a `## Context`, `## Decision`, `## Consequences` section is recommended (ADR-style) but not enforced.

### `pattern` (repeatable approach worth re-using)

Required additions:

| Field | Type | Req | Description |
|---|---|---|---|
| `intent` | string | yes | When to reach for this pattern (one sentence) |
| `applies_when` | array<string> | yes | Trigger phrases or conditions, ≥ 1 |
| `example_ref` | string | no | `file/<path>:<line>` to a canonical instance in the repo |

Body convention: include a minimal code snippet illustrating the pattern.

### `gotcha` (a trap with a known fix)

Required additions:

| Field | Type | Req | Description |
|---|---|---|---|
| `symptom` | string | yes | What the developer/Claude observes (error string, behaviour) |
| `resolution` | string | yes | The known-good fix, imperative voice |
| `error_signature` | string | no | Stable substring of error/log used to auto-match repeat occurrences |
| `affects` | array<string> | no | Files/symbols where this trap appears |
| `resolved_at` | string | no | Commit SHA where the underlying issue was actually fixed; when set, retrieval de-prioritises |

### `convention` (project rule of the road)

Required additions:

| Field | Type | Req | Description |
|---|---|---|---|
| `rule` | string | yes | Imperative one-liner Claude should follow |
| `enforcement` | enum | yes | `manual \| lint \| ci \| hook` — how the rule is checked in practice |
| `scope` | array<string> | no | Glob(s) the rule applies to; default = repo-wide |

## Confidence ladder (binds Phase 4.2)

States: `low → medium → high`. Promotion and demotion are deterministic; only the rules below mutate `confidence`.

**Promote `low → medium`:**
- 1 successful tool-grounded confirmation (test pass, lint clean, type-check clean) referencing the entry, OR
- 1 explicit user `/apex-thumbs-up`.

**Promote `medium → high`:**
- 2 independent tool-grounded confirmations across different sessions, OR
- The same correction observed ≥ 2 times AND no conflicting entry exists (auto-merge condition from Phase 2.2).

**Demote one step (`high → medium → low`):**
- 1 contradicting tool signal (test pass for the opposite behaviour, lint reversed), OR
- User explicit `/apex-thumbs-down` or "ignore that", OR
- Entry not retrieved across N=20 sessions (staleness; curator's job).

**Archive (do not delete):**
- Demoted from `low` → set `archived: true`. Files remain on disk for audit.
- Superseded entries automatically get `archived: true` set on the *older* entry by curator.

Retrieval rules: `low` entries are excluded from default retrieval; `archived: true` entries are never retrieved, only surfaced via `apex search --include-archived`.

## Supersession chain

- New entry asserts `supersedes: [<old-id>]`.
- Curator atomically: sets `archived: true` on the old entry, leaves it on disk, ensures the new entry is unarchived.
- Chains may be > 1 deep (`c → b → a`). Latest unarchived entry wins.
- A cycle (A supersedes B, B supersedes A) is invalid; linter MUST reject.
- Cross-type supersession is forbidden (a `gotcha` cannot supersede a `decision`).

## Validation rules (linter / redactor MUST enforce)

1. Frontmatter parses as YAML 1.2.
2. All required fields per type are present and non-empty.
3. `id` matches `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64 chars, equals filename stem.
4. `type` matches enclosing directory (`decisions/` ↔ `decision`, etc.).
5. `created`, `last_validated` parse as ISO 8601 date (`YYYY-MM-DD`). `last_validated >= created`.
6. `sources` length ≥ 1; each entry has valid `kind` and non-empty `ref`.
7. `supersedes` IDs all exist on disk within the same type; no self-reference; no cycle.
8. `confidence` is one of `low | medium | high`.
9. Body and frontmatter pass redactor: no AWS access keys (`AKIA[0-9A-Z]{16}`), no GitHub tokens (`gh[pousr]_[A-Za-z0-9]{36,}`), no JWTs (`eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`), no PEM blocks, no `.env`-style assignments containing values longer than 8 chars (`(?i)(secret|token|key|password)\s*=\s*\S{8,}`).
10. No timestamps within frontmatter beyond `YYYY-MM-DD` (use ISO timestamp form `YYYY-MM-DDTHH:MM:SSZ` only inside `sources[].ref` if needed).
11. Total file size ≤ 16 KiB (keeps retrieval cheap; if larger, split into multiple entries).

## Worked examples

### Decision

```markdown
---
id: auth-rotate-jwt-90d
type: decision
title: Rotate signing JWT every 90 days via scheduled job
applies_to: team
confidence: high
sources:
  - kind: pr
    ref: pr/482
    note: Original RFC discussion
  - kind: reflection
    ref: episode/2026-03-14-0915-a3f1/turn-22
created: 2026-03-15
last_validated: 2026-04-20
supersedes: [auth-rotate-jwt-30d]
tags: [auth, security, scheduled-jobs]
decision: Rotate the signing JWT secret every 90 days using the `rotate-jwt` cron job in `apps/api/jobs/`.
rationale: 30-day rotation broke long-lived mobile sessions; security review accepted 90 days with refresh-token revocation as compensating control.
outcome: Zero auth incidents in the 30 days since rollout; mobile session-length complaints resolved.
alternatives:
  - 30-day rotation (rejected: breaks mobile)
  - Manual rotation (rejected: not auditable)
affects:
  - apps/api/jobs/rotate-jwt.ts
  - apps/api/src/auth/keys.ts
---

## Context
Mobile clients hold sessions for ~60 days. The previous 30-day rotation forced silent re-auth and caused crashes on iOS < 16.

## Decision
Run `apps/api/jobs/rotate-jwt.ts` on the first of every quarter; keep the previous key as a verifier for 14 days during overlap.

## Consequences
- Refresh-token revocation is now mandatory on logout.
- Key-rotation runbook lives at `docs/runbooks/jwt-rotation.md`.
```

### Pattern

```markdown
---
id: zod-route-input-validation
type: pattern
title: Validate route inputs with a co-located Zod schema
applies_to: team
confidence: high
sources:
  - kind: bootstrap
    ref: file/apps/api/src/routes/users.ts:14
  - kind: reflection
    ref: episode/2026-04-02-1102-9bc4/turn-7
created: 2026-04-02
last_validated: 2026-04-25
tags: [validation, zod, api]
intent: Reject malformed request bodies before they reach the handler, with a single source of truth for the type.
applies_when:
  - Adding a new POST/PUT/PATCH route
  - Refactoring a route that currently casts `req.body as any`
example_ref: file/apps/api/src/routes/users.ts:14
---

## Pattern
Define a Zod schema next to the route, infer the TS type from it, parse on entry.

```ts
const CreateUserBody = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(80),
});
type CreateUserBody = z.infer<typeof CreateUserBody>;

router.post('/users', (req, res) => {
  const body = CreateUserBody.parse(req.body); // throws -> 400 via error middleware
  // ...
});
```

The error middleware in `apps/api/src/middleware/errors.ts` converts `ZodError` to a 400 with field-level messages.
```

### Gotcha

```markdown
---
id: prisma-soft-delete-users
type: gotcha
title: Querying users without filtering deleted_at returns soft-deleted rows
applies_to: all
confidence: high
sources:
  - kind: correction
    ref: episode/2026-04-18-1430-7cd2/turn-9
  - kind: pr
    ref: pr/501
created: 2026-04-18
last_validated: 2026-04-26
tags: [database, prisma, soft-delete]
symptom: Endpoint returns users that should be hidden; tests assert `deleted_at IS NULL` and fail intermittently.
resolution: Always include `where: { deleted_at: null }` in `prisma.user.findMany`/`findFirst` unless you explicitly need tombstones. Or use the `prisma.activeUser` extension defined in `apps/api/src/db/extensions.ts`.
error_signature: expected user count
affects:
  - apps/api/src/routes/users.ts
  - apps/api/src/services/userService.ts
---

## Why this happens
The `users` table has a `deleted_at` column added in migration `20260111-add-soft-delete`. Prisma does not auto-filter; the `activeUser` extension was added afterward and is the preferred path.

## Fix
Prefer `prisma.activeUser.findMany(...)`. If you must use `prisma.user`, add the `where: { deleted_at: null }` clause.
```

### Convention

```markdown
---
id: gh-pnpm-not-npm
type: convention
title: This project uses pnpm, not npm
applies_to: all
confidence: high
sources:
  - kind: correction
    ref: episode/2026-04-22-1f3e-b801/turn-12
  - kind: bootstrap
    ref: file/.github/workflows/ci.yml:18
created: 2026-04-22
last_validated: 2026-04-26
tags: [tooling, package-manager]
rule: Always use `pnpm install`, `pnpm add`, `pnpm run`. Lockfile is `pnpm-lock.yaml`.
enforcement: ci
scope: ['**/*']
---

**Why:** pnpm is enforced by CI (`.github/workflows/ci.yml` step `verify-lockfile`). Suggesting `npm` or `yarn` will fail the workflow.

**How to apply:** Replace any suggested `npm` or `yarn` command with the pnpm equivalent. Use `pnpm dlx` instead of `npx` for one-off binaries.
```

## JSON Schema (draft 2020-12)

A discriminated-union schema for any frontmatter object. Tools should YAML-parse the frontmatter, then validate against this schema.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://apex.dev/schemas/knowledge-frontmatter.json",
  "title": "APEX Knowledge Entry Frontmatter",
  "type": "object",
  "required": ["id", "type", "title", "applies_to", "confidence", "sources", "created", "last_validated"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
      "minLength": 1,
      "maxLength": 64
    },
    "type": { "enum": ["decision", "pattern", "gotcha", "convention"] },
    "title": { "type": "string", "minLength": 1, "maxLength": 120 },
    "applies_to": { "enum": ["user", "team", "all"] },
    "confidence": { "enum": ["low", "medium", "high"] },
    "sources": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["kind", "ref"],
        "properties": {
          "kind": { "enum": ["bootstrap", "correction", "reflection", "manual", "pr"] },
          "ref": { "type": "string", "minLength": 1 },
          "note": { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "created": { "type": "string", "format": "date", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "last_validated": { "type": "string", "format": "date", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "supersedes": {
      "type": "array",
      "items": { "type": "string", "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$" },
      "uniqueItems": true,
      "default": []
    },
    "archived": { "type": "boolean", "default": false },
    "verified": { "type": "boolean", "default": true },
    "tags": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 },
      "uniqueItems": true
    }
  },
  "allOf": [
    {
      "if": { "properties": { "type": { "const": "decision" } } },
      "then": {
        "required": ["decision", "rationale", "outcome"],
        "properties": {
          "decision": { "type": "string", "minLength": 1 },
          "rationale": { "type": "string", "minLength": 1 },
          "outcome": { "type": "string", "minLength": 1 },
          "alternatives": { "type": "array", "items": { "type": "string" } },
          "affects": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "pattern" } } },
      "then": {
        "required": ["intent", "applies_when"],
        "properties": {
          "intent": { "type": "string", "minLength": 1 },
          "applies_when": { "type": "array", "minItems": 1, "items": { "type": "string" } },
          "example_ref": { "type": "string" }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "gotcha" } } },
      "then": {
        "required": ["symptom", "resolution"],
        "properties": {
          "symptom": { "type": "string", "minLength": 1 },
          "resolution": { "type": "string", "minLength": 1 },
          "error_signature": { "type": "string" },
          "affects": { "type": "array", "items": { "type": "string" } },
          "resolved_at": { "type": "string" }
        }
      }
    },
    {
      "if": { "properties": { "type": { "const": "convention" } } },
      "then": {
        "required": ["rule", "enforcement"],
        "properties": {
          "rule": { "type": "string", "minLength": 1 },
          "enforcement": { "enum": ["manual", "lint", "ci", "hook"] },
          "scope": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  ],
  "additionalProperties": true
}
```
