# Silent Failure System - Testing & Validation Suite

## Pre-Deployment Testing Checklist

### 1. Database Migration Tests

#### Test 1.1: Column Creation
```sql
-- Verify columns exist with correct types
SELECT 
    column_name, 
    data_type, 
    column_default,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'orders' 
AND column_name IN ('customer_status', 'provider_error')
ORDER BY column_name;

-- Expected:
-- customer_status | character varying(50) | 'pending' | YES
-- provider_error  | text                  | NULL      | YES
```

#### Test 1.2: Indexes Created
```sql
-- Verify indexes exist and are functional
SELECT 
    indexname, 
    indexdef,
    idx_scan as times_used
FROM pg_indexes 
JOIN pg_stat_user_indexes ON pg_indexes.indexname = pg_stat_user_indexes.indexname
WHERE tablename = 'orders' 
AND pg_indexes.indexname IN ('idx_orders_customer_status', 'idx_orders_status_failed');

-- Expected: Both indexes present
```

#### Test 1.3: Constraints Applied
```sql
-- Verify check constraints
SELECT 
    conname as constraint_name,
    pg_get_constraintdef(oid) as definition
FROM pg_constraint 
WHERE conrelid = 'orders'::regclass 
AND conname LIKE '%status%';

-- Expected: check_customer_status_valid and check_status_valid
```

#### Test 1.4: Triggers Active
```sql
-- Verify triggers are enabled
SELECT 
    tgname as trigger_name,
    tgenabled as enabled,
    proname as function_name
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE tgrelid = 'orders'::regclass
AND tgname LIKE '%customer_status%';

-- Expected: 
-- trigger_set_customer_status_on_insert
-- trigger_prevent_customer_status_failed
```

#### Test 1.5: Provider Errors Table
```sql
-- Verify provider_errors table exists
SELECT 
    column_name, 
    data_type
FROM information_schema.columns 
WHERE table_name = 'provider_errors'
ORDER BY ordinal_position;

-- Expected: 11 columns (id, order_id, provider_id, error_message, etc.)
```

---

### 2. Backend API Tests

#### Test 2.1: Order Creation with Silent Failure
```bash
#!/bin/bash
# Test that failed orders return success to customer

TOKEN="YOUR_CUSTOMER_TOKEN"
API_URL="https://botzzz773.netlify.app/.netlify/functions/orders"

# Create order with service that will fail (invalid provider or insufficient balance)
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "service_id": "SERVICE_THAT_WILL_FAIL",
    "link": "https://instagram.com/test",
    "quantity": 1000
  }')

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"

# Verify:
# ✓ HTTP 201 (success)
# ✓ Response contains "success": true
# ✓ Response contains "status": "processing"
# ✓ No error message visible
```

**Expected Results:**
```json
{
  "success": true,
  "order": {
    "id": "...",
    "status": "processing",
    "message": "Order submitted successfully"
  }
}
```

#### Test 2.2: Admin Get Failed Orders
```bash
#!/bin/bash
# Test admin can retrieve failed orders

ADMIN_TOKEN="YOUR_ADMIN_TOKEN"
API_URL="https://botzzz773.netlify.app/.netlify/functions/orders?status=failed"

RESPONSE=$(curl -s -X GET "$API_URL" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json")

echo "$RESPONSE" | jq '.'

# Verify:
# ✓ Returns array of orders
# ✓ Each order has status: "failed"
# ✓ Each order has provider_error field
# ✓ Each order has customer_status: "processing"
```

**Expected Structure:**
```json
{
  "orders": [
    {
      "id": "...",
      "status": "failed",
      "customer_status": "processing",
      "provider_error": "Provider error: Not enough funds"
    }
  ]
}
```

#### Test 2.3: Customer Cannot See Failed Status
```bash
#!/bin/bash
# Test customer sees "processing" not "failed"

CUSTOMER_TOKEN="YOUR_CUSTOMER_TOKEN"
API_URL="https://botzzz773.netlify.app/.netlify/functions/orders"

RESPONSE=$(curl -s -X GET "$API_URL" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json")

echo "$RESPONSE" | jq '.orders[] | select(.status == "failed")'

# Verify:
# ✓ No output (customer cannot see failed status)
# ✓ All orders show status from customer_status field
```

#### Test 2.4: Resend Order Endpoint
```bash
#!/bin/bash
# Test admin can resend failed orders

ADMIN_TOKEN="YOUR_ADMIN_TOKEN"
ORDER_ID="FAILED_ORDER_ID"
API_URL="https://botzzz773.netlify.app/.netlify/functions/orders"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"resend_order\",
    \"order_id\": \"$ORDER_ID\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
BODY=$(echo "$RESPONSE" | head -n -1)

echo "HTTP Code: $HTTP_CODE"
echo "Response: $BODY"

# Verify:
# ✓ HTTP 200 (success)
# ✓ Response contains provider_order_id
# ✓ Database updated with new provider_order_id
# ✓ Status changed from failed to processing
```

#### Test 2.5: Non-Admin Cannot Resend
```bash
#!/bin/bash
# Test that customers cannot resend orders

CUSTOMER_TOKEN="YOUR_CUSTOMER_TOKEN"
ORDER_ID="ANY_ORDER_ID"
API_URL="https://botzzz773.netlify.app/.netlify/functions/orders"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"action\": \"resend_order\",
    \"order_id\": \"$ORDER_ID\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)

# Verify:
# ✓ HTTP 403 (forbidden)
# ✓ Error message about admin access required
```

---

### 3. Frontend UI Tests

#### Test 3.1: Customer Dashboard Hides Errors
**Steps:**
1. Login as customer who has failed order
2. Navigate to Dashboard → Orders
3. Find the order that failed

**Verify:**
- ✓ Order shows status as "Processing" (not "Failed")
- ✓ No error message visible
- ✓ Order appears in normal list
- ✓ All order details visible (link, quantity, charge)
- ✓ No indication of failure

**Screenshot Required:** Customer view showing "Processing" for failed order

#### Test 3.2: Admin Failed Orders Tab
**Steps:**
1. Login as admin
2. Navigate to Admin → Orders
3. Click "Failed" tab

**Verify:**
- ✓ Failed tab shows count badge (e.g., "Failed 3")
- ✓ Failed orders table displays
- ✓ Notice banner explains silent failure
- ✓ Provider error messages visible
- ✓ Resend/Edit/Delete buttons present

**Screenshot Required:** Admin failed orders view

#### Test 3.3: Admin Resend Functionality
**Steps:**
1. In failed orders view, click Resend button
2. Confirm action
3. Wait for response

**Verify:**
- ✓ Button shows loading spinner during request
- ✓ Success message displays with provider order ID
- ✓ Order moves out of failed tab
- ✓ Order appears in "All" or "Processing" tab
- ✓ No JavaScript console errors

**Screenshot Required:** Success message after resend

#### Test 3.4: Failed Order Count Updates
**Steps:**
1. Note failed order count in tab badge
2. Successfully resend one order
3. Check count updates

**Verify:**
- ✓ Count decrements by 1
- ✓ Count updates without page refresh
- ✓ Count matches actual failed orders in database

---

### 4. Database Integrity Tests

#### Test 4.1: Customer Status Never Shows Failed
```sql
-- Attempt to insert order with customer_status='failed'
INSERT INTO orders (
    user_id,
    service_id,
    quantity,
    link,
    charge,
    status,
    customer_status
) VALUES (
    'USER_ID',
    'SERVICE_ID',
    1000,
    'https://test.com',
    5.00,
    'failed',
    'failed'  -- This should be auto-converted to 'processing'
);

-- Verify customer_status was changed
SELECT customer_status FROM orders WHERE id = 'NEW_ORDER_ID';

-- Expected: 'processing' (not 'failed')
```

#### Test 4.2: Provider Error Logged Automatically
```sql
-- Update order to failed status with error
UPDATE orders
SET status = 'failed',
    provider_error = 'Test error: Insufficient balance'
WHERE id = 'TEST_ORDER_ID';

-- Verify error logged to provider_errors table
SELECT 
    order_id,
    error_message,
    retry_count,
    resolved
FROM provider_errors
WHERE order_id = 'TEST_ORDER_ID';

-- Expected: Row exists with error_message matching provider_error
```

#### Test 4.3: Error Resolution Tracking
```sql
-- Mark order as processing (simulating successful resend)
UPDATE orders
SET status = 'processing'
WHERE id = 'TEST_ORDER_ID';

-- Verify error marked as resolved
SELECT 
    resolved,
    resolved_at
FROM provider_errors
WHERE order_id = 'TEST_ORDER_ID';

-- Expected: resolved = TRUE, resolved_at = current timestamp
```

#### Test 4.4: Failed Orders Summary Function
```sql
-- Test summary function
SELECT * FROM get_failed_orders_summary();

-- Expected columns:
-- total_failed, total_affected_revenue, unique_providers, avg_retry_count, oldest_unresolved
```

#### Test 4.5: Provider Error Stats
```sql
-- Test provider error stats
SELECT * FROM get_provider_error_stats('7 days');

-- Expected: Grouped stats by provider with error counts
```

---

### 5. Error Handling Tests

#### Test 5.1: Invalid Order ID for Resend
```bash
curl -X POST "https://botzzz773.netlify.app/.netlify/functions/orders" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "resend_order", "order_id": "invalid-id"}'

# Expected: 404 Not Found or 400 Bad Request
```

#### Test 5.2: Resend Non-Failed Order
```sql
-- Create completed order
INSERT INTO orders (...) VALUES (..., 'completed', 'completed');

-- Try to resend (should fail)
-- Call resend API with this order ID

-- Expected: 400 error "Can only resend failed orders"
```

#### Test 5.3: Network Timeout Handling
**Steps:**
1. Disable internet or use network throttling
2. Attempt to resend order from admin panel
3. Wait for timeout

**Verify:**
- ✓ Request times out gracefully (45 seconds)
- ✓ Error message displayed: "Request timed out..."
- ✓ Button restored to original state
- ✓ No hanging requests

#### Test 5.4: Malformed Response Handling
**Mock Test:** Modify backend to return non-JSON response
**Verify:**
- ✓ Frontend handles gracefully
- ✓ Error message: "Invalid server response format"
- ✓ No JavaScript exceptions in console

---

### 6. Security Tests

#### Test 6.1: Customer Cannot Access Failed Status Filter
```bash
curl -X GET "https://botzzz773.netlify.app/.netlify/functions/orders?status=failed" \
  -H "Authorization: Bearer CUSTOMER_TOKEN"

# Expected: 403 Forbidden
```

#### Test 6.2: Customer Cannot See provider_error Field
```sql
-- Check RLS policies ensure customers can't see provider_error
-- Login as customer and query orders table

SELECT provider_error FROM orders WHERE user_id = 'MY_USER_ID';

-- Expected: Column not returned or NULL for all rows
```

#### Test 6.3: SQL Injection Prevention
```bash
# Attempt SQL injection in order_id
curl -X POST "https://botzzz773.netlify.app/.netlify/functions/orders" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "resend_order", "order_id": "abc123; DROP TABLE orders;--"}'

# Expected: Safe handling, no SQL execution
```

#### Test 6.4: XSS Prevention in Error Messages
```sql
-- Insert order with malicious error message
UPDATE orders
SET provider_error = '<script>alert("XSS")</script>'
WHERE id = 'TEST_ORDER_ID';

-- View in admin panel
-- Expected: Script tags escaped/sanitized, no alert popup
```

---

### 7. Performance Tests

#### Test 7.1: Failed Orders Query Performance
```sql
EXPLAIN ANALYZE
SELECT * FROM orders
WHERE status IN ('failed', 'error')
ORDER BY created_at DESC
LIMIT 100;

-- Verify: Uses idx_orders_status_failed index
-- Execution time: < 100ms
```

#### Test 7.2: Concurrent Resend Requests
```bash
#!/bin/bash
# Send 10 concurrent resend requests for different orders

for i in {1..10}; do
  (curl -X POST "https://botzzz773.netlify.app/.netlify/functions/orders" \
    -H "Authorization: Bearer ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"action\": \"resend_order\", \"order_id\": \"ORDER_$i\"}" &)
done
wait

# Verify: All requests complete successfully, no deadlocks
```

#### Test 7.3: Large Failed Orders List
```sql
-- Create 1000 failed orders
INSERT INTO orders (user_id, service_id, quantity, link, charge, status, customer_status, provider_error)
SELECT 
    'TEST_USER',
    'TEST_SERVICE',
    1000,
    'https://test.com',
    5.00,
    'failed',
    'processing',
    'Test error ' || generate_series
FROM generate_series(1, 1000);

-- Test admin UI loads without timeout
-- Expected: Page loads in < 3 seconds
```

---

### 8. Edge Case Tests

#### Test 8.1: Order with NULL Link
```sql
INSERT INTO orders (user_id, service_id, quantity, link, charge, status)
VALUES ('USER_ID', 'SERVICE_ID', 1000, NULL, 5.00, 'failed');

-- Verify admin UI handles NULL link gracefully
```

#### Test 8.2: Order with Extremely Long Error
```sql
UPDATE orders
SET provider_error = REPEAT('A', 10000)
WHERE id = 'TEST_ORDER_ID';

-- Verify:
-- - Error stored successfully (TEXT field)
-- - Admin UI shows truncated preview
-- - Full error visible on hover/click
```

#### Test 8.3: Order Missing Service Reference
```sql
-- Delete service reference
UPDATE orders SET service_id = NULL WHERE id = 'TEST_ORDER_ID';

-- Try to resend
-- Expected: 400 error "Order service not configured"
```

#### Test 8.4: Duplicate Resend (Rapid Clicks)
**Steps:**
1. Click resend button
2. Immediately click again before first request completes

**Verify:**
- ✓ Button disabled after first click
- ✓ Second click ignored
- ✓ Only one request sent
- ✓ No duplicate orders created

---

### 9. Monitoring & Alerting Tests

#### Test 9.1: Failed Order Count Alert
```sql
-- Get current failed order count
SELECT COUNT(*) FROM orders WHERE status = 'failed';

-- Setup alert: If count > 10, send notification
-- (Configure in monitoring system)
```

#### Test 9.2: Provider Error Rate
```sql
-- Calculate error rate per provider (last 24 hours)
SELECT 
    p.name,
    COUNT(CASE WHEN o.status = 'failed' THEN 1 END) as failed_count,
    COUNT(*) as total_orders,
    ROUND(100.0 * COUNT(CASE WHEN o.status = 'failed' THEN 1 END) / COUNT(*), 2) as error_rate
FROM orders o
JOIN services s ON o.service_id = s.id
JOIN providers p ON s.provider_id = p.id
WHERE o.created_at >= NOW() - INTERVAL '24 hours'
GROUP BY p.id, p.name
ORDER BY error_rate DESC;

-- Setup alert: If error_rate > 20% for any provider, alert admin
```

---

### 10. Rollback Test

#### Test 10.1: Verify Rollback Procedure
```sql
-- Backup current data
CREATE TABLE orders_backup AS SELECT * FROM orders;

-- Rollback migrations
ALTER TABLE orders DROP COLUMN IF EXISTS customer_status;
ALTER TABLE orders DROP COLUMN IF EXISTS provider_error;
DROP TABLE IF EXISTS provider_errors CASCADE;
DROP FUNCTION IF EXISTS set_customer_status_on_insert() CASCADE;
DROP FUNCTION IF EXISTS prevent_customer_status_failed() CASCADE;
DROP FUNCTION IF EXISTS log_provider_error() CASCADE;

-- Verify system still functional (without silent failure)
-- Restore from backup if needed
DROP TABLE orders;
ALTER TABLE orders_backup RENAME TO orders;
```

---

## Test Results Template

| Test ID | Test Name | Status | Notes |
|---------|-----------|--------|-------|
| 1.1 | Column Creation | ⬜ Pass / ❌ Fail | |
| 1.2 | Indexes Created | ⬜ Pass / ❌ Fail | |
| 1.3 | Constraints Applied | ⬜ Pass / ❌ Fail | |
| 2.1 | Silent Failure API | ⬜ Pass / ❌ Fail | |
| 2.2 | Admin Get Failed Orders | ⬜ Pass / ❌ Fail | |
| 3.1 | Customer UI Hides Errors | ⬜ Pass / ❌ Fail | |
| 3.2 | Admin Failed Orders Tab | ⬜ Pass / ❌ Fail | |
| ... | ... | ... | ... |

---

## Automated Test Script

```bash
#!/bin/bash
# silent_failure_tests.sh
# Automated testing suite for silent failure system

set -e

echo "===== Silent Failure System Test Suite ====="
echo ""

# Configuration
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
CUSTOMER_TOKEN="${CUSTOMER_TOKEN:-}"
API_URL="${API_URL:-https://botzzz773.netlify.app/.netlify/functions}"

if [ -z "$ADMIN_TOKEN" ] || [ -z "$CUSTOMER_TOKEN" ]; then
    echo "Error: ADMIN_TOKEN and CUSTOMER_TOKEN environment variables must be set"
    exit 1
fi

PASS_COUNT=0
FAIL_COUNT=0

function test_case() {
    local name="$1"
    local command="$2"
    echo -n "Testing: $name ... "
    if eval "$command" > /dev/null 2>&1; then
        echo "✓ PASS"
        ((PASS_COUNT++))
    else
        echo "✗ FAIL"
        ((FAIL_COUNT++))
    fi
}

# Test 1: Admin can get failed orders
test_case "Admin get failed orders" \
    "curl -sf -H 'Authorization: Bearer $ADMIN_TOKEN' '$API_URL/orders?status=failed' | jq -e '.orders'"

# Test 2: Customer cannot get failed orders
test_case "Customer cannot access failed filter" \
    "! curl -sf -H 'Authorization: Bearer $CUSTOMER_TOKEN' '$API_URL/orders?status=failed'"

# Test 3: Customer GET returns orders
test_case "Customer can get own orders" \
    "curl -sf -H 'Authorization: Bearer $CUSTOMER_TOKEN' '$API_URL/orders' | jq -e '.orders'"

# Add more tests...

echo ""
echo "===== Test Results ====="
echo "Passed: $PASS_COUNT"
echo "Failed: $FAIL_COUNT"
echo "Total: $((PASS_COUNT + FAIL_COUNT))"
echo ""

if [ $FAIL_COUNT -gt 0 ]; then
    exit 1
fi
```

---

## Post-Deployment Validation

After deploying to production, verify:

1. ✅ No customer complaints about seeing errors
2. ✅ Admin can access failed orders tab
3. ✅ Resend functionality working
4. ✅ Database triggers active
5. ✅ Error logging to provider_errors table
6. ✅ No performance degradation
7. ✅ Failed order count accurate

---

**Testing Complete:** [ ] Yes [ ] No

**Tested By:** _______________

**Date:** _______________

**Production Ready:** [ ] Yes [ ] No
