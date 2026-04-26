---
name: apex-thumbs-up
---

Mark a knowledge entry as helpful.

**Usage:** `/apex-thumbs-up <entry-id>`

**Example:** `/apex-thumbs-up gh-pnpm-not-npm`

The entry-id is the kebab-style identifier shown in APEX recall output (e.g. `use-zod-for-validation`, `prefer-pnpm`).

The captured signal feeds the curator's confidence calibration in a future phase. APEX records the feedback into the current session's corrections.jsonl via the SessionStart-driven hook chain — no further action is required.
