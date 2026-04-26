---
id: py-add-cli-flag
stack: python
kind: synthetic
title: Add a `--verbose` flag to the click CLI
starting_commit: null
prompts:
  - "Add a --verbose flag to the click CLI in app/cli.py that enables DEBUG logging."
success_predicates:
  - kind: contains_string
    ref: app/cli.py
    value: "--verbose"
tags: [cli, click]
---

Add a boolean `--verbose` flag to the existing `click`-based CLI in
`app/cli.py`. When set, configure logging at `DEBUG`.
