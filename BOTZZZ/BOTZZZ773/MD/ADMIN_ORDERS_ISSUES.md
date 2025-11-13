# Admin Orders Display & Sync Issues

## Problem Summary

### Issue 1: Order ID Display Not Using Service Public IDs (7M Range)
**Current State:**
- Order IDs showing as `#ORD-...` format with random alphanumeric strings
- Expected: Customer-facing order numbers starting from 7,000,000 range
- Provider order IDs (from upstream SMM panel) not displaying beneath main order ID

**Root Cause:**
- `order_number` column now generates `ORD-{uuid}` format via database trigger
- Frontend `resolveOrderIdentifiers` helper not checking `services.public_id`
- Provider order ID markup present but may not be populated if `provider_order_id` NULL

**Recommended Fixes:**
1. **Database Layer**: Update `generate_order_number()` function to use sequential numeric IDs starting from 7000000 *(implemented via `20251113_update_order_number_sequence.sql`)*
2. **Frontend Layer**: Update `resolveOrderIdentifiers` in `admin-orders.js` to prioritize service public_id if available *(applied)*
3. **Display Logic**: Ensure `buildProviderOrderIdMarkup` always shows provider's order reference when available *(applied; now surfaces provider service identifier when present)*

---

### Issue 2: Order Status Sync Returning 500 Error
**Error Message:**
```
POST https://botzzz773.pro/.netlify/functions/orders 500 (Internal Server Error)
{"error":"Failed to sync order statuses"}
```

**Observed Behavior:**
- Sync endpoint (`/orders` with `action: 'sync-status'`) consistently returns HTTP 500
- Auto-refresh interval triggering sync every 30 seconds, causing repetitive failures
- Manual sync button also fails with same error

**Potential Root Causes:**

1. **Missing Provider Configuration**
   - Orders may lack `service.provider` join data
   - Provider API credentials (`api_url`, `api_key`) might be NULL
   - Query in `performOrderStatusSync` requires nested `service:services(provider:providers(...))`

2. **Provider Order ID Missing**
   - Query filters `.not('provider_order_id', 'is', null)` but some orders might have NULL values
   - If all orders in sync-eligible status have NULL provider_order_id, result set is empty but may still throw error

3. **Provider API Request Failures**
   - `fetchProviderOrderStatus` timeout or network error
   - Provider returns malformed response (no `status` field)
   - Provider API rate limiting or authentication issues

4. **Database Schema Mismatch**
   - Recently added `order_number` column might have triggered view/cache invalidation
   - Foreign key joins in sync query may fail if relationships broken

**Recommended Debugging Steps:**

1. **Check Netlify Function Logs**
   ```bash
   # View detailed server-side error in Netlify dashboard
   # Look for stack trace showing exact failure point in handleSyncOrderStatuses or performOrderStatusSync
   ```

2. **Verify Provider Data Integrity**
   ```sql
   -- Check orders missing provider configuration
   SELECT o.id, o.status, o.provider_order_id, 
          s.id as service_id, p.id as provider_id, p.api_url
   FROM orders o
   LEFT JOIN services s ON o.service_id = s.id
   LEFT JOIN providers p ON s.provider_id = p.id
   WHERE o.status IN ('pending', 'processing', 'refilling', 'partial')
     AND o.provider_order_id IS NOT NULL;
   ```

3. **Test Provider API Connectivity**
   - Manually call provider status endpoint with valid order ID
   - Verify response format matches expected structure (`{status, remains, start_count, charge}`)

4. **Add Defensive Error Handling**
   - Wrap provider sync loop in try-catch per order
   - Return partial success if some orders sync successfully
   - Log detailed error context (order ID, provider name, API response)

**Immediate Workaround:**
Disable auto-refresh temporarily to stop error flood:
```javascript
// In admin-orders.js, comment out:
// startOrdersAutoRefresh();
```

---

## Related Code Files

- `netlify/functions/orders.js` - Lines 1057-1210 (`performOrderStatusSync`, `handleSyncOrderStatuses`)
- `js/admin-orders.js` - Lines 108-208 (`syncOrderStatuses`, `manualOrdersSync`)
- `supabase/migrations/20251113_add_order_number_column.sql` - Order number generation logic

---

## Next Actions

1. ✅ Review Netlify function logs for exact error stack trace
2. ✅ Run SQL query to audit provider configuration completeness
3. ✅ Test one order's provider status fetch manually via API
4. ✅ Update order number generation to use numeric sequence starting at 7M *(deploy migration and re-seed existing rows)*
5. 🔄 Monitor sync error handling to confirm new provider/service loading fixes resolve 500s
6. ✅ Update UI to show service/public provider identifiers instead of UUID fallback
7. ⬜ Validate in production: create a new order, confirm 7M-style identifier and successful status sync
