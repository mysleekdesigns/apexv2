---
id: feature-flag-gate
type: pattern
title: Gate new features behind a typed feature flag with cleanup ticket
applies_to: all
confidence: high
sources:
  - kind: pr
    ref: pr/701
  - kind: reflection
    ref: episode/2026-04-12-1041-12fa/turn-3
created: 2026-04-12
last_validated: 2026-04-26
tags: [feature-flag, rollout]
intent: Allow staged rollouts and quick rollback without code reverts.
applies_when:
  - Shipping anything user-visible behind staged rollout
  - Migrations that must coexist with the old behavior
example_ref: file/packages/flags/src/index.ts:8
---

Every new flag MUST have a tracking ticket for removal. Stale flags are reaped quarterly.
