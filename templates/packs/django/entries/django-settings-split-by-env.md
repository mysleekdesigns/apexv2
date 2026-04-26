---
id: django-settings-split-by-env
type: decision
title: Split settings into base/dev/prod modules selected by DJANGO_SETTINGS_MODULE
applies_to: team
confidence: medium
sources:
  - kind: manual
    ref: "manual/django-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [django, settings, configuration]
decision: Replace a single `settings.py` with `settings/base.py`, `settings/dev.py`, and `settings/prod.py`. Select the module via the `DJANGO_SETTINGS_MODULE` environment variable.
rationale: A single settings file forces if/else branches on environment values, which is hard to test, easy to break, and a frequent source of "works on my machine" bugs.
outcome: pending
alternatives:
  - "Single `settings.py` with `if DEBUG:` branches — rejected: untestable, leaks dev defaults to prod"
  - "django-environ-only with one settings file — rejected: still mixes prod and dev concerns"
affects:
  - settings/
  - manage.py
  - wsgi.py
  - asgi.py
---

## Context
Defaults that are safe for development (e.g. `DEBUG=True`, console email backend, permissive `ALLOWED_HOSTS`) are dangerous in production. Running both modes from the same file makes a mistaken commit production-affecting.

## Decision
Use a `settings/` package:

```
settings/
  __init__.py
  base.py        # everything safe in any env
  dev.py         # `from .base import *` then dev overrides
  prod.py        # `from .base import *` then prod overrides + assertions
test.py          # optional; minimal SQLite + InMemoryEmailBackend
```

`manage.py`, `wsgi.py`, and `asgi.py` rely on `DJANGO_SETTINGS_MODULE` (e.g. `myproj.settings.prod`); CI sets it explicitly.

## Consequences
- `prod.py` MUST assert presence of `SECRET_KEY`, `DATABASE_URL`, `ALLOWED_HOSTS` — fail fast on misconfiguration.
- All env-specific values stop at the boundary of `prod.py` / `dev.py`; `base.py` never reads `DEBUG`.
- New apps add their `INSTALLED_APPS` entry only to `base.py`.
