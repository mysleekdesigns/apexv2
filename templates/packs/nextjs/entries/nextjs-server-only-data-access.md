---
id: nextjs-server-only-data-access
type: convention
title: Database and secret access lives only inside server-only modules
applies_to: team
confidence: medium
sources:
  - kind: manual
    ref: "manual/nextjs-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [nextjs, app-router, server-only, security]
rule: Modules that read secrets, hit the database, or call privileged third-party APIs must `import "server-only"` at the top of the file. Never import them from a client component.
enforcement: lint
scope:
  - "app/**/*"
  - "lib/**/*"
  - "src/**/*"
---

**Why:** `import "server-only"` causes the bundler to throw a build-time error if the module is included in a client bundle. This is the cheapest available enforcement for keeping secrets, DB connections, and admin APIs out of the browser.

**How to apply:**

```ts
// lib/db.ts
import "server-only";
import { Pool } from "pg";

export const db = new Pool({ connectionString: process.env.DATABASE_URL });
```

Then a Server Component or Server Action can `import { db } from "@/lib/db"`. A Client Component (`"use client"`) that tries the same import fails the build with a clear message.

**Pairs well with:** `eslint-plugin-react-server-components` to flag accidental server-only imports from client modules during local dev.
