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
intent: Reject malformed request bodies before they reach the handler with a single source of truth for the type.
applies_when:
  - Adding a new POST/PUT/PATCH route
  - Refactoring a route that currently casts req.body as any
example_ref: file/apps/api/src/routes/users.ts:14
---

## Pattern
Define a Zod schema next to the route, infer the TS type from it, parse on entry.

The error middleware in apps/api/src/middleware/errors.ts converts ZodError to a 400 with field-level messages.
