---
id: api-pagination-cursor
type: decision
title: Use cursor pagination for all list endpoints
applies_to: team
confidence: high
sources:
  - kind: manual
    ref: manual/architecture-team
created: 2026-02-10
last_validated: 2026-04-15
tags: [api, pagination]
decision: All list endpoints return a cursor-paginated response with `nextCursor` and `items` keys.
rationale: Offset pagination breaks under inserts and deletes; cursor pagination is stable and supports infinite scroll on mobile.
outcome: Migrated 14 endpoints; mobile infinite scroll bug rate dropped to zero.
affects:
  - apps/api/src/middleware/pagination.ts
---

## Decision
Cursor pagination is the only supported pagination style. Pass `?cursor=<opaque>` and `?limit=<n<=100>`.
