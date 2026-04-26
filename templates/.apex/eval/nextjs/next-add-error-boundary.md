---
id: next-add-error-boundary
stack: nextjs
kind: synthetic
title: Add an error.tsx boundary
starting_commit: null
prompts:
  - "Create app/dashboard/error.tsx as an error boundary that exports a Client Component."
success_predicates:
  - kind: file_exists
    ref: app/dashboard/error.tsx
  - kind: contains_string
    ref: app/dashboard/error.tsx
    value: "use client"
tags: [error-handling, app-router]
---

Add an `app/dashboard/error.tsx` error boundary. Per Next.js conventions it
must begin with `"use client"` and accept `{ error, reset }` props.
