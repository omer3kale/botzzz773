# Admin Orders Sequential ID Verification

## Test 1: Admin Orders Page Loads
- **Setup**: Log in as an administrator.
- **Steps**:
  1. Navigate to `https://botzzz773.pro/admin/orders.html`.
- **Expected Result**: Page loads without console errors; orders table renders with existing records.

## Test 2: Order Numbers Show 7M Format
- **Setup**: Use the same admin session.
- **Steps**:
  1. Inspect the order ID column for the most recent orders.
- **Expected Result**: Each order displays as `#7000xxx` style identifier; provider reference appears on the secondary line when available.

## Test 3: New Order Generates Next Sequential ID
- **Setup**: Keep admin session open and open storefront in a separate tab.
- **Steps**:
  1. Place a new order through the public order flow.
  2. Refresh `admin/orders.html`.
- **Expected Result**: A new row appears with an order number exactly one higher than the previous maximum (e.g., previous `#7000005`, new `#7000006`).

## Test 4: Order Status Sync Succeeds
- **Setup**: Admin orders view open with recent data.
- **Steps**:
  1. Click the "Sync Status" button (or wait for auto-sync).
  2. Observe the network response in DevTools.
- **Expected Result**: Request completes with HTTP 200 and structured JSON payload; no toast or console error reporting a 500 failure.
