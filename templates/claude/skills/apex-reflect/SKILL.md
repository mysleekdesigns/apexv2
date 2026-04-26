---
name: apex-reflect
description: Distil lessons from recent session episodes into proposed knowledge entries. Use when the user asks to reflect on a session, extract lessons learned, or summarise what went wrong and was corrected. Trigger phrases "reflect on this", "what did we learn", "summarize this session", "extract lessons", "what went wrong this session", "any gotchas from today".
---

# apex-reflect

You have access to the APEX reflector CLI (`apex reflect`) which scans recent episode files for repeated failures and user corrections, then proposes durable knowledge entries to `.apex/proposed/`.

## When to invoke this skill

- User says "reflect on this", "what did we learn", "summarise this session", "any lessons from today", or similar.
- At the end of a session where notable failures or corrections occurred.
- When the user asks "what went wrong" and there are episode files available.

## Steps

1. **Run the reflector:**
   ```bash
   apex reflect --all
   ```
   This scans all episodes without completed reflection and writes proposals to `.apex/proposed/`.

2. **Read the report output** to find which proposals were written or skipped.

3. **Summarise to the user** — for each new proposal, explain in plain language:
   - What the lesson is (gotcha / convention).
   - How many times the signal appeared.
   - Where it came from (episode id, turn number).
   - Whether confidence is `low` or `medium` and what that means for review.

4. **Direct the user to review** — proposals live in `.apex/proposed/` and need human approval before they become active knowledge. Remind the user to run `apex promote` (or move files manually) after review.

## What NOT to do

- Do not move files from `.apex/proposed/` to `.apex/knowledge/` yourself — that requires the user's explicit approval.
- Do not call `apex reflect` more than once per skill invocation.
- Do not fabricate lesson summaries — base them entirely on what the CLI reported.

## Example summary format

After running `apex reflect --all`, produce output like:

```
Reflected 2 episode(s). Proposed 2 entries:

• reflect-gotcha-<id> (gotcha, confidence: low)
  Bash failures with "expected cursor to be undefined" appeared 2 times across
  episodes 2026-04-26-1432-9bc4 and 2026-04-26-1445-ab12. Suggests a recurring
  issue with Zod cursor schema definitions.
  → .apex/proposed/reflect-gotcha-<id>.md

• reflect-convention-<id> (convention, confidence: medium)
  The correction "use .optional() not .default(undefined)" appeared 3 times across
  3 distinct episodes.
  → .apex/proposed/reflect-convention-<id>.md

Review these in .apex/proposed/ and move approved entries to .apex/knowledge/.
```

If no proposals were written, say: "No new lessons detected — either no repeated signals were found across recent episodes, or all episodes have already been reflected."
