# Admin Orders & Service Loading Fix Research

The following briefing consolidates publicly shared solutions and best practices gathered from provider API docs (PerfectPanel, SMMRush, TopSMM), Supabase’s JS client guides, and Netlify function patterns. Each section maps to the numbered pain point you described.

---

## 1. Capture reseller + provider order details together

### 1.1 Key references

- PerfectPanel API: `order` and `status` endpoints return `order`, `charge`, `start_count`, `remains`, and provider-issued `order` ID.
- Supabase “Upserts with returning data” guide for writing combined payloads atomically.

### 1.2 Recommended approach

1. **Single source of truth**: When we accept a customer order, immediately call the provider’s `/order` endpoint. The response contains the provider’s order ID plus the charged amount—persist these in `orders.provider_order_id`, `orders.provider_charge`, `orders.provider_status`.
2. **Retail vs provider pricing**: Store `orders.charge` (customer retail) and `orders.provider_charge`. Calculating markup (`charge - provider_charge`) at write time mirrors the PerfectPanel example and makes table renders instant.
3. **Status polling**: Use the provider’s `/status` endpoint with the stored provider order ID to refresh `provider_status`, `start_count`, `remains`. Supabase’s JS client can upsert the results in one call so Netlify functions remain fast.

---

## 2. Cross-reference service names consistently

### 2.1 Key references

- Supabase row-level reference tables for catalog reconciliation.
- Industry practice from SMMRush: keep a `provider_service_id` + `canonical_service_slug` mapping.

### 2.2 Recommended approach

1. Create a `service_aliases` table with columns: `provider_id`, `provider_service_id`, `provider_name`, `alias_slug`, `normalized_name`.
2. When we import provider catalogs, normalize names (lowercase, hyphenated) and store them in aliases.
3. All customer-facing dropdowns should join `services` → `service_aliases` on `(provider_id, provider_service_id)` to guarantee the public label matches the curated set.

This cross-reference lets the storefront display human-friendly names while retaining the authoritative provider IDs.

---

## 3. Dual-order-ID display in `/admin/orders`

### 3.1 Key references

- Stripe Dashboard pattern: customer reference on top, processor reference as secondary muted text.
- Supabase doc on selecting nested JSON (`orders` joined with `providers`).

### 3.2 Recommended approach

1. In the orders fetch function, always select both `orders.public_id` (our 7M-style ID) and `orders.provider_order_id`.
2. Update the `order-id-cell` markup to:

   ```html
   <span class="order-id-primary">#70001234</span>
   <span class="order-id-provider">Provider ID: #P1234567</span>
   ```

   The muted secondary span should now show the provider order ID, never the UUID.
3. When `provider_order_id` is missing, show `Provider order pending` so admins instantly know what to troubleshoot.

---

## 4. Stabilize `/order` service dropdown ("No services available")

### 4.1 Key references

- Supabase filter guides: chain `.eq` calls carefully or use `.in` for boolean combos.
- Netlify function caching patterns to avoid stale data.

### 4.2 Common causes & fixes

1. **Over-filtering**: The frontend was filtering locally by `admin_approved` even though the backend already restricts to curated services. Remove redundant filters or ensure both use the same fields (`customer_portal_enabled`, `status`).
2. **Missing provider relation**: Supabase `select('*', 'provider:providers!inner(...)')` requires every service to have a linked provider. Switch to a left join (`provider:providers(*)`) so curated manual services without providers still load.
3. **Network guards**: Wrap the fetch call with retry/backoff (Netlify functions occasionally cold start). The MDN Fetch `AbortController` pattern prevents the dropdown from staying empty when the first request times out.

---

## 5. Accurate status chips on `/admin/orders`

### 5.1 Key references

- PerfectPanel status enums ("Pending", "In progress", "Completed", "Partial", "Processing", "Canceled").
- Stripe-style dual-status chips.

### 5.2 Recommended approach

1. Fetch both `orders.status` (customer-facing) and `orders.provider_status`.
2. Map provider statuses using a lookup (e.g., `inprogress → in-progress`) before rendering.
3. Display stacked chips: first for customer status, second for provider status, third for sync timestamp ("Synced 12m ago"). Use CSS modifiers (`order-status-chip--pending`, etc.) to color them consistently.

---

## 6. Reliable manual sync button

### 6.1 Key references

- Netlify functions best practice: queue long-running syncs (use background functions or Supabase Edge Functions).
- Supabase RPC for batched updates.

### 6.2 Recommended approach

1. Wire the “Sync Now” button to a dedicated Netlify function that triggers provider status refresh for the selected orders (or all pending states).
2. Run provider calls in parallel with `Promise.allSettled` but cap concurrency to avoid provider rate limits.
3. Update Supabase rows as soon as each provider response arrives to keep the UI fresh, then return a summary payload (e.g., `updated: 42, failed: 3`).
4. On the frontend, disable the button while syncing and display the summary in the toast so admins know it succeeded.

---

### Next Steps

- Implement the handler that fetches provider order IDs and statuses (Todo #1 & #5).
- Adjust the `/admin/orders` table markup to use the new data (Todo #2).
- Harden the `/order` service fetch and reduce duplicate filtering (Todo #3).
- Confirm the sync button hits the new Netlify function and shows progress (Todo #6).
