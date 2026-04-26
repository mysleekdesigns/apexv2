---
id: rails-find-each-large-tables
type: gotcha
title: Iterating a large table with `each` loads every row into memory
applies_to: all
confidence: high
sources:
  - kind: manual
    ref: "manual/rails-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [rails, activerecord, performance, memory]
symptom: A rake task or background job consumes gigabytes of RAM on a large table and is OOM-killed; logs show one giant `SELECT * FROM users` followed by silence.
resolution: Use `find_each` (or `find_in_batches`) for any iteration over a collection larger than a few thousand rows. Both batch the query (default 1000 rows) and only hold one batch in memory at a time.
error_signature: OutOfMemoryError
affects:
  - "lib/tasks/**/*.rake"
  - "app/jobs/**/*.rb"
---

## Why this happens
`User.all.each { |u| ... }` materializes every row into an Array of full ActiveRecord objects before the block runs. On a table with millions of rows that is gigabytes of allocations and zero progress reporting.

## Fix

```ruby
# Bad
User.all.each { |u| u.recompute_score! }

# Good — defaults to batches of 1000
User.find_each(batch_size: 1000) { |u| u.recompute_score! }

# Or, when you want the batch itself
User.find_in_batches(batch_size: 1000) do |batch|
  User.where(id: batch.map(&:id)).update_all(needs_review: true)
end
```

`find_each` orders by primary key and may not respect a custom `order` clause — pass `order: :desc` if you need newest-first, but be aware it cannot honor arbitrary `ORDER BY` columns.

For pure update jobs that don't need callbacks, prefer `update_all` (single SQL UPDATE) over iterating at all.
