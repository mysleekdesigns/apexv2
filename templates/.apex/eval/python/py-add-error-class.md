---
id: py-add-error-class
stack: python
kind: synthetic
title: Define a domain-specific exception
starting_commit: null
prompts:
  - "Add a BillingError(Exception) class to app/errors.py and raise it from app/services/billing.py on failure."
success_predicates:
  - kind: file_exists
    ref: app/errors.py
  - kind: contains_string
    ref: app/errors.py
    value: "class BillingError"
  - kind: contains_string
    ref: app/services/billing.py
    value: "BillingError"
tags: [errors]
---

Introduce a `BillingError(Exception)` class in `app/errors.py` and raise it
from `charge()` in `app/services/billing.py` when the upstream call fails.
