---
id: ts-fix-typecheck
stack: node-typescript
kind: synthetic
title: Resolve a `string | undefined` typecheck error
starting_commit: null
prompts:
  - "Tighten src/api/user.ts so getUser(id: string) compiles under strict noUncheckedIndexedAccess."
success_predicates:
  - kind: contains_string
    ref: src/api/user.ts
    value: "throw new Error"
tags: [typescript, types]
---

`src/api/user.ts` fails typecheck because `users[id]` may be `undefined`. Add a
guard that throws on missing user so the function's return type stays `User`,
not `User | undefined`.
