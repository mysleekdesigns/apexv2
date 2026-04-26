---
id: next-rename-prop
stack: nextjs
kind: synthetic
title: Rename a Button prop across components
starting_commit: null
prompts:
  - "Rename the userName prop to displayName on components/Button.tsx and update all callers."
success_predicates:
  - kind: file_exists
    ref: components/Button.tsx
  - kind: contains_string
    ref: components/Button.tsx
    value: "displayName"
tags: [refactor, react]
---

Rename the prop `userName` to `displayName` on `components/Button.tsx` and
update each caller across the app router pages.
