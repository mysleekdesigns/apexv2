---
id: next-add-metadata
stack: nextjs
kind: synthetic
title: Add static metadata to a route
starting_commit: null
prompts:
  - "Export a metadata object on app/blog/page.tsx with a title and description."
success_predicates:
  - kind: contains_string
    ref: app/blog/page.tsx
    value: "metadata"
tags: [metadata, seo]
---

Export a static `metadata` object from `app/blog/page.tsx` containing a
`title` and `description`.
