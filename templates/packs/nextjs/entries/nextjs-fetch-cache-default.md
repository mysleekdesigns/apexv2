---
id: nextjs-fetch-cache-default
type: gotcha
title: Server-component fetches are cached forever by default
applies_to: all
confidence: medium
sources:
  - kind: manual
    ref: "manual/nextjs-pack-maintainers"
    note: Behaviour observed in Next.js 14 App Router; Next 15 flipped some defaults — re-validate.
created: 2026-04-26
last_validated: 2026-04-26
tags: [nextjs, caching, fetch, app-router]
symptom: Data shown in a server component never updates after the first build/page-render, even when the upstream API returns fresh data.
resolution: 'Add an explicit cache directive to the `fetch` call. Use `{ cache: "no-store" }` for always-fresh, `{ next: { revalidate: 60 } }` for periodic revalidation, or call `revalidateTag(...)` after a mutation.'
error_signature: stale data server component
affects:
  - app/
---

## Why this happens
In Next.js 14 App Router, `fetch()` inside a server component participates in the Data Cache. Without an explicit directive, responses are cached indefinitely (`force-cache`). The first render becomes the only render until a redeploy or `revalidatePath`/`revalidateTag` fires.

## Fix
Be explicit at every server-side `fetch` site:

```ts
// Always fresh
const res = await fetch(url, { cache: "no-store" });

// Revalidate every 60s
const res = await fetch(url, { next: { revalidate: 60 } });

// Tag for on-demand invalidation from a Server Action
const res = await fetch(url, { next: { tags: ["todos"] } });
// ...later:
revalidateTag("todos");
```

If you are on Next.js 15+, the default flipped to `no-store` in many cases — verify against the running version's docs and update this entry's `last_validated` once confirmed.
