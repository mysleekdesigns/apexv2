---
id: django-select-related-in-serializers
type: pattern
title: Use select_related / prefetch_related on querysets feeding DRF serializers
applies_to: team
confidence: high
sources:
  - kind: manual
    ref: "manual/django-pack-maintainers"
    note: Standard fix for the canonical N+1 in DRF list views.
created: 2026-04-26
last_validated: 2026-04-26
tags: [django, drf, performance, n-plus-one]
intent: Eliminate the N+1 SQL query pattern that occurs when a DRF serializer walks foreign-key or reverse relations during list serialization.
applies_when:
  - Adding or modifying a DRF `ListAPIView` / `ModelViewSet`
  - A serializer field references another model (FK, reverse FK, M2M)
  - Profiling reveals a request firing dozens of small SELECTs
example_ref: "manual/django-pack-maintainers"
---

## Pattern
Set `queryset` on the view (or override `get_queryset`) with `select_related` for forward FKs and `prefetch_related` for reverse / M2M relations.

```python
# views.py
class OrderListView(generics.ListAPIView):
    serializer_class = OrderSerializer
    queryset = (
        Order.objects
        .select_related("customer", "billing_address")  # forward FKs
        .prefetch_related("items__product")             # reverse + nested
        .order_by("-created_at")
    )
```

```python
# serializers.py
class OrderSerializer(serializers.ModelSerializer):
    customer = CustomerSerializer(read_only=True)
    items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = ["id", "customer", "items", "created_at"]
```

## Why
Without `select_related`/`prefetch_related`, each serialized row triggers extra queries for its relations — a list of 100 orders becomes 1 + 100 + (100 × items) SELECTs. The fix is local to the view and costs no clarity.

## Verification
Use `django-debug-toolbar` (dev) or `django-silk` to confirm the request is now O(1) queries instead of O(N).
