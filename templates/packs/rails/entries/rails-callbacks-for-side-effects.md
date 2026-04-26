---
id: rails-callbacks-for-side-effects
type: gotcha
title: Putting external side effects in ActiveRecord callbacks breaks tests and transactions
applies_to: team
confidence: high
sources:
  - kind: manual
    ref: "manual/rails-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [rails, activerecord, callbacks, architecture]
symptom: Test runs send real emails / hit Stripe / enqueue jobs against external systems; or a job is enqueued before its parent transaction commits and fails because the row "does not exist yet".
resolution: Move side effects (emails, webhook calls, Stripe charges, third-party API hits) out of `before_save` / `after_save` callbacks into an explicit service object invoked from the controller. If you must keep them in the model, use `after_commit` (not `after_save`) and dispatch via `ActiveJob` so the work happens after the DB transaction closes.
error_signature: after_save
affects:
  - "app/models/**/*.rb"
---

## Why this happens
ActiveRecord callbacks fire on every `save`/`update`/`create` — including the ones in fixtures, seed data, and tests. A `before_save :charge_card` runs even when a developer types `User.first.update(name: "x")` in the console.

Worse, `after_save` fires *inside* the database transaction. If the surrounding transaction rolls back (constraint violation, an outer `transaction do … raise` block), any job already enqueued or webhook already fired is now operating on a record that no longer exists.

## Fix

```ruby
# app/services/orders/place.rb
module Orders
  class Place
    def self.call(customer:, items:)
      ActiveRecord::Base.transaction do
        order = Order.create!(customer: customer, items: items)
        order
      end.tap do |order|
        OrderMailer.confirmation(order).deliver_later
        StripeChargeJob.perform_later(order.id)
      end
    end
  end
end
```

If you cannot extract immediately, at least switch to `after_commit on: :create`:

```ruby
class Order < ApplicationRecord
  after_commit :send_confirmation, on: :create

  private

  def send_confirmation
    OrderMailer.confirmation(self).deliver_later
  end
end
```

`after_commit` fires only once the transaction has actually committed, and `deliver_later` defers the network call to the job queue.
