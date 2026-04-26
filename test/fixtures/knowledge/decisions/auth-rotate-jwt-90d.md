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
tags: [auth, security, scheduled-jobs]
decision: Rotate the signing JWT secret every 90 days using the rotate-jwt cron job in apps/api/jobs/.
rationale: 30-day rotation broke long-lived mobile sessions; security review accepted 90 days with refresh-token revocation as compensating control.
outcome: Zero auth incidents in the 30 days since rollout.
alternatives:
  - 30-day rotation (rejected breaks mobile)
  - Manual rotation (rejected not auditable)
affects:
  - apps/api/jobs/rotate-jwt.ts
  - apps/api/src/auth/keys.ts
---

## Context
Mobile clients hold sessions for ~60 days. The previous 30-day rotation forced silent re-auth and caused crashes on iOS < 16.

## Decision
Run apps/api/jobs/rotate-jwt.ts on the first of every quarter; keep the previous key as a verifier for 14 days during overlap.

## Consequences
- Refresh-token revocation is now mandatory on logout.
- Key-rotation runbook lives at docs/runbooks/jwt-rotation.md.
