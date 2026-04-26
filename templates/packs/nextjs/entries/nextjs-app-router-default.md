---
id: nextjs-app-router-default
type: decision
title: New routes use the App Router, not the Pages Router
applies_to: team
confidence: medium
sources:
  - kind: manual
    ref: "manual/nextjs-pack-maintainers"
    note: Pack-curated guidance based on Next.js 14+ defaults.
created: 2026-04-26
last_validated: 2026-04-26
tags: [nextjs, routing, app-router]
decision: All new routes are added under `app/`, using React Server Components by default.
rationale: The App Router is the default in Next.js 14+ and provides streaming, nested layouts, and server actions. Keeping new work in one router avoids per-feature divergence.
outcome: pending
alternatives:
  - Pages Router (`pages/`) — kept only for legacy routes during migration
affects:
  - app/
  - pages/
---

## Context
Mixing the Pages and App routers in the same repository is supported but invites duplicated layouts, double data-fetching paths, and confusion over which conventions apply.

## Decision
All new routes go under `app/`. A page is a `page.tsx` server component unless it explicitly opts into `"use client"`. Co-locate `loading.tsx`, `error.tsx`, and `layout.tsx` per route segment.

## Consequences
- Existing `pages/` routes remain until they are individually migrated.
- API endpoints prefer `app/api/*/route.ts` route handlers over `pages/api/*`.
- New shared layouts live in `app/(group)/layout.tsx` rather than `_app.tsx`.
