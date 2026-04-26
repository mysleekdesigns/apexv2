---
id: next-add-page
stack: nextjs
kind: synthetic
title: Add an /about page
starting_commit: null
prompts:
  - "Create app/about/page.tsx with a simple About header."
success_predicates:
  - kind: file_exists
    ref: app/about/page.tsx
  - kind: contains_string
    ref: app/about/page.tsx
    value: "export default"
tags: [pages, app-router]
---

Add a new app-router page at `app/about/page.tsx`. It should default-export a
React component rendering an `<h1>About</h1>` block.
