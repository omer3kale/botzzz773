# 🧪 Production Test Cases - BOTZZZ773

**Date:** November 7, 2025  
**Environment:** https://botzzz773.pro  
**Status:** Ready for Testing

---

## Test 1: Customer Can Place Order ✓

**Objective:** Verify customers can successfully place orders

### Prerequisites:
- Test account with balance: `test@botzzz.com` / `Test123!`
- Manually credit balance: 
  ```sql
  UPDATE users SET balance = 50.00 WHERE email = 'test@botzzz.com';
  ```

### Test Steps:
1. Navigate to https://botzzz773.pro/services.html
2. Verify services are visible (should see 5 TikTok services)
3. Click "Order" on any service
4. Should redirect to `/order.html?service=<id>`
5. Service dropdown should be pre-selected
6. Enter test data:
   - **Link:** `https://tiktok.com/@testuser123`
   - **Quantity:** `1000`
   - **Notes:** `Test order - do not process`
7. Verify estimated price displays correctly
8. Click "Submit Order Request"

### Expected Result:
- ✅ Success message: "Order #XXX created successfully!"
- ✅ Redirect to dashboard after 2 seconds
- ✅ Order visible in dashboard orders table
- ✅ Order status: "Pending" or "In Progress"
- ✅ Balance deducted from user account

### Verification Query:
```sql
SELECT id, user_id, service_id, link, quantity, charge, status, created_at 
FROM orders 
WHERE user_id = (SELECT id FROM users WHERE email = 'test@botzzz.com')
ORDER BY created_at DESC 
LIMIT 1;
```

### Pass Criteria:
- Order record created in database
- User balance decreased by charge amount
- Order appears in customer dashboard

---

## Test 2: Order Reaches Provider ✓

**Objective:** Verify orders are forwarded to provider API

### Prerequisites:
- Order from Test 1 completed
- Provider credentials valid (8csn or g1618)

### Test Steps:
1. Get order details from database:
   ```sql
   SELECT id, service_id, link, quantity, provider_order_id, status 
   FROM orders 
   WHERE id = '<order_id_from_test_1>';
   ```
2. Check provider dashboard/API:
   - **8csn:** Login to https://8csn.com/panel → Orders
   - **g1618:** Login to g1618 panel → Orders
3. Search for order by:
   - Link: `https://tiktok.com/@testuser123`
   - Quantity: `1000`
   - Date: Today

### Expected Result:
- ✅ Order exists in provider dashboard
- ✅ `provider_order_id` saved in database (not null)
- ✅ Provider status matches database status
- ✅ Service ID matches provider's service ID

### Verification Query:
```sql
SELECT 
    o.id,
    o.provider_order_id,
    o.status,
    s.name as service_name,
    s.provider_service_id,
    p.name as provider_name
FROM orders o
JOIN services s ON o.service_id = s.id
JOIN providers p ON s.provider_id = p.id
WHERE o.id = '<order_id_from_test_1>';
```

### Pass Criteria:
- `provider_order_id` is NOT NULL
- Order visible in provider panel
- Status synchronized between systems

### Manual Check (Backend Logs):
```bash
# In Netlify function logs, look for:
[ORDER] Submitting to provider: {"service":"123","link":"...","quantity":1000}
[ORDER] Provider response: {"order":456,"status":"success"}
```

---

## Test 3: Payment Flow Works ✓

**Objective:** Verify Payeer payment integration

### Prerequisites:
- Payeer merchant credentials configured in Netlify
- Webhook URL set: `https://botzzz773.pro/.netlify/functions/payeer`

### Test Steps:

#### A. Initiate Payment:
1. Login as customer
2. Navigate to https://botzzz773.pro/addfunds.html
3. Enter amount: `25.00` USD
4. Click "Add Funds"
5. Should redirect to Payeer payment page

#### B. Complete Payment:
6. On Payeer page, use test card or Payeer balance
7. Complete payment (or use Payeer sandbox if available)
8. Wait for redirect back to site

#### C. Verify Webhook:
9. Check Netlify function logs for webhook call:
   ```
   [PAYEER] Webhook received
   [PAYEER] Signature valid: true
   [PAYEER] Payment status: success
   [PAYEER] Balance updated for user: test@botzzz.com
   ```

### Expected Result:
- ✅ Redirected to `/payment-success.html`
- ✅ Balance increased by payment amount
- ✅ Payment record created in database
- ✅ Payment status: "completed"

### Verification Query:
```sql
SELECT 
    id, 
    user_id, 
    amount, 
    payment_method, 
    status, 
    transaction_id,
    created_at 
FROM payments 
WHERE user_id = (SELECT id FROM users WHERE email = 'test@botzzz.com')
ORDER BY created_at DESC 
LIMIT 1;
```

### Pass Criteria:
- Payment record exists with status = 'completed'
- User balance = old_balance + payment_amount
- Transaction ID saved from Payeer

### Test Without Real Payment (Mock):
```bash
# Manually trigger webhook with test data:
curl -X POST https://botzzz773.pro/.netlify/functions/payeer \
  -H "Content-Type: application/json" \
  -d '{
    "m_operation_id": "TEST123",
    "m_operation_ps": "1136053",
    "m_operation_date": "2025-11-07 12:00:00",
    "m_shop": "YOUR_MERCHANT_ID",
    "m_orderid": "USER_EMAIL",
    "m_amount": "25.00",
    "m_curr": "USD",
    "m_desc": "Test payment",
    "m_status": "success",
    "m_sign": "CALCULATED_SIGNATURE"
  }'
```

---

## Test 4: Balance Updates Correctly ✓

**Objective:** Verify balance changes for orders and payments

### Prerequisites:
- Test account with initial balance: `50.00`

### Test Steps:

#### Scenario A: Order Deduction
1. Record initial balance:
   ```sql
   SELECT balance FROM users WHERE email = 'test@botzzz.com';
   ```
2. Place order worth `5.00` (from Test 1)
3. Check new balance:
   ```sql
   SELECT balance FROM users WHERE email = 'test@botzzz.com';
   ```
4. Verify: `new_balance = initial_balance - order_charge`

#### Scenario B: Payment Addition
5. Record balance before payment
6. Complete payment of `25.00` (from Test 3)
7. Check balance after payment
8. Verify: `new_balance = old_balance + payment_amount`

#### Scenario C: Multiple Operations
9. Place 3 orders in sequence:
   - Order 1: `5.00`
   - Order 2: `3.00`
   - Order 3: `7.00`
10. Check balance after each order

### Expected Result:
- ✅ Balance accurate after each transaction
- ✅ No negative balance allowed (validation blocks order)
- ✅ Balance changes logged in activity_logs table

### Verification Queries:

**Current Balance:**
```sql
SELECT 
    email,
    balance,
    (SELECT SUM(charge) FROM orders WHERE user_id = users.id) as total_spent,
    (SELECT SUM(amount) FROM payments WHERE user_id = users.id AND status = 'completed') as total_paid
FROM users 
WHERE email = 'test@botzzz.com';
```

**Transaction History:**
```sql
-- Orders (debits)
SELECT 'ORDER' as type, id, created_at, charge as amount, status 
FROM orders 
WHERE user_id = (SELECT id FROM users WHERE email = 'test@botzzz.com')

UNION ALL

-- Payments (credits)
SELECT 'PAYMENT' as type, id, created_at, amount, status 
FROM payments 
WHERE user_id = (SELECT id FROM users WHERE email = 'test@botzzz.com')

ORDER BY created_at DESC;
```

### Pass Criteria:
- Balance = Total Paid - Total Spent
- No fractional cent errors (precision to 2 decimals)
- Negative balance prevented by validation

### Edge Cases to Test:
```sql
-- Test 1: Try order with insufficient balance
-- Current balance: $5.00, Order cost: $10.00
-- Expected: Error "Insufficient balance"

-- Test 2: Concurrent orders
-- Place 2 orders simultaneously
-- Expected: Balance updates correctly, no race conditions

-- Test 3: Failed payment
-- Initiate payment but don't complete
-- Expected: Balance unchanged
```

---

## 🎯 Quick Test Script (All Tests)

Run this in order:

```bash
# 1. Setup test user
echo "Creating test user with balance..."
# Run in Supabase SQL Editor:
# INSERT INTO users (email, password, balance) VALUES ('test@botzzz.com', '$2b$10$...', 50.00);

# 2. Test order placement
echo "Visit: https://botzzz773.pro/order.html?service=9faeba59-a31f-49e1-a8e8-23f0d48b8a8b"
echo "Place test order..."

# 3. Check order in database
echo "Verify order created..."
# Run SQL: SELECT * FROM orders WHERE user_id = (SELECT id FROM users WHERE email = 'test@botzzz.com');

# 4. Check provider
echo "Login to provider panel and verify order exists"

# 5. Test payment (if Payeer configured)
echo "Visit: https://botzzz773.pro/addfunds.html"
echo "Complete test payment..."

# 6. Verify final balance
echo "Check balance matches: initial + payments - orders"
```

---

## ✅ Test Completion Checklist

- [ ] Test 1: Order placement works
- [ ] Test 2: Order reaches provider  
- [ ] Test 3: Payment flow functional
- [ ] Test 4: Balance calculations correct
- [ ] All tests passed = **READY FOR LAUNCH** 🚀

---

## 📝 Test Results Template

**Tested by:** _________________  
**Date:** _________________  
**Environment:** Production

| Test | Status | Notes |
|------|--------|-------|
| Order Placement | ⬜ Pass / ⬜ Fail | |
| Provider Integration | ⬜ Pass / ⬜ Fail | |
| Payment Flow | ⬜ Pass / ⬜ Fail | |
| Balance Updates | ⬜ Pass / ⬜ Fail | |

**Issues Found:**
1. 
2. 
3. 

**Launch Decision:** ⬜ GO / ⬜ NO-GO
