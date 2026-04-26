---
id: py-add-docstring
stack: python
kind: synthetic
title: Add a Google-style docstring
starting_commit: null
prompts:
  - "Add a Google-style docstring to compute_tax in app/lib/tax.py."
success_predicates:
  - kind: regex_match
    ref: app/lib/tax.py
    pattern: "\"\"\"[\\s\\S]*Args:[\\s\\S]*Returns:"
tags: [docs]
---

Add a Google-style docstring to `compute_tax` in `app/lib/tax.py` describing
its `Args` and `Returns`.
