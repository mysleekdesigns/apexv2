---
name: apex-thumbs-down
---

Mark a knowledge entry as unhelpful or incorrect.

**Usage:** `/apex-thumbs-down <entry-id>`

**Example:** `/apex-thumbs-down gh-pnpm-not-npm`

The entry-id is the kebab-style identifier shown in APEX recall output (e.g. `use-zod-for-validation`, `prefer-pnpm`).

The captured signal feeds the curator's confidence calibration in a future phase. APEX records the feedback into the current session's corrections.jsonl via the SessionStart-driven hook chain — no further action is required.
