---
id: next-add-middleware
stack: nextjs
kind: synthetic
title: Add a redirect middleware
starting_commit: null
prompts:
  - "Add middleware.ts at the project root that redirects unauthenticated users away from /dashboard."
success_predicates:
  - kind: file_exists
    ref: middleware.ts
  - kind: contains_string
    ref: middleware.ts
    value: "NextResponse"
tags: [middleware, auth]
---

Add `middleware.ts` at the project root that uses `NextResponse.redirect` to
send unauthenticated requests away from `/dashboard`.
