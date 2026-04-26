---
id: next-add-zod-validator
stack: nextjs
kind: synthetic
title: Validate a request body with Zod
starting_commit: null
prompts:
  - "Add a Zod schema for the /api/posts POST body and parse it inside the route handler."
success_predicates:
  - kind: file_exists
    ref: app/api/posts/route.ts
  - kind: contains_string
    ref: app/api/posts/route.ts
    value: "z.object"
tags: [validation, zod]
---

Inside `app/api/posts/route.ts`, validate the POST body with a `z.object({ ... })`
schema and return `400` if parsing fails.
