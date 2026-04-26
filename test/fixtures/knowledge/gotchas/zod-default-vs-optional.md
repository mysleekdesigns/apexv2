---
id: zod-default-vs-optional
type: gotcha
title: Zod default makes a field optional in input but required in output
applies_to: team
confidence: medium
sources:
  - kind: reflection
    ref: episode/2026-04-05-0918-deef/turn-12
created: 2026-04-05
last_validated: 2026-04-22
tags: [zod, types]
symptom: TS thinks a field is required after parse but the input schema accepts undefined; surprising in API handlers.
resolution: Prefer .optional().default(value) when you want the value present after parse but the field is omittable on input.
---

Use the explicit `.optional().default(value)` chain to make intent obvious.
