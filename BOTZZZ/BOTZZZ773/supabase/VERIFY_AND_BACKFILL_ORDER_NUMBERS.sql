-- ==========================================
-- VERIFY AND BACKFILL ORDER NUMBERS TO 37M
-- ==========================================
-- This script:
-- 1. Verifies the sequence and trigger exist
-- 2. Backfills existing orders with 37M order numbers
-- 3. Shows sample results for verification

BEGIN;

-- Step 1: Verify sequence exists and is set correctly
DO $$
DECLARE
    seq_value BIGINT;
BEGIN
    -- Check if sequence exists
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'order_number_seq') THEN
        RAISE EXCEPTION 'ERROR: order_number_seq does not exist! Run migration 20251118_update_order_number_to_37million.sql first!';
    END IF;
    
    -- Get current sequence value
    SELECT last_value INTO seq_value FROM order_number_seq;
    RAISE NOTICE 'Current sequence value: %', seq_value;
    
    IF seq_value < 37000000 THEN
        RAISE WARNING 'Sequence is below 37M! Current value: %. Consider running the migration again.', seq_value;
    ELSE
        RAISE NOTICE 'Sequence is correctly set at or above 37M';
    END IF;
END $$;

-- Step 2: Check current state of order_number column
DO $$
DECLARE
    null_count INTEGER;
    total_count INTEGER;
    old_format_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO total_count FROM orders;
    SELECT COUNT(*) INTO null_count FROM orders WHERE order_number IS NULL OR order_number = '';
    SELECT COUNT(*) INTO old_format_count FROM orders WHERE order_number LIKE 'ORD-%';
    
    RAISE NOTICE '===========================================';
    RAISE NOTICE 'CURRENT ORDER STATE:';
    RAISE NOTICE 'Total orders: %', total_count;
    RAISE NOTICE 'Orders with NULL/empty order_number: %', null_count;
    RAISE NOTICE 'Orders with old ORD- format: %', old_format_count;
    RAISE NOTICE '===========================================';
END $$;

-- Step 3: Backfill NULL, old-format, or sub-37M order numbers with 37M range
UPDATE orders
SET order_number = public.generate_order_number()
WHERE order_number IS NULL 
   OR order_number = '' 
   OR order_number LIKE 'ORD-%'
   OR (order_number ~ '^[0-9]+$' AND (order_number::BIGINT < 37000000));

-- Step 4: Get summary after backfill
DO $$
DECLARE
    total_count INTEGER;
    new_format_count INTEGER;
    sample_numbers TEXT;
BEGIN
    SELECT COUNT(*) INTO total_count FROM orders;
    SELECT COUNT(*) INTO new_format_count FROM orders WHERE order_number ~ '^[0-9]+$';
    
    -- Get 5 sample order numbers
    SELECT string_agg(order_number, ', ') INTO sample_numbers
    FROM (
        SELECT order_number 
        FROM orders 
        WHERE order_number ~ '^[0-9]+$'
        ORDER BY created_at DESC 
        LIMIT 5
    ) samples;
    
    RAISE NOTICE '===========================================';
    RAISE NOTICE 'AFTER BACKFILL:';
    RAISE NOTICE 'Total orders: %', total_count;
    RAISE NOTICE 'Orders with new numeric format: %', new_format_count;
    RAISE NOTICE 'Sample order numbers: %', sample_numbers;
    RAISE NOTICE '===========================================';
END $$;

-- Step 5: Verify trigger exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger 
        WHERE tgname = 'trg_orders_generate_order_number'
    ) THEN
        RAISE WARNING 'Trigger trg_orders_generate_order_number does not exist! New orders will not get order numbers automatically!';
    ELSE
        RAISE NOTICE 'Trigger exists - new orders will automatically get order numbers';
    END IF;
END $$;

-- Step 6: Show sample orders with their identifiers (for verification)
SELECT 
    id,
    order_number,
    provider_order_id,
    created_at,
    status
FROM orders
ORDER BY created_at DESC
LIMIT 10;

COMMIT;

-- ==========================================
-- VERIFICATION QUERIES (Run these separately to check)
-- ==========================================

-- Check sequence current value
-- SELECT currval('order_number_seq');

-- Check if all orders have order_number
-- SELECT COUNT(*) as missing_order_numbers FROM orders WHERE order_number IS NULL OR order_number = '';

-- View all orders with their identifiers
-- SELECT id, order_number, provider_order_id, status, created_at FROM orders ORDER BY created_at DESC;

-- Test generating a new order number
-- SELECT public.generate_order_number();
