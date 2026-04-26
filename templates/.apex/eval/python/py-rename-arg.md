---
id: py-rename-arg
stack: python
kind: synthetic
title: Rename `user_name` to `display_name`
starting_commit: null
prompts:
  - "Rename the user_name argument to display_name across app/users.py and update callers."
success_predicates:
  - kind: contains_string
    ref: app/users.py
    value: "display_name"
tags: [refactor]
---

Rename the keyword argument `user_name` to `display_name` in
`app/users.py:format_user`, and update every caller.
