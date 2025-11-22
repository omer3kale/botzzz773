-- Fix order_number sequence to start at 37M (not 370M)
-- This corrects the sequence and all existing orders

BEGIN;

-- Step 1: Reset sequence to 37M base
-- The sequence should be at 37M range, NOT 370M
DO $$
DECLARE
    current_max BIGINT;
BEGIN
    -- Find the highest order number divided by 10 (to get base sequence value)
    SELECT COALESCE(
        MAX(
            CASE 
                WHEN order_number ~ '^[0-9]+$' AND order_number::BIGINT < 370000000
                THEN (order_number::BIGINT / 10)
                ELSE 0
            END
        ), 
        37000000
    ) INTO current_max
    FROM orders;

    -- Ensure we're at least at 37M
    IF current_max < 37000000 THEN
        current_max := 37000000;
    END IF;

    -- Set the sequence
    PERFORM setval('order_number_seq', current_max, true);

    RAISE NOTICE 'Sequence set to: % (next order will be: %X where X is 0-9)', current_max, (current_max + 1) * 10;
END $$;

-- Step 2: Fix any orders that were incorrectly created with 370M numbers
-- Convert them back to proper 37M range
WITH problematic_orders AS (
    SELECT id, order_number
    FROM orders
    WHERE order_number ~ '^[0-9]+$' 
      AND order_number::BIGINT >= 370000000
)
UPDATE orders
SET order_number = generate_order_number()
WHERE id IN (SELECT id FROM problematic_orders);

-- Step 3: Verify all orders are now in correct range
DO $$
DECLARE
    min_num BIGINT;
    max_num BIGINT;
    total_count INT;
    bad_count INT;
BEGIN
    SELECT 
        MIN(order_number::BIGINT),
        MAX(order_number::BIGINT),
        COUNT(*),
        COUNT(*) FILTER (WHERE order_number::BIGINT >= 370000000 OR order_number::BIGINT < 37000000)
    INTO min_num, max_num, total_count, bad_count
    FROM orders
    WHERE order_number ~ '^[0-9]+$';

    RAISE NOTICE 'Total orders: %', total_count;
    RAISE NOTICE 'Min order_number: %', min_num;
    RAISE NOTICE 'Max order_number: %', max_num;
    
    IF bad_count > 0 THEN
        RAISE WARNING 'Found % orders outside 37M-370M range!', bad_count;
    ELSE
        RAISE NOTICE '✓ All orders are in correct 37M range (37000000-369999999)';
    END IF;
END $$;

COMMIT;
