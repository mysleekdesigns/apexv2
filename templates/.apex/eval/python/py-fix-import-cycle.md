---
id: py-fix-import-cycle
stack: python
kind: synthetic
title: Break a circular import
starting_commit: null
prompts:
  - "Resolve the circular import between app/services/auth.py and app/services/users.py by moving the shared type to app/types.py."
success_predicates:
  - kind: file_exists
    ref: app/types.py
tags: [refactor]
---

Break the circular import between `app/services/auth.py` and
`app/services/users.py` by extracting the shared `User` dataclass into
`app/types.py`.
