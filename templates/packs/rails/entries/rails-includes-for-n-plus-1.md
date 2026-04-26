---
id: rails-includes-for-n-plus-1
type: pattern
title: Use `includes` to eager-load associations referenced in views or serializers
applies_to: team
confidence: high
sources:
  - kind: manual
    ref: "manual/rails-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [rails, activerecord, performance, n-plus-one]
intent: Avoid the N+1 query that occurs when an iteration over a parent collection accesses a child association on each row.
applies_when:
  - A controller action returns a list and the view/serializer accesses an association per item
  - Profiling reveals N+1 queries in `development.log` or via `rack-mini-profiler`
  - You add the `bullet` gem and it fires on a new endpoint
example_ref: "manual/rails-pack-maintainers"
---

## Pattern
Use `includes` in the controller (or a query object) to eager-load associations that the view or serializer will touch.

```ruby
# Bad — 1 + N queries
@orders = Order.where(status: :open)
# in the view: order.customer.email triggers a SELECT per order

# Good — 2 queries total
@orders = Order.where(status: :open).includes(:customer, items: :product)
```

`includes` decides between `LEFT OUTER JOIN` and a separate `WHERE id IN (…)` based on whether the query references the association in conditions. If you need to filter on the association too, use `includes(...).references(:customer)` or `eager_load(:customer)`.

## Why
A list of 100 orders that touches `order.customer.email` and `order.items.first.product.name` will, without eager loading, fire 1 + 100 + 100×N queries. With `includes`, that drops to a small constant.

## Verification
Add `bullet` to the development Gemfile group; it will warn on missing `includes` and on unused `includes`. Treat both warnings as bugs to fix before merging.
