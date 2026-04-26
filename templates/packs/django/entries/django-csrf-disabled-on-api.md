---
id: django-csrf-disabled-on-api
type: gotcha
title: Disabling CSRF globally to fix a JSON API leaves session-authed views exposed
applies_to: team
confidence: high
sources:
  - kind: manual
    ref: "manual/django-pack-maintainers"
created: 2026-04-26
last_validated: 2026-04-26
tags: [django, security, csrf, drf]
symptom: A POST to a DRF endpoint returns 403 with "CSRF Failed" from a JS client. A teammate "fixes" it by removing `CsrfViewMiddleware` from `MIDDLEWARE` or by sprinkling `@csrf_exempt` on every view.
resolution: Keep `CsrfViewMiddleware` enabled. For DRF endpoints used by browser clients with session auth, ensure the client sends the `X-CSRFToken` header from the `csrftoken` cookie. For token-authenticated APIs, set `DEFAULT_AUTHENTICATION_CLASSES` to `TokenAuthentication` / `JWTAuthentication` — these bypass CSRF without disabling middleware.
error_signature: CSRF Failed
affects:
  - settings/base.py
  - "*/views.py"
---

## Why this happens
DRF's `SessionAuthentication` enforces CSRF for unsafe methods. A 403 looks like a routing problem; the easy "fix" of disabling CSRF middleware turns every other session-authed POST in the project into a CSRF-exploitable endpoint.

## Fix

**For DRF endpoints used by SPA clients (cookie auth):**
```js
// Read the csrftoken cookie and send it on writes
fetch("/api/orders/", {
  method: "POST",
  headers: { "X-CSRFToken": getCookie("csrftoken"), "Content-Type": "application/json" },
  credentials: "include",
  body: JSON.stringify(payload),
});
```

**For token / JWT APIs (no cookies):**
```python
# settings/base.py
REST_FRAMEWORK = {
  "DEFAULT_AUTHENTICATION_CLASSES": [
    "rest_framework_simplejwt.authentication.JWTAuthentication",
  ],
}
```
JWT/token auth does not check CSRF; cookies do. Pick one auth strategy per endpoint group and stick with it.

Never remove `django.middleware.csrf.CsrfViewMiddleware` from `MIDDLEWARE`.
