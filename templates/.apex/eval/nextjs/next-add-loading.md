---
id: next-add-loading
stack: nextjs
kind: synthetic
title: Add a loading.tsx skeleton
starting_commit: null
prompts:
  - "Add app/dashboard/loading.tsx with a skeleton component."
success_predicates:
  - kind: file_exists
    ref: app/dashboard/loading.tsx
tags: [app-router, loading]
---

Add `app/dashboard/loading.tsx` exporting a default skeleton component so the
dashboard route renders a placeholder while loading.
