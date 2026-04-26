---
id: ts-add-env-var
stack: node-typescript
kind: synthetic
title: Read a new environment variable
starting_commit: null
prompts:
  - "Add a CACHE_TTL_SECONDS env var (default 60) to src/config.ts and use it in src/cache.ts."
success_predicates:
  - kind: contains_string
    ref: src/config.ts
    value: "CACHE_TTL_SECONDS"
  - kind: contains_string
    ref: src/cache.ts
    value: "CACHE_TTL_SECONDS"
tags: [config, env]
---

Introduce a `CACHE_TTL_SECONDS` environment variable (defaulting to `60`) that
the cache layer reads at startup.
