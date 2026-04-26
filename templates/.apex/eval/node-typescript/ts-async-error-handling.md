---
id: ts-async-error-handling
stack: node-typescript
kind: synthetic
title: Wrap an async fetch in try/catch and surface a typed error
starting_commit: null
prompts:
  - "In src/services/billing.ts, wrap the fetch call in try/catch and re-throw a BillingError with the cause."
success_predicates:
  - kind: contains_string
    ref: src/services/billing.ts
    value: "BillingError"
  - kind: regex_match
    ref: src/services/billing.ts
    pattern: "try\\s*\\{[\\s\\S]*catch"
tags: [error-handling]
---

Wrap the `fetch()` call in `src/services/billing.ts` with a try/catch and
rethrow as a custom `BillingError` that preserves the underlying cause.
