---
id: result-type-error-handling
type: pattern
title: Return Result<T,E> rather than throwing in service layer
applies_to: team
confidence: medium
sources:
  - kind: manual
    ref: manual/staff-eng
created: 2026-03-01
last_validated: 2026-04-10
tags: [error-handling, typescript]
intent: Make failure modes explicit at the type level for service-layer functions.
applies_when:
  - Writing a new service-layer function with a known failure taxonomy
  - Refactoring a try/catch ladder that swallows errors
---

Service-layer functions return `Result<T, E>` (e.g., `neverthrow`'s `Result`) instead of throwing. Throwing is reserved for truly unrecoverable errors (programmer errors, OOM).
