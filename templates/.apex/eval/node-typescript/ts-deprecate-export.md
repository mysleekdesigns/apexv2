---
id: ts-deprecate-export
stack: node-typescript
kind: synthetic
title: Mark a public export as deprecated
starting_commit: null
prompts:
  - "Mark the legacyParse function in src/parsers/index.ts as @deprecated and forward to parse()."
success_predicates:
  - kind: contains_string
    ref: src/parsers/index.ts
    value: "@deprecated"
tags: [refactor, deprecation]
---

The `legacyParse` function in `src/parsers/index.ts` has been replaced by
`parse`. Add a `@deprecated` JSDoc tag and have it call through to `parse`.
