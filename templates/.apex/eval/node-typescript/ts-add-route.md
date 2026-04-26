---
id: ts-add-route
stack: node-typescript
kind: synthetic
title: Add a new GET /health route
starting_commit: null
prompts:
  - "Add a /health endpoint that returns { ok: true }"
success_predicates:
  - kind: file_exists
    ref: src/routes/health.ts
  - kind: contains_string
    ref: src/routes/health.ts
    value: "ok: true"
tags: [routing, http]
---

A new `GET /health` route should be added to the existing Express app. The
handler must respond with `{ ok: true }`.
