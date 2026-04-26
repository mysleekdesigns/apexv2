---
id: next-add-not-found
stack: nextjs
kind: synthetic
title: Add a not-found.tsx page
starting_commit: null
prompts:
  - "Add app/not-found.tsx with a friendly message and a link back home."
success_predicates:
  - kind: file_exists
    ref: app/not-found.tsx
tags: [app-router, errors]
---

Add `app/not-found.tsx` exporting a default React component that renders a
friendly 404 message and a `<Link href="/">` back to home.
