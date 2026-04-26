---
id: django-migration-on-prod-no-fakes
type: gotcha
title: Running makemigrations on prod data with --fake hides schema drift
applies_to: team
confidence: high
sources:
  - kind: manual
    ref: "manual/django-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [django, migrations, deployment]
symptom: Production database schema diverges from `models.py`; `manage.py migrate --fake` was used to "fix" a migration error and the underlying schema was never actually altered.
resolution: Never use `--fake` to escape a migration failure on production data. Treat `--fake` as a tool only for marking already-applied migrations during a one-time database import. Roll back the failing migration, write a corrected migration (often a `RunPython` data migration before a `RunSQL` schema change), and apply forward.
error_signature: --fake
affects:
  - "*/migrations/*.py"
---

## Why this happens
`migrate --fake` records a migration as applied without running its operations. Reaching for it under deployment pressure leaves the table schema in whatever state it was before the migration — but Django now believes the migration ran. Subsequent migrations build on a phantom schema and fail with confusing `column does not exist` errors weeks later.

## Fix
1. **Stop and roll back the failing migration**: `manage.py migrate <app> <previous>`.
2. **Inspect the data**: the migration usually fails because production has rows that violate a new constraint (NULL where NOT NULL is added, duplicate values where UNIQUE is added).
3. **Add a data migration before the schema change**: a `RunPython` step that backfills/cleans rows.
4. **Re-run** `migrate` against staging first, then prod.
5. If migration ran but did NOT actually alter the schema (rare), use `migrate --fake <app> <prev>` to rewind history, then re-apply for real.

The only legitimate `--fake` use case is initial setup of a database that already matches the models (e.g. when adopting Django on top of an existing schema).
