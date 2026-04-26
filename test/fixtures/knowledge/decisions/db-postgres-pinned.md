---
id: db-postgres-pinned
type: decision
title: Pin Postgres to 16.x and use Prisma migrations
applies_to: all
confidence: medium
sources:
  - kind: pr
    ref: pr/612
created: 2026-03-22
last_validated: 2026-04-22
tags: [database, postgres, prisma]
decision: Production runs Postgres 16.x; schema changes flow exclusively through Prisma migrate.
rationale: Avoid drift between hand-written SQL migrations and Prisma's expectations.
outcome: pending
---

Use `pnpm prisma migrate dev` for local schema changes.
