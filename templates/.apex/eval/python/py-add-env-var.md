---
id: py-add-env-var
stack: python
kind: synthetic
title: Read a `CACHE_TTL_SECONDS` env var
starting_commit: null
prompts:
  - "Add a CACHE_TTL_SECONDS env var (default 60) to app/settings.py and use it in app/cache.py."
success_predicates:
  - kind: contains_string
    ref: app/settings.py
    value: "CACHE_TTL_SECONDS"
  - kind: contains_string
    ref: app/cache.py
    value: "CACHE_TTL_SECONDS"
tags: [config, env]
---

Add a `CACHE_TTL_SECONDS` env var (default `60`) read in `app/settings.py` and
applied by the cache layer.
