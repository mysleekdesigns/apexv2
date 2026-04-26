---
id: gh-pnpm-not-npm
type: convention
title: This project uses pnpm, not npm
applies_to: all
confidence: high
sources:
  - kind: correction
    ref: episode/2026-04-22-1f3e-b801/turn-12
  - kind: bootstrap
    ref: file/.github/workflows/ci.yml:18
created: 2026-04-22
last_validated: 2026-04-26
tags: [tooling, package-manager]
rule: Always use pnpm install, pnpm add, pnpm run. Lockfile is pnpm-lock.yaml.
enforcement: ci
scope: ['**/*']
---

**Why:** pnpm is enforced by CI (.github/workflows/ci.yml step verify-lockfile). Suggesting npm or yarn will fail the workflow.

**How to apply:** Replace any suggested npm or yarn command with the pnpm equivalent. Use pnpm dlx instead of npx for one-off binaries.
