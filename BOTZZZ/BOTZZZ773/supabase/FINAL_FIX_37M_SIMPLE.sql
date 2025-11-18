-- ============================================
-- COPY AND PASTE THIS ENTIRE SCRIPT INTO SUPABASE SQL EDITOR
-- This will fix all orders to be in 37M range (37000000-37999999) with SEQUENTIAL numbering
-- ============================================

-- STEP 1: Reset sequence to 37000000
SELECT setval('order_number_seq', 37000000, false);

-- STEP 2: Update ALL orders sequentially starting from 37000000
-- Orders are processed by creation date (oldest first)
-- NO multiplication by 10 - just sequential numbers
WITH ordered_orders AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (ORDER BY created_at ASC) - 1 as seq_offset
    FROM orders
)
UPDATE orders
SET order_number = (37000000 + ordered_orders.seq_offset)::TEXT
FROM ordered_orders
WHERE orders.id = ordered_orders.id;

-- STEP 3: Set sequence to continue from where we left off
SELECT setval(
    'order_number_seq',
    (
        SELECT COALESCE(MAX(order_number::BIGINT), 37000000)
        FROM orders
        WHERE order_number ~ '^[0-9]+$'
    ),
    true
);

-- STEP 4: Verify all orders are now in 37M range and sequential
SELECT 
    COUNT(*) as total_orders,
    MIN(order_number::BIGINT) as min_order_number,
    MAX(order_number::BIGINT) as max_order_number,
    COUNT(*) FILTER (WHERE order_number::BIGINT >= 37000000 AND order_number::BIGINT < 38000000) as in_37m_range,
    COUNT(*) FILTER (WHERE order_number::BIGINT >= 38000000) as above_37m_range,
    CASE 
        WHEN MIN(order_number::BIGINT) >= 37000000 AND MAX(order_number::BIGINT) < 38000000 THEN '✅ SUCCESS - All orders 37000000-37999999'
        ELSE '❌ ERROR - Check min/max values'
    END as status
FROM orders
WHERE order_number ~ '^[0-9]+$';

-- STEP 5: Show current sequence value
SELECT 
    last_value as current_sequence,
    is_called,
    'Next order will be: ' || (last_value + 1)::TEXT as next_order_preview
FROM order_number_seq;

-- STEP 6: Update the generate_order_number function to use simple sequential numbering
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
    next_val BIGINT;
BEGIN
    -- Get next sequence value (no multiplication, just increment)
    next_val := nextval('order_number_seq');
    
    -- Return as text (simple sequential: 37000000, 37000001, 37000002, etc.)
    RETURN next_val::TEXT;
END;
$$ LANGUAGE plpgsql;

-- STEP 7: Show all current orders
SELECT 
    id,
    order_number,
    provider_order_id,
    status,
    created_at
FROM orders
ORDER BY created_at DESC;
