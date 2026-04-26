---
id: ts-fix-failing-test
stack: node-typescript
kind: synthetic
title: Fix a failing unit test in src/sum.test.ts
starting_commit: null
prompts:
  - "Run the tests; fix the failing assertion in src/sum.test.ts without changing the test."
success_predicates:
  - kind: file_exists
    ref: src/sum.ts
  - kind: regex_match
    ref: src/sum.ts
    pattern: "return\\s+a\\s*\\+\\s*b"
tags: [tests, debugging]
---

The `sum(a, b)` implementation in `src/sum.ts` returns the wrong value. Fix the
implementation so the existing test passes — do not modify the test.
