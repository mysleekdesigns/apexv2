---
id: py-fix-pytest
stack: python
kind: synthetic
title: Fix a single failing pytest in test_math.py
starting_commit: null
prompts:
  - "Run pytest; fix the implementation in app/math.py so test_math.py passes (do not modify the test)."
success_predicates:
  - kind: file_exists
    ref: app/math.py
  - kind: regex_match
    ref: app/math.py
    pattern: "def\\s+add\\("
tags: [tests]
---

The `add(a, b)` function in `app/math.py` is buggy. Fix it without modifying
the test in `tests/test_math.py`.
