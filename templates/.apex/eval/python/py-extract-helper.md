---
id: py-extract-helper
stack: python
kind: synthetic
title: Extract a slugify helper into app/utils/text.py
starting_commit: null
prompts:
  - "Move the inline slugify code in app/views/posts.py into app/utils/text.py and import from there."
success_predicates:
  - kind: file_exists
    ref: app/utils/text.py
  - kind: contains_string
    ref: app/utils/text.py
    value: "def slugify"
tags: [refactor]
---

Extract the inline slug-generation logic from `app/views/posts.py` into a
top-level `slugify(value: str) -> str` helper in `app/utils/text.py`.
