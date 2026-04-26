---
id: next-add-route
stack: nextjs
kind: synthetic
title: Add an /api/health route handler
starting_commit: null
prompts:
  - "Add a GET handler at app/api/health/route.ts returning JSON { ok: true }."
success_predicates:
  - kind: file_exists
    ref: app/api/health/route.ts
  - kind: contains_string
    ref: app/api/health/route.ts
    value: "ok: true"
tags: [routing, app-router]
---

Add a `GET` handler at `app/api/health/route.ts` returning a JSON body
`{ ok: true }`.
