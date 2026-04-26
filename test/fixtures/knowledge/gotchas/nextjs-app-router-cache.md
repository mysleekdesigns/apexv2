---
id: nextjs-app-router-cache
type: gotcha
title: Next.js app router caches fetches by default which masks data updates
applies_to: team
confidence: high
sources:
  - kind: correction
    ref: episode/2026-03-20-1145-aabb/turn-4
created: 2026-03-20
last_validated: 2026-04-20
tags: [nextjs, cache]
symptom: After mutating data, the page still shows the old value until a full reload.
resolution: Pass `{ cache no-store }` to fetch, or call revalidatePath after the mutation in a server action.
error_signature: stale data after mutation
affects:
  - apps/web/app/dashboard/page.tsx
---

## Fix
Tag fetches with revalidate semantics or call revalidatePath/revalidateTag in the server action that mutated.
