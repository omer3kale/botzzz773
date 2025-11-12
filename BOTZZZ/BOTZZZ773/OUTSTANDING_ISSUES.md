# Outstanding Issues

## 1. Service ID & Order ID Not Displayed

**Issue:**  
Both service IDs and order IDs are not visible in the frontend (admin panel and user-facing pages).

**Root Cause:**  
- **Service ID:** `public_id` column in `services` table is `NULL` for most records. Frontend logic expects a numeric `public_id` to display as `#1234`, falls back to showing `PID {provider_service_id}` instead.
- **Order ID:** Orders are displayed using the internal UUID (`order.id`), but the human-readable `order_number` field (e.g., `ORD-ABC123`) is not being shown in the UI.

**Responsible Code Locations:**
- **Services:**
  - `js/services.js` lines ~266–276: Constructs label from `public_id` or `provider_service_id`
  - `js/dashboard.js` line 231: Same label logic
  - `js/admin-services.js` lines 412–444, 1156–1203: Admin display logic for service IDs
- **Orders:**
  - `netlify/functions/orders.js` line 441: Generates `order_number` (`ORD-{timestamp}-{random}`)
  - `js/admin-orders.js` line 610: Displays `order.id` (UUID) instead of `order_number`
  - Database schema: `supabase/schema.sql` line 63 defines `order_number VARCHAR(20) UNIQUE NOT NULL`

**Fix:**
- **Services:** Populate `public_id` for all active services via SQL migration or admin bulk-assign UI.
- **Orders:** Update admin order table renderer to show `order_number` instead of raw UUID.

---

## 2. Supabase Order Schema Empty

**Issue:**  
The `orders` table in Supabase is empty or not receiving new order records.

**Root Cause:**  
- Order creation in `netlify/functions/orders.js` (lines 444–460) inserts into the `orders` table, but either:
  1. Insert is failing silently (check error logs).
  2. Orders are being created but deleted/rolled back due to subsequent errors.
  3. RLS policies are blocking inserts when called via service-role client.

**Responsible Code Locations:**
- `netlify/functions/orders.js` lines 444–482: Database insert for orders
- `supabase/schema.sql` line 201: `ALTER TABLE orders ENABLE ROW LEVEL SECURITY;` – check if RLS policy allows service-role inserts

**Fix:**
- Check Netlify function logs for `[ORDER] Database insert error:` messages.
- Verify RLS policies on `orders` table allow `service_role` to insert.
- Test order creation manually via Supabase SQL editor to confirm schema is correct.

---

## 3. Service & Order Status Stuck on "Processing"

**Issue:**  
Services and orders remain in "processing" status indefinitely. Status sync from provider is not functioning.

**Root Cause:**  
- **Services:** No automated sync job updates service availability from provider APIs.
- **Orders:** Status polling/webhook from provider is not implemented or failing. The `last_status_sync` field in `orders` table remains `NULL`.

**Responsible Code Locations:**
- **Services:**
  - `netlify/functions/providers.js`: Should have a sync action to refresh service status
  - No scheduled job or webhook to update service status automatically
- **Orders:**
  - `netlify/functions/orders.js` does not poll provider for order status updates after initial submission
  - `supabase/schema.sql` line 76: `last_status_sync TIMESTAMP WITH TIME ZONE` – never updated
  - Missing status sync endpoint or cron job

**Fix:**
- **Services:** Implement a provider sync function that fetches latest service list and updates status/availability in database.
- **Orders:** 
  1. Create a status polling function (`/.netlify/functions/sync-order-status`) that queries provider API using `provider_order_id`.
  2. Schedule it via Netlify scheduled functions or external cron.
  3. Update `status`, `provider_status`, `remains`, and `last_status_sync` fields.

---

## Summary

| Issue | Location | Action |
|-------|----------|--------|
| Service IDs missing | `js/services.js`, `js/dashboard.js`, `js/admin-services.js` | Populate `public_id` in database |
| Order IDs showing UUID | `js/admin-orders.js:610` | Display `order_number` instead of `id` |
| Orders table empty | `netlify/functions/orders.js:444-482`, RLS policies | Check logs, verify RLS, test insert |
| Service status stuck | No sync job exists | Build provider sync endpoint |
| Order status stuck | No status polling exists | Build order status sync endpoint + cron |
