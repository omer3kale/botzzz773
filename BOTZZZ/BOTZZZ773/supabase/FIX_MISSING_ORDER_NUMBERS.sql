-- Fix any orders that are missing order_number field
-- This ensures all orders have a proper 37M order number

-- First, check which orders are missing order_number
SELECT 
    id,
    order_number,
    provider_order_id,
    created_at,
    CASE 
        WHEN order_number IS NULL THEN 'NULL'
        WHEN order_number = '' THEN 'EMPTY'
        WHEN order_number::TEXT !~ '^[0-9]+$' THEN 'NON-NUMERIC'
        WHEN order_number::BIGINT < 37000000 THEN 'BELOW_37M'
        ELSE 'OK'
    END as status
FROM orders
WHERE 
    order_number IS NULL 
    OR order_number = ''
    OR order_number::TEXT !~ '^[0-9]+$'
    OR (order_number::TEXT ~ '^[0-9]+$' AND order_number::BIGINT < 37000000)
ORDER BY created_at DESC;

-- Update all orders missing proper order_number
UPDATE orders
SET order_number = generate_order_number()
WHERE 
    order_number IS NULL 
    OR order_number = ''
    OR order_number::TEXT !~ '^[0-9]+$'
    OR (order_number::TEXT ~ '^[0-9]+$' AND order_number::BIGINT < 37000000);

-- Verify all orders now have proper 37M order numbers
SELECT 
    COUNT(*) as total_orders,
    COUNT(order_number) as has_order_number,
    MIN(order_number::BIGINT) as min_order_number,
    MAX(order_number::BIGINT) as max_order_number
FROM orders;

-- Show sample of updated orders
SELECT 
    id,
    order_number,
    provider_order_id,
    status,
    created_at
FROM orders
ORDER BY created_at DESC
LIMIT 20;
