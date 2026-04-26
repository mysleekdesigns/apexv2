---
id: nextjs-server-action-validation
type: pattern
title: Validate every Server Action input with a Zod schema before mutating
applies_to: team
confidence: medium
sources:
  - kind: manual
    ref: "manual/nextjs-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [nextjs, server-actions, validation, zod]
intent: Treat Server Actions like untrusted public endpoints — validate the FormData payload before it reaches the database layer.
applies_when:
  - Adding a new `"use server"` function that accepts FormData or a plain object
  - Refactoring a Server Action that currently casts inputs as `any`
  - A Server Action writes to the database or invokes an external API
---

## Pattern
Define a Zod schema next to the action, parse before mutating, and surface field-level errors via the action's return value.

```ts
"use server";
import { z } from "zod";

const CreateTodo = z.object({
  title: z.string().min(1).max(120),
  dueAt: z.coerce.date().optional(),
});

export async function createTodo(_prev: unknown, formData: FormData) {
  const parsed = CreateTodo.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors };
  }
  await db.todo.create({ data: parsed.data });
  return { ok: true };
}
```

## Why
Server Actions accept arbitrary client input and are reachable as POST endpoints. Without validation, malformed FormData reaches the database layer and surfaces as opaque 500s. Pair this with a thin `useFormState` hook on the client to render `fieldErrors` inline.
