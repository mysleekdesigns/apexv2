---
id: py-add-pydantic-model
stack: python
kind: synthetic
title: Add a Pydantic v2 User model
starting_commit: null
prompts:
  - "Add a pydantic v2 User model to app/models.py with name (str) and email (EmailStr)."
success_predicates:
  - kind: file_exists
    ref: app/models.py
  - kind: contains_string
    ref: app/models.py
    value: "class User"
  - kind: contains_string
    ref: app/models.py
    value: "EmailStr"
tags: [pydantic, models]
---

Define a Pydantic v2 `User` model in `app/models.py` with fields `name: str`
and `email: EmailStr`.
