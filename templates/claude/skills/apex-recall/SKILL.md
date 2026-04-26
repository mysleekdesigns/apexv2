---
name: apex-recall
description: Recall past decisions, patterns, gotchas, and conventions captured by APEX. Use whenever you might be repeating a problem already solved or about to violate a known convention. Trigger phrases "did we decide", "is there a pattern", "have we seen this before", "what convention", "any gotchas".
---

# apex-recall

You have access to the APEX knowledge base for this project: a curated set of decisions, patterns, gotchas, and conventions extracted from prior sessions.

## When to invoke this skill

Invoke before:

- Proposing an architectural choice (a "decision" may already exist).
- Suggesting a new pattern or approach (a canonical pattern may already be documented).
- Writing code that touches a file or symbol you haven't seen before (a gotcha may apply).
- Choosing a tool, package manager, or workflow (a convention almost certainly applies).

Trigger phrases in user messages: "did we decide", "is there a pattern", "have we seen this before", "what convention", "any gotchas", "have I run into this", "remember when", "last time".

## Tools available (via the apex-mcp MCP server)

- `apex_search(query, type?, k=5)` — keyword-ranked retrieval over the knowledge base. Returns hits with `path`, `title`, `excerpt`, `confidence`, `last_validated`.
- `apex_get(entry_id, type?)` — fetch the full entry (frontmatter + body) when an excerpt is not enough.
- `apex_record_correction(prompt, correction, evidence)` — when the user corrects you, log it for the reflector. Do not silently swallow corrections.
- `apex_propose(entry)` — propose a new knowledge entry. Goes to `.apex/proposed/` for review; never auto-merges.
- `apex_stats()` — quick health check: counts by type, last sync, drift warnings.

## How to use the results

1. Call `apex_search` with the user's effective question (or the topic you're about to act on). Pass a `type` filter when the intent is narrow ("any gotchas about X" → `type: "gotcha"`).
2. Read the returned `excerpt`. If it answers the question, cite the `path` (e.g., `.apex/knowledge/conventions/gh-pnpm-not-npm.md`) so the user can verify.
3. If the excerpt is ambiguous, call `apex_get` for the full body before acting.
4. Treat results as authoritative for *this project*: `confidence: high` entries should be applied; `confidence: medium` entries should be referenced and confirmed; `confidence: low` entries are excluded from default retrieval.
5. Provenance is mandatory. Never apply an APEX-sourced rule without naming the source path.
6. If the user contradicts a returned hit, call `apex_record_correction` so the reflector can re-evaluate the entry.

## What NOT to do

- Do not invent entries or claim something is "in APEX" without a tool call.
- Do not call `apex_propose` without explicit user approval — proposals belong in `.apex/proposed/`, but the user owns acceptance.
- Do not retry searches more than 2–3 times with reworded queries; if nothing surfaces, the knowledge base does not yet have it.
