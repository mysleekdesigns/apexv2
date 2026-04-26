---
id: ts-add-config-flag
stack: node-typescript
kind: synthetic
title: Add a feature flag `enableBetaSearch` to the config schema
starting_commit: null
prompts:
  - "Add an enableBetaSearch boolean (default false) to src/config.ts and surface it through getConfig()."
success_predicates:
  - kind: contains_string
    ref: src/config.ts
    value: "enableBetaSearch"
  - kind: regex_match
    ref: src/config.ts
    pattern: "default(\\s|:)*false"
tags: [config]
---

Add a boolean config flag `enableBetaSearch` (defaulting to `false`) to
`src/config.ts`. Update the exported `Config` type and the `getConfig()`
function to expose it. No tests required.
