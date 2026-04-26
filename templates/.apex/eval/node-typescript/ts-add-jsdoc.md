---
id: ts-add-jsdoc
stack: node-typescript
kind: synthetic
title: Add JSDoc to an exported function
starting_commit: null
prompts:
  - "Add a JSDoc block to the exported computeTax function in src/lib/tax.ts describing parameters and return."
success_predicates:
  - kind: regex_match
    ref: src/lib/tax.ts
    pattern: "/\\*\\*[\\s\\S]*@param[\\s\\S]*@returns"
tags: [docs]
---

Add a JSDoc block above the exported `computeTax` function in `src/lib/tax.ts`
that documents its parameters and return value.
