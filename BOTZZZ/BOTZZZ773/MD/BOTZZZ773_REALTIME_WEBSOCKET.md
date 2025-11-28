# BOTZZZ773 Real-Time WebSocket Implementation

## Overview

The `BOTZZZ773Realtime` module provides instant WebSocket updates for orders, payments, tickets, and balance changes using Supabase Realtime.

## Features

- **Instant Order Updates**: Failed orders, completed orders, and refunds trigger immediate UI updates
- **Payment Notifications**: Real-time payment status changes
- **Ticket Updates**: Live ticket status changes
- **Balance Sync**: User balance updates in real-time
- **Automatic Fallback**: Falls back to 10-second polling if WebSocket is unavailable
- **Connection Heartbeat**: Maintains connection health with 30-second heartbeat

## File Location

```
js/botzzz773-realtime.js
```

## Usage

### Basic Initialization

```javascript
// Initialize the realtime client
BOTZZZ773Realtime.init();
```

### Subscribe to Orders

```javascript
BOTZZZ773Realtime.subscribeToOrders((data) => {
    console.log('Order update:', data.type, data.order);
});

// Listen for specific events
BOTZZZ773Realtime.on('order:failed', (data) => {
    showAlert('Order failed!', data.order.id);
});

BOTZZZ773Realtime.on('order:completed', (data) => {
    refreshOrderList();
});
```

### Subscribe to Payments

```javascript
BOTZZZ773Realtime.subscribeToPayments((data) => {
    console.log('Payment update:', data.payment);
});
```

### Subscribe to Tickets

```javascript
BOTZZZ773Realtime.subscribeToTickets((data) => {
    console.log('Ticket update:', data.ticket);
});
```

### Subscribe to User Balance

```javascript
BOTZZZ773Realtime.subscribeToBalance(userId, (data) => {
    updateBalanceDisplay(data.balance);
});
```

## Events

| Event | Description |
|-------|-------------|
| `order:change` | Any order INSERT, UPDATE, or DELETE |
| `order:failed` | Order status changed to 'failed' or 'error' |
| `order:completed` | Order status changed to 'completed' |
| `order:refunded` | Order status changed to 'refunded' or 'partial' |
| `payment:change` | Any payment change |
| `payment:completed` | Payment completed successfully |
| `payment:failed` | Payment failed |
| `ticket:change` | Any ticket change |
| `balance:change` | User balance updated |
| `connected` | WebSocket connection established |

## API Methods

### `init(options)`
Initialize the realtime client. Options:
- `supabaseUrl`: Supabase project URL (optional if client exists)
- `supabaseKey`: Supabase anon key (optional if client exists)

### `subscribeToOrders(callback, options)`
Subscribe to order changes.

### `subscribeToPayments(callback, options)`
Subscribe to payment changes.

### `subscribeToTickets(callback, options)`
Subscribe to ticket changes.

### `subscribeToBalance(userId, callback)`
Subscribe to balance changes for a specific user.

### `on(event, callback)`
Add event listener.

### `off(event, callback)`
Remove event listener.

### `unsubscribe(channelName)`
Unsubscribe from a specific channel.

### `unsubscribeAll()`
Unsubscribe from all channels.

### `getStatus()`
Get connection status.

### `destroy()`
Clean up all subscriptions and timers.

## Integration with Admin Orders

The admin orders page (`admin/orders.html`) automatically:

1. Attempts to initialize BOTZZZ773Realtime on page load
2. Subscribes to order changes
3. Updates failed orders badge instantly when orders fail
4. Refreshes the order list on status changes
5. Falls back to 10-second polling if WebSocket unavailable
6. Uses 1-minute backup polling when WebSocket is active (for data consistency)

## Supabase Requirements

For real-time to work, ensure:

1. Supabase Realtime is enabled in your project
2. The `orders`, `payments`, `tickets`, and `users` tables have Realtime enabled
3. Proper Row Level Security (RLS) policies are in place

### Enable Realtime in Supabase

Run this SQL in your Supabase SQL Editor (or use `/supabase/enable_realtime.sql`):

```sql
-- Enable Replica Identity FULL for real-time
ALTER TABLE orders REPLICA IDENTITY FULL;
ALTER TABLE payments REPLICA IDENTITY FULL;
ALTER TABLE tickets REPLICA IDENTITY FULL;
ALTER TABLE users REPLICA IDENTITY FULL;

-- Add tables to the realtime publication
DROP PUBLICATION IF EXISTS supabase_realtime;
CREATE PUBLICATION supabase_realtime FOR TABLE orders, payments, tickets, users;
```

Alternatively, in the Supabase Dashboard:
1. Go to **Database** → **Replication**
2. Enable `orders`, `payments`, `tickets`, and `users` tables for real-time
3. Set each table's Replica Identity to FULL

## Frontend Files

The following files are required for real-time to work:

1. `js/supabase-client.js` - Initializes Supabase client with anon key
2. `js/botzzz773-realtime.js` - Real-time WebSocket module

### HTML Script Order (in `<head>`):
```html
<!-- Supabase JS Client CDN -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
<!-- Admin Auth -->
<script src="../js/admin-auth.js"></script>
<!-- Supabase Client Initialization -->
<script src="../js/supabase-client.js"></script>
```

### HTML Script Order (before `</body>`):
```html
<script src="../js/admin.js"></script>
<script src="../js/admin-orders.js"></script>
<script src="../js/botzzz773-realtime.js"></script>
<script>
    if (typeof BOTZZZ773Realtime !== 'undefined') {
        BOTZZZ773Realtime.init();
    }
</script>
```

## Version

Current Version: **1.0.1**

## Changelog

### v1.0.1 (November 28, 2025)
- Added `supabase-client.js` for browser-side Supabase initialization
- Added auto-retry mechanism for Supabase client initialization
- Added `supabase:ready` event listener for async initialization
- Added Supabase CDN script to all admin pages
- Created `enable_realtime.sql` for Supabase setup
- Updated documentation with complete setup instructions

### v1.0.0 (November 28, 2025)
- Initial implementation
- Order, payment, ticket, and balance subscriptions
- Event system for specific status changes
- Automatic reconnection handling
- Fallback polling mechanism

