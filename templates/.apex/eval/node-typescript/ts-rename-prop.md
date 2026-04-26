---
id: ts-rename-prop
stack: node-typescript
kind: synthetic
title: Rename `userName` to `displayName` across a Button component
starting_commit: null
prompts:
  - "Rename the userName prop to displayName in src/components/Button.tsx and all callers."
success_predicates:
  - kind: file_exists
    ref: src/components/Button.tsx
  - kind: contains_string
    ref: src/components/Button.tsx
    value: "displayName"
tags: [refactor, react]
---

Rename the `userName` prop to `displayName` across `Button.tsx` and all callers
in the components tree. Tests must still pass.
