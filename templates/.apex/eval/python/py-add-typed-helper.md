---
id: py-add-typed-helper
stack: python
kind: synthetic
title: Add a typed helper with explicit annotations
starting_commit: null
prompts:
  - "Add a typed helper to_iso(d: date) -> str in app/utils/dates.py."
success_predicates:
  - kind: file_exists
    ref: app/utils/dates.py
  - kind: regex_match
    ref: app/utils/dates.py
    pattern: "def\\s+to_iso\\(.*\\)\\s*->\\s*str"
tags: [typing]
---

Add a fully type-annotated helper `to_iso(d: date) -> str` to
`app/utils/dates.py` that returns the ISO-8601 representation.
