---
id: no-default-exports
type: convention
title: No default exports in TypeScript modules
applies_to: team
confidence: medium
sources:
  - kind: manual
    ref: manual/staff-eng
created: 2026-02-20
last_validated: 2026-04-12
tags: [typescript, style]
rule: Prefer named exports. Default exports break refactors and grep-ability.
enforcement: lint
scope: ['src/**/*.ts', 'src/**/*.tsx']
---

ESLint rule `import/no-default-export` is on for src/.
