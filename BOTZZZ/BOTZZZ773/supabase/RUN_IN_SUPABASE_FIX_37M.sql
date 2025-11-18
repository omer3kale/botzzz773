-- ============================================
-- RUN THIS IN SUPABASE SQL EDITOR
-- Fixes order numbers to be in 37M range (not 370M)
-- ============================================

-- Step 1: Check current state
SELECT 
    'Current sequence value:' as info,
    last_value,
    'Next order will be: ' || ((last_value + 1) * 10)::TEXT || 'X (X=0-9)' as preview
FROM order_number_seq;

-- Step 2: Check current orders
SELECT 
    COUNT(*) as total_orders,
    MIN(order_number::BIGINT) as min_order,
    MAX(order_number::BIGINT) as max_order,
    COUNT(*) FILTER (WHERE order_number::BIGINT >= 370000000) as orders_in_370m_range,
    COUNT(*) FILTER (WHERE order_number::BIGINT >= 37000000 AND order_number::BIGINT < 370000000) as orders_in_37m_range
FROM orders
WHERE order_number ~ '^[0-9]+$';

-- Step 3: Reset sequence to correct 37M base
-- Find highest order in 37M range (not 370M) and divide by 10 to get sequence value
SELECT setval(
    'order_number_seq',
    GREATEST(
        37000007, -- Start from where we left off
        COALESCE(
            (
                SELECT MAX(order_number::BIGINT / 10)
                FROM orders
                WHERE order_number ~ '^[0-9]+$'
                  AND order_number::BIGINT >= 37000000
                  AND order_number::BIGINT < 370000000 -- Only consider 37M range, not 370M
            ),
            37000007
        )
    ),
    true
);

-- Step 4: Fix orders that are in 370M range - regenerate them in 37M range
UPDATE orders
SET order_number = generate_order_number()
WHERE order_number ~ '^[0-9]+$' 
  AND order_number::BIGINT >= 370000000
RETURNING id, order_number, provider_order_id;

-- Step 5: Verify everything is correct
SELECT 
    COUNT(*) as total_orders,
    MIN(order_number::BIGINT) as min_order_number,
    MAX(order_number::BIGINT) as max_order_number,
    COUNT(*) FILTER (WHERE order_number::BIGINT >= 370000000) as bad_orders_370m,
    COUNT(*) FILTER (WHERE order_number::BIGINT < 37000000) as bad_orders_below_37m,
    CASE 
        WHEN COUNT(*) FILTER (WHERE order_number::BIGINT >= 370000000 OR order_number::BIGINT < 37000000) = 0 
        THEN '✅ All orders in correct 37M range'
        ELSE '❌ Some orders outside 37M range'
    END as status
FROM orders
WHERE order_number ~ '^[0-9]+$';

-- Step 6: Show sample of current orders
SELECT 
    id,
    order_number,
    provider_order_id,
    status,
    created_at
FROM orders
ORDER BY created_at DESC
LIMIT 10;
