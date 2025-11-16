# Backend Fetch Reliability Plan

## Current Fetch Inventory

| Endpoint | Methods | Primary Consumers | Notes & Failure Risks |
| --- | --- | --- | --- |
| `/.netlify/functions/auth` | `POST` actions (`login`, `signup`, `verify`, `logout`) | `js/api-client.js`, `js/auth-backend.js`, auth forms | Handles every sign-in/out action. No retries or timeout; errors surface only through generic alerts, so transient API hiccups lock users out. |
| `/.netlify/functions/users` | `GET`, `PUT`, `DELETE` | `admin-users.js`, `admin-payments.js`, `admin-tickets.js`, `addfunds.js`, `admin.js` | Powers user grid, funding lookups, and ticket attribution. Each module hits it separately with raw `fetch`, duplicating headers and lacking coordinated throttling. |
| `/.netlify/functions/orders` | `GET`, `POST`, `PUT`, `DELETE` | `dashboard.js`, `order.js`, `admin-orders.js`, `admin.js` | High-volume path (polling, sync flows). Multiple auto-refresh timers can stampede the backend if it slows down. No backoff or dedupe. |
| `/.netlify/functions/services` (`?audience=customer\|admin`) | `GET`, `POST`, `PUT`, `DELETE` | `services.js`, `dashboard.js`, `admin-services.js`, `admin-orders.js`, `admin.js` | Catalog fetch happens on landing pages and admin import flows. Slow responses block hero sections with no feedback. |
| `/.netlify/functions/payments` / `/.netlify/functions/payeer` / `/.netlify/functions/crypto-payments` | `POST` (create checkout, Payeer gateway, crypto invoice) | `addfunds.js`, `payment-backend.js`, `admin-payments.js` | Payment initiation + history retrieval. Currently a single attempt; user must refresh on timeout, risking duplicate charges if backend eventually succeeds. |
| `/.netlify/functions/tickets` | `GET`, `POST`, `PUT` | `tickets.js`, `admin-tickets.js` | Customer + admin ticket consoles. Sequential fetch chains (load ticket → replies → close) run without shared guards; a flaky network can leave tickets stuck mid-update. |
| `/.netlify/functions/providers` (+ `providers/:id`) | `GET`, `POST`, `PUT`, `DELETE` | `admin-services.js`, `admin-settings.js`, `admin-payments.js`, `api-dashboard.js` | Provider sync + CRUD endpoints are hammered during service imports. No protection from rate limits, so repeated failures quickly cascade. |
| `/.netlify/functions/settings` | `GET`, `PUT` | `admin-settings.js` | Stores panel config and environment secrets. Missing timeout/retry means admins often see a frozen spinner instead of actionable errors. |
| `/.netlify/functions/dashboard` (`?reports=true`) | `GET` | `admin-reports.js`, `api-dashboard.js` | Heavy analytics payload. If it exceeds 10s, `fetch` waits indefinitely, potentially locking graphs and blocking other work. |
| `/.netlify/functions/api-keys` | `GET`, `POST`, `DELETE` | `api-dashboard.js` | Key issuance + management. Multiple concurrent operations hit this endpoint without sequencing or retries, making it easy to create partial state. |
| `/.netlify/functions/contact` | `POST` | `contact.js` | Form submissions rely on a single call; on failure the UI just logs an error, so users think the ticket succeeded. |

**Cross-cutting gaps:** every module implements its own headers, error strings, and loading indicators. There is no shared timeout, retry, offline awareness, or circuit-breaker logic, so transient infra issues become user-facing outages.

## Reliability Strategy

1. **Guard every Netlify call with a single resilience layer.** Patch `window.fetch` for `/.netlify/functions/*` URLs to enforce timeouts, retries with exponential backoff + jitter, auth propagation, and structured diagnostics.
2. **Prevent backend stampedes.** Track per-endpoint failure streaks and open a short-lived circuit breaker after repeated faults to halt flood traffic while surfacing actionable UI events.
3. **Improve UX signals.** Emit custom browser events (`fetchguard:*`) for retry, success, failure, and circuit changes so existing pages can show toast notifications or lightweight banners without rewriting each fetch.
4. **Observe and debug.** Keep lightweight metrics (attempt counts, retry totals, online/offline state) accessible through `window.fetchGuard.getMetrics()` for console diagnostics and future dashboards.
5. **Offline + timeout awareness.** Immediately reject guarded requests when the browser is offline or after `timeoutMs` to avoid hanging spinners, and broadcast connectivity changes to listeners.

## Implementation Checklist

- [x] Install the fetch guard before any feature scripts run on customer pages (`js/main.js`).
- [x] Install the same guard before admin bundles execute (`js/admin-auth.js`).
- [x] Publish developer documentation (this file) and wire example listeners (e.g., toast on `fetchguard:failure`).
- [x] Run the existing test harness once to ensure no regressions.
