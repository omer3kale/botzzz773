-- Quick Backfill Script for Existing Orders
-- Run this in Supabase SQL Editor to update old 7M orders to 37M range

BEGIN;

-- Update all orders with order_number below 37M to the new 37M range
UPDATE orders
SET order_number = public.generate_order_number()
WHERE order_number IS NULL 
   OR order_number = '' 
   OR order_number LIKE 'ORD-%'
   OR (order_number ~ '^[0-9]+$' AND (order_number::BIGINT < 37000000));

-- Show results
SELECT 
    COUNT(*) as total_orders,
    COUNT(CASE WHEN order_number::BIGINT >= 37000000 THEN 1 END) as orders_in_37m_range,
    COUNT(CASE WHEN order_number::BIGINT < 37000000 THEN 1 END) as orders_below_37m
FROM orders
WHERE order_number ~ '^[0-9]+$';

-- Show sample updated orders
SELECT 
    id,
    order_number,
    provider_order_id,
    status,
    created_at
FROM orders
ORDER BY created_at DESC
LIMIT 10;

COMMIT;
