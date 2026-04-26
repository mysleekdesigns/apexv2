---
id: ts-add-zod-validator
stack: node-typescript
kind: synthetic
title: Add a Zod schema for the user payload
starting_commit: null
prompts:
  - "Add a Zod schema in src/validators/user.ts that validates { id: string, email: string }."
success_predicates:
  - kind: file_exists
    ref: src/validators/user.ts
  - kind: contains_string
    ref: src/validators/user.ts
    value: "z.object"
tags: [validation, zod]
---

Add a Zod schema `userSchema` to `src/validators/user.ts` that validates an
object `{ id: string, email: string }` (email must be a valid email). Export it.
