-- Rollback Migration: Remove public_order_id from orders table
-- Purpose: Safely revert the public_order_id migration if issues occur
-- Author: BOTZZZ773 Team
-- Date: 2024-12-10
-- USE ONLY IF: Migration causes issues and you need to revert

-- =============================================================================
-- WARNING: This will remove the public_order_id column and all associated data
-- =============================================================================

-- STEP 1: Drop trigger first
DROP TRIGGER IF EXISTS trg_generate_public_order_id ON orders;

-- STEP 2: Drop function
DROP FUNCTION IF EXISTS generate_public_order_id();

-- STEP 3: Drop index
DROP INDEX IF EXISTS idx_orders_public_order_id;

-- STEP 4: Drop unique constraint
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_public_order_id_unique;

-- STEP 5: Drop column (this removes all public_order_id data)
ALTER TABLE orders DROP COLUMN IF EXISTS public_order_id;

-- =============================================================================
-- VERIFICATION
-- =============================================================================

-- Confirm column is removed (should return 0 rows)
-- SELECT column_name 
-- FROM information_schema.columns 
-- WHERE table_name = 'orders' 
-- AND column_name = 'public_order_id';

-- Confirm orders table still has all other data intact
-- SELECT COUNT(*) FROM orders;

RAISE NOTICE 'Successfully rolled back public_order_id migration';
RAISE NOTICE 'All orders table data preserved (only public_order_id column removed)';
