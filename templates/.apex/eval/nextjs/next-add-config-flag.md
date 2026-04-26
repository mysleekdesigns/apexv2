---
id: next-add-config-flag
stack: nextjs
kind: synthetic
title: Add an experimental config flag
starting_commit: null
prompts:
  - "Add experimental.serverActions.bodySizeLimit = '2mb' to next.config.mjs."
success_predicates:
  - kind: file_exists
    ref: next.config.mjs
  - kind: contains_string
    ref: next.config.mjs
    value: "bodySizeLimit"
tags: [config]
---

Update `next.config.mjs` to set
`experimental.serverActions.bodySizeLimit = "2mb"`.
