---
id: nextjs-client-secret-leak
type: gotcha
title: NEXT_PUBLIC_-prefixed env vars are bundled into the client bundle
applies_to: all
confidence: high
sources:
  - kind: manual
    ref: "manual/nextjs-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [nextjs, security, env, secrets]
symptom: A secret (API key, service token) ends up in the JavaScript shipped to the browser; it appears in DevTools sources or in the production bundle when grepped.
resolution: Never prefix a server-only secret with `NEXT_PUBLIC_`. Read secrets only inside server components, route handlers, or server actions, where `process.env.MY_SECRET` is server-side. If a value must reach the client, use a server-rendered prop or a dedicated public config endpoint.
error_signature: NEXT_PUBLIC_
affects:
  - .env
  - .env.local
  - next.config.js
---

## Why this happens
Next.js inlines any environment variable whose name starts with `NEXT_PUBLIC_` into the client JavaScript bundle at build time. There is no runtime gate — once `NEXT_PUBLIC_API_SECRET=...` is in `.env`, every browser that loads the app receives it.

## Fix
1. Audit `.env*` files: any variable consumed only by the server must NOT carry the `NEXT_PUBLIC_` prefix.
2. If you accidentally shipped a secret, rotate it immediately, then remove the prefix and redeploy.
3. For values that legitimately need to reach the client (e.g. a public Stripe publishable key), keep the `NEXT_PUBLIC_` prefix and double-check the value is meant to be public.
4. Prefer `import "server-only";` at the top of modules that load private env vars — it triggers a build error if a client component imports them by mistake.
