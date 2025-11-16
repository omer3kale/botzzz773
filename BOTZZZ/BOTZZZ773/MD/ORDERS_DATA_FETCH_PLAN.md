# Orders Data Fetch Strategy

This plan covers the data required to render the admin + customer order experiences, the systems that produce this data (providers, Supabase tables, Netlify functions), and the concrete implementation steps to make the fetch flow reliable.

---

## 1. Objectives

- Guarantee every order record contains both our reseller-facing identifiers and the provider-issued identifiers.
- Capture retail vs provider pricing, quantity, link, and service metadata in a single atomic write.
- Persist provider sync outputs (status, charge, start count, remains, notes) so the UI never waits on a live provider call.
- Serve all required fields via the `/orders` Netlify function with predictable JSON for both admins and customers.

---

## 2. Required fields & sources

| Field | Source | Notes / Usage |
| --- | --- | --- |
| `orders.id` | Supabase `orders` PK | Internal UUID for joins/updates. |
| `orders.public_id` or `orders.order_number` | Supabase sequence / fallback column | Customer-facing 7M-style reference. |
| `orders.provider_order_id` | Provider `/order` response | Display below our reference, used for status polling. |
| `orders.charge` | Calculated retail total | Amount customer paid; used for markup display. |
| `orders.provider_cost` | Provider `/order` or `/status` response | Used for margin, sanity checks. |
| `orders.status` | Local state machine (`pending`, `processing`, etc.) | Customer chip. |
| `orders.provider_status` | Provider `/status` response normalized | Second chip for provider progress. |
| `orders.last_status_sync` | Netlify sync timestamp | Drives "Synced Xm ago" label. |
| `orders.start_count`, `orders.remains` | Provider `/status` response | Needed for troubleshooting drops/refills. |
| `orders.provider_notes` | Provider response notes | Show in modals/logs. |
| `orders.link`, `orders.quantity` | Customer payload | For quick auditing. |
| `service.provider_service_id` | Supabase `services` table | Required to re-sync or resubmit. |
| `service.provider_id` + `providers.name` | Supabase `providers` table | For labeling provider row. |
| `user.email` | Supabase `users` table | Admin view of who placed the order. |

Everything else (timestamps, `completed_at`, etc.) is already available through the existing schema and may be forwarded unchanged.

---

## 3. Capture pipeline (order creation)

1. **Validate service & provider**: `handleCreateOrder` already fetches `services` with the joined provider. Keep using `supabase.from('services').select('*, provider:providers(*)')`.
2. **Persist base order**: Insert into `orders` with `order_number` (or fallback column) plus `charge`, `provider_cost` (estimate), `status='pending'`.
3. **Submit to provider**: Call `submitOrderToProvider` (PerfectPanel-compatible). Required response fields: `order`, optional `charge`, `start_count`, `remains`, `currency`, `note`.
4. **Atomic update**: Update the new row with:
   - `provider_order_id` (string)
   - `provider_status = 'processing'`
   - `last_status_sync = now()`
   - `provider_cost`, `provider_currency`
   - `start_count`, `remains`, `provider_notes`
   - raw `provider_response` JSON for later auditing.
5. **Return payload**: Ensure the API response includes all fields listed above so the frontend cache stays complete immediately after creation.

_Assumption_: Table columns (`provider_order_id`, `provider_cost`, `provider_status`, etc.) already exist per previous migrations; otherwise, add them before coding.

---

## 4. Sync pipeline (manual + scheduled)

Path: `netlify/functions/orders.js -> performOrderStatusSync` and `sync-order-status.js` background jobs.

Steps:

1. **Select scope**: Choose orders where `status IN ('pending','processing','partial')` OR explicit `orderIds` list. Always include rows with NULL `provider_order_id` to catch stuck submissions.
2. **Join metadata**: Fetch `services` (for provider mapping) and `providers` (for API creds) once per batch; cache in maps as the existing code already does.
3. **Provider calls**: For each order with a provider mapping, call `fetchProviderOrderStatus` (action `status`). Expect fields: `status`, `charge`, `start_count`, `remains`, `currency`, `note`.
4. **Normalize + update**: Map provider enums via `normalizeProviderStatus`, update `orders.status`, `orders.provider_status`, `orders.provider_cost`, `orders.start_count`, `orders.remains`, `orders.provider_currency`, `orders.provider_notes`, `orders.last_status_sync`.
5. **Surface summary**: Return `{ updated, results: [...] }` so the admin sync button can show "Updated 12 orders (2 failed)".

Enhancements to implement during coding:

- Add concurrency cap (e.g., `p-limit` or manual semaphore) if the provider dislikes parallel hits.
- Retry transient network errors with exponential backoff before marking an order as failed.

---

## 5. Retrieval pipeline (GET /.netlify/functions/orders)

### 5.1 Query structure

- For admins: select all orders (limit 100) sorted by `created_at desc`.
- For customers: filter `.eq('user_id', user.userId)`.
- Use a single Supabase query:

```sql
select
  orders.*,
  users:id,email,username,
  services:id,name,category,rate,provider_service_id,provider_id,
  providers:id,name,slug
from orders
left join users on users.id = orders.user_id
left join services on services.id = orders.service_id
left join providers on providers.id = services.provider_id;
```

- Ensure JSON keys stay shallow: nest as `user`, `service`, `service.provider` to match the existing frontend parsers.

### 5.2 Transform + cache

- Run `resolveOrderDisplayNumber` to backfill `order_number`/`order_reference` for rows missing the sequence.
- Always include both `order.order_number` (primary) and `order.provider_order_id` (secondary) in the response.
- Provide derived helpers:
  - `order.markup_amount = order.charge - order.provider_cost`
  - `order.markup_percent = ((charge - provider_cost)/provider_cost)*100` (guard against divide-by-zero).
- Keep `provider_response` trimmed (or move to a separate endpoint) if payload size becomes an issue.

### 5.3 Frontend expectations

- `/admin/orders` table reads from `ordersCache`. It needs: `order_number`, `provider_order_id`, `status`, `provider_status`, `last_status_sync`, `service.name`, `service.provider.name`, `charge`, `provider_cost`, `user.email`.
- Customer dashboard reuses the same endpoint but ignores admin-only joins; ensure the API does not leak sensitive provider credentials.

---

## 6. Implementation checklist

1. **API shape**
   - Update `handleGetOrders` to always select `public_id/order_number` + `provider_order_id` + joined `service.provider` data (left joins so curated manual services still load).
   - Add derived markup fields before returning.

2. **Data completeness guards**
   - Whenever `provider_order_id` is `null` after provider submission, log to `orders_audit` (future improvement) and include `provider_submission_state = 'pending'` so the UI can highlight issues.
   - Enforce non-null `provider_order_id` at the DB level once end-to-end flow is verified (deferred until after implementation).

3. **Sync resilience**
   - Extend `performOrderStatusSync` to pull orders tagged for manual review even if they no longer meet status filters.
   - Persist `sync_error` + `sync_error_at` fields for failed attempts (optional but recommended for debugging).

4. **Testing hooks**
   - Unit-test the Netlify handler with mocked Supabase and provider responses (existing `tests/` folder).
   - Add a Postman collection or `tests/api/orders.test.js` that covers: creation, provider injection, GET payload, sync summary.

---

## 7. Edge cases & mitigations

- **Provider timeout before order ID**: keep the local order as `status='failed'`, refund balance, and leave `provider_order_id = null`. These rows should surface in reports for manual resubmission.
- **Service without provider relation**: left joins prevent the dropdown or admin table from crashing; the plan still returns the base order data.
- **Currency mismatches**: default to `USD` via `normalizeCurrency` when provider omits `currency`.
- **Provider partial refunds**: store `provider_cost` from `/status` even if it changes over time; UI can mark partial/canceled states accurately.

---

## 8. Next actions

- [ ] Update `netlify/functions/orders.js` GET handler to emit the full dataset above.
- [ ] Add derived markup + provider metadata fields in the API response.
- [ ] Confirm `submitOrderToProvider` + sync flows persist every listed provider field.
- [ ] Expose the enriched payload to `js/admin-orders.js` so dual IDs and status chips can be implemented (Todo #2 & #4).
