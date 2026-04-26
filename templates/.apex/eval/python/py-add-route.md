---
id: py-add-route
stack: python
kind: synthetic
title: Add a /health FastAPI route
starting_commit: null
prompts:
  - "Add a GET /health endpoint to app/main.py that returns {\"status\": \"ok\"}."
success_predicates:
  - kind: file_exists
    ref: app/main.py
  - kind: contains_string
    ref: app/main.py
    value: "/health"
tags: [fastapi, routing]
---

Add a `GET /health` endpoint to the existing FastAPI app in `app/main.py`. It
must return `{"status": "ok"}` with HTTP 200.
