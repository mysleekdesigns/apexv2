---
id: conventional-commits
type: convention
title: Use Conventional Commits for all commit messages
applies_to: team
confidence: high
sources:
  - kind: bootstrap
    ref: file/.commitlintrc.json:1
created: 2026-01-15
last_validated: 2026-04-22
tags: [git, commits]
rule: Commit messages follow Conventional Commits (feat fix chore docs refactor test). Lowercase type, no trailing period in subject.
enforcement: lint
scope: ['**/*']
---

Enforced by commitlint in CI. Body is optional but encouraged for non-trivial changes.
