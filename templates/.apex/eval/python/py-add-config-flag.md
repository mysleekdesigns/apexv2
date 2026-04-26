---
id: py-add-config-flag
stack: python
kind: synthetic
title: Add an `enable_beta_search` flag to settings
starting_commit: null
prompts:
  - "Add an enable_beta_search bool (default False) to app/settings.py and expose it via get_settings()."
success_predicates:
  - kind: contains_string
    ref: app/settings.py
    value: "enable_beta_search"
  - kind: regex_match
    ref: app/settings.py
    pattern: "enable_beta_search\\s*[:=]\\s*(bool\\s*=\\s*)?False"
tags: [config]
---

Add an `enable_beta_search: bool = False` field to the settings dataclass /
Pydantic Settings in `app/settings.py`. Surface via the existing
`get_settings()` accessor.
