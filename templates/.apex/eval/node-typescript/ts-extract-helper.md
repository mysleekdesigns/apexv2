---
id: ts-extract-helper
stack: node-typescript
kind: synthetic
title: Extract a date-formatting helper into src/lib/format.ts
starting_commit: null
prompts:
  - "Pull the inline date-formatting code in src/handlers/orders.ts into src/lib/format.ts and import it."
success_predicates:
  - kind: file_exists
    ref: src/lib/format.ts
  - kind: contains_string
    ref: src/lib/format.ts
    value: "export function"
tags: [refactor]
---

Extract the inline date-formatting block from `src/handlers/orders.ts` into a
new helper `formatOrderDate(date)` exported from `src/lib/format.ts`. Replace
the inline call with an import.
