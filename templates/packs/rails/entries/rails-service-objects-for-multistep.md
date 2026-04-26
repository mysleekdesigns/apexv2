---
id: rails-service-objects-for-multistep
type: decision
title: Multi-step business workflows live in PORO service objects under app/services/
applies_to: team
confidence: medium
sources:
  - kind: manual
    ref: "manual/rails-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [rails, architecture, services]
decision: Any workflow that touches more than one model, dispatches jobs, calls external APIs, or wraps a transaction is implemented as a Plain Old Ruby Object under `app/services/<domain>/<verb>.rb` with a single `.call` class method.
rationale: Controllers should stay thin (params + dispatch + response). Putting multi-step logic in models leads to fat models, untestable callbacks, and order-of-operations bugs across mailers, jobs, and audits.
outcome: pending
alternatives:
  - "Concerns / mixins on the model — rejected: harder to find, share state via instance vars"
  - "Interactors gem — rejected: adds a dependency for what `def self.call` already provides"
  - "Logic in controllers — rejected: not reusable from jobs, console, or admin actions"
affects:
  - app/services/
  - app/controllers/
---

## Context
Without a designated home, "place an order" gradually accretes across `OrdersController#create`, `Order#after_create`, `OrderObserver`, and a Sidekiq worker. Tracing what actually happens during checkout becomes a forensics exercise.

## Decision
One file per workflow, named `<Verb>` under a domain namespace:

```
app/services/
  orders/
    place.rb        # Orders::Place.call(...)
    cancel.rb       # Orders::Cancel.call(...)
  billing/
    refund.rb       # Billing::Refund.call(...)
```

Convention:
- One public class method, `.call`, that returns the primary record (or a `Result` with `success?`/`error`).
- Wraps `ActiveRecord::Base.transaction` when the workflow spans multiple writes.
- Calls `deliver_later` and `perform_later` *after* the transaction commits.
- Raises domain-specific exceptions (e.g. `Orders::Place::InsufficientStock`) that controllers translate to HTTP responses.

## Consequences
- Controllers shrink to ~10 lines per action.
- Tests for workflows become unit tests on PORO classes — no `request_spec` boilerplate.
- Background jobs become one-line wrappers: `def perform(id); Orders::Place.call(...); end`.
- Existing model callbacks for side effects should be migrated lazily as their owning workflow gets a service object.
