---
id: ts-add-cli-subcommand
stack: node-typescript
kind: synthetic
title: Add a `version` subcommand to the commander CLI
starting_commit: null
prompts:
  - "Add a version subcommand to src/cli/index.ts that prints the package.json version."
success_predicates:
  - kind: contains_string
    ref: src/cli/index.ts
    value: "version"
tags: [cli, commander]
---

Wire a new `version` subcommand into the existing commander CLI in
`src/cli/index.ts`. It should print the package.json version string.
