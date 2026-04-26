---
id: django-fat-models-thin-views
type: convention
title: Business logic lives in models / services, not in views
applies_to: team
confidence: medium
sources:
  - kind: manual
    ref: "manual/django-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [django, architecture, conventions]
rule: Views (function or class-based) parse input, dispatch to a model method or service-layer function, and shape a response. They MUST NOT contain multi-step business logic, transactions, or notifications.
enforcement: manual
scope:
  - "*/views.py"
  - "*/viewsets.py"
---

**Why:** Logic in views is impossible to reuse from the Django admin, management commands, Celery tasks, or test fixtures. Pulling it into the model (or a `services.py` module per app) keeps every entrypoint consistent and removes the temptation to duplicate "business hours" checks across three views.

**How to apply:**

```python
# orders/services.py
from django.db import transaction
from .models import Order

@transaction.atomic
def place_order(*, customer, items, idempotency_key):
    if Order.objects.filter(idempotency_key=idempotency_key).exists():
        return Order.objects.get(idempotency_key=idempotency_key)
    order = Order.objects.create(customer=customer, idempotency_key=idempotency_key)
    order.add_items(items)
    order.charge()
    order.notify_customer()
    return order
```

```python
# orders/views.py
class OrderCreateView(generics.CreateAPIView):
    serializer_class = CreateOrderSerializer

    def perform_create(self, serializer):
        order = place_order(
            customer=self.request.user.customer,
            items=serializer.validated_data["items"],
            idempotency_key=self.request.headers["Idempotency-Key"],
        )
        serializer.instance = order
```

The view stays small and obvious; `place_order` is callable from anywhere — admin actions, management commands, retries from a Celery task.
