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
symptom: Endpoint returns users that should be hidden; tests assert deleted_at IS NULL and fail intermittently.
resolution: Always include where deleted_at null in prisma.user.findMany/findFirst unless you explicitly need tombstones. Or use the prisma.activeUser extension defined in apps/api/src/db/extensions.ts.
error_signature: expected user count
affects:
  - apps/api/src/routes/users.ts
  - apps/api/src/services/userService.ts
---

## Why this happens
The users table has a deleted_at column added in migration 20260111-add-soft-delete. Prisma does not auto-filter; the activeUser extension was added afterward and is the preferred path.

## Fix
Prefer prisma.activeUser.findMany. If you must use prisma.user, add the where deleted_at null clause.
