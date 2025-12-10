-- Migration: Add public_order_id to orders table for external SMM panel compatibility
-- Purpose: Enable PerfectPanel/GroupSocial integration with stable numeric order IDs
-- Author: BOTZZZ773 Team
-- Date: 2024-12-10
-- Risk Level: LOW (additive only, no data loss)

-- =============================================================================
-- STEP 1: Add public_order_id column (nullable initially for safe migration)
-- =============================================================================

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS public_order_id INTEGER;

COMMENT ON COLUMN orders.public_order_id IS 'External numeric order ID for SMM panel API compatibility (PerfectPanel, GroupSocial, etc.)';

-- =============================================================================
-- STEP 2: Backfill existing orders with sequential public_order_id values
-- =============================================================================

DO $$
DECLARE
  next_id INTEGER := 1000; -- Start from 1000 to avoid confusion with old test data
  order_record RECORD;
BEGIN
  -- Process existing orders that don't have a public_order_id yet
  FOR order_record IN 
    SELECT id 
    FROM orders 
    WHERE public_order_id IS NULL 
    ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE orders 
    SET public_order_id = next_id 
    WHERE id = order_record.id;
    
    next_id := next_id + 1;
  END LOOP;
  
  RAISE NOTICE 'Backfilled % orders with public_order_id starting from 1000', next_id - 1000;
END $$;

-- =============================================================================
-- STEP 3: Add unique constraint (after backfilling to prevent conflicts)
-- =============================================================================

ALTER TABLE orders 
ADD CONSTRAINT orders_public_order_id_unique 
UNIQUE (public_order_id);

-- =============================================================================
-- STEP 4: Create index for fast lookups by public_order_id
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_orders_public_order_id 
ON orders(public_order_id);

COMMENT ON INDEX idx_orders_public_order_id IS 'Fast lookup for external SMM API order status/refill queries';

-- =============================================================================
-- STEP 5: Create function to auto-generate public_order_id on new orders
-- =============================================================================

CREATE OR REPLACE FUNCTION generate_public_order_id()
RETURNS TRIGGER AS $$
DECLARE
  max_public_id INTEGER;
BEGIN
  -- Only generate if public_order_id is not already set
  IF NEW.public_order_id IS NULL THEN
    -- Get the current maximum public_order_id
    SELECT COALESCE(MAX(public_order_id), 999) INTO max_public_id FROM orders;
    
    -- Assign next sequential ID
    NEW.public_order_id := max_public_id + 1;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- STEP 6: Create trigger to auto-generate public_order_id on INSERT
-- =============================================================================

DROP TRIGGER IF EXISTS trg_generate_public_order_id ON orders;

CREATE TRIGGER trg_generate_public_order_id
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION generate_public_order_id();

COMMENT ON TRIGGER trg_generate_public_order_id ON orders IS 'Auto-generates sequential public_order_id for new orders';

-- =============================================================================
-- VERIFICATION QUERIES (run manually to verify migration success)
-- =============================================================================

-- Check all orders have public_order_id
-- SELECT COUNT(*) as total_orders, 
--        COUNT(public_order_id) as orders_with_public_id,
--        COUNT(*) - COUNT(public_order_id) as orders_missing_public_id
-- FROM orders;
-- Expected: orders_missing_public_id = 0

-- Check for duplicates (should return 0 rows)
-- SELECT public_order_id, COUNT(*) 
-- FROM orders 
-- WHERE public_order_id IS NOT NULL
-- GROUP BY public_order_id 
-- HAVING COUNT(*) > 1;

-- Check range of assigned IDs
-- SELECT MIN(public_order_id) as min_id, 
--        MAX(public_order_id) as max_id,
--        MAX(public_order_id) - MIN(public_order_id) + 1 as range,
--        COUNT(*) as total_count
-- FROM orders
-- WHERE public_order_id IS NOT NULL;

-- Test trigger by inserting a dummy order (then delete it)
-- INSERT INTO orders (user_id, service_id, link, quantity, status) 
-- VALUES (
--   (SELECT id FROM users LIMIT 1),
--   (SELECT id FROM services LIMIT 1),
--   'https://test.com/test',
--   100,
--   'pending'
-- ) RETURNING id, public_order_id;
-- DELETE FROM orders WHERE link = 'https://test.com/test';
