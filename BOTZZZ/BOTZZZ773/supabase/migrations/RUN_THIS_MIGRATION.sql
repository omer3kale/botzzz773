-- =============================================================================
-- CONSOLIDATED MIGRATION: PerfectPanel Integration
-- =============================================================================
-- Purpose: Add stable numeric IDs for external SMM panel compatibility
-- Run Order: Execute this entire file in Supabase SQL Editor
-- Risk: LOW (additive only, no data deletion)
-- Date: 2024-12-10
-- =============================================================================

-- =============================================================================
-- MIGRATION 1: Verify and Ensure services.public_id
-- =============================================================================

-- Check public_id column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'services' 
    AND column_name = 'public_id'
  ) THEN
    RAISE EXCEPTION 'Column services.public_id does not exist. Run admin services sync first.';
  END IF;
  RAISE NOTICE '✓ services.public_id column exists';
END $$;

-- Check for missing public_id on active services
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM services
  WHERE status = 'active' 
  AND public_id IS NULL;
  
  IF missing_count > 0 THEN
    RAISE WARNING 'Found % active services without public_id. Will be assigned in next step.', missing_count;
  ELSE
    RAISE NOTICE '✓ All active services already have public_id';
  END IF;
END $$;

-- Backfill missing public_id values
DO $$
DECLARE
  max_public_id INTEGER;
  next_id INTEGER;
  service_record RECORD;
  assigned_count INTEGER := 0;
BEGIN
  -- Get current maximum public_id (default to 6999)
  SELECT COALESCE(MAX(public_id), 6999) INTO max_public_id
  FROM services
  WHERE public_id IS NOT NULL;
  
  next_id := max_public_id + 1;
  
  -- Assign sequential public_id to services that don't have one
  FOR service_record IN 
    SELECT id, name
    FROM services
    WHERE status = 'active'
    AND public_id IS NULL
    ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE services
    SET public_id = next_id
    WHERE id = service_record.id;
    
    RAISE NOTICE '  Assigned public_id % to service: %', next_id, service_record.name;
    
    next_id := next_id + 1;
    assigned_count := assigned_count + 1;
  END LOOP;
  
  IF assigned_count > 0 THEN
    RAISE NOTICE '✓ Successfully assigned public_id to % services', assigned_count;
  ELSE
    RAISE NOTICE '✓ No services needed public_id assignment';
  END IF;
END $$;

-- Add unique constraint on public_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_public_id_unique'
  ) THEN
    ALTER TABLE services
    ADD CONSTRAINT services_public_id_unique
    UNIQUE (public_id)
    DEFERRABLE INITIALLY DEFERRED;
    
    RAISE NOTICE '✓ Added unique constraint on services.public_id';
  ELSE
    RAISE NOTICE '✓ Unique constraint on services.public_id already exists';
  END IF;
END $$;

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_services_public_id 
ON services(public_id)
WHERE public_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_services_public_id_status
ON services(public_id, status)
WHERE status = 'active';

DO $$
BEGIN
  RAISE NOTICE '✓ Created indexes for services.public_id lookups';
END $$;

-- =============================================================================
-- MIGRATION 2: Add orders.public_order_id
-- =============================================================================

-- Add public_order_id column
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS public_order_id INTEGER;

DO $$
BEGIN
  RAISE NOTICE '✓ Added orders.public_order_id column';
END $$;

-- Backfill existing orders
DO $$
DECLARE
  next_id INTEGER := 1000; -- Start from 1000
  order_record RECORD;
  backfilled_count INTEGER := 0;
BEGIN
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
    backfilled_count := backfilled_count + 1;
  END LOOP;
  
  IF backfilled_count > 0 THEN
    RAISE NOTICE '✓ Backfilled % orders with public_order_id starting from 1000', backfilled_count;
  ELSE
    RAISE NOTICE '✓ No orders needed backfill';
  END IF;
END $$;

-- Add unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_public_order_id_unique'
  ) THEN
    ALTER TABLE orders 
    ADD CONSTRAINT orders_public_order_id_unique 
    UNIQUE (public_order_id);
    
    RAISE NOTICE '✓ Added unique constraint on orders.public_order_id';
  ELSE
    RAISE NOTICE '✓ Unique constraint already exists';
  END IF;
END $$;

-- Create index
CREATE INDEX IF NOT EXISTS idx_orders_public_order_id 
ON orders(public_order_id);

DO $$
BEGIN
  RAISE NOTICE '✓ Created index on orders.public_order_id';
END $$;

-- Create auto-generation function
CREATE OR REPLACE FUNCTION generate_public_order_id()
RETURNS TRIGGER AS $$
DECLARE
  max_public_id INTEGER;
BEGIN
  IF NEW.public_order_id IS NULL THEN
    SELECT COALESCE(MAX(public_order_id), 999) INTO max_public_id FROM orders;
    NEW.public_order_id := max_public_id + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  RAISE NOTICE '✓ Created generate_public_order_id() function';
END $$;

-- Create trigger
DROP TRIGGER IF EXISTS trg_generate_public_order_id ON orders;

CREATE TRIGGER trg_generate_public_order_id
  BEFORE INSERT ON orders
  FOR EACH ROW
  EXECUTE FUNCTION generate_public_order_id();

DO $$
BEGIN
  RAISE NOTICE '✓ Created auto-generation trigger on orders';
END $$;

-- =============================================================================
-- FINAL VERIFICATION
-- =============================================================================

-- Check services
DO $$
DECLARE
  total_active INTEGER;
  with_public_id INTEGER;
  missing INTEGER;
  min_id INTEGER;
  max_id INTEGER;
BEGIN
  SELECT 
    COUNT(*),
    COUNT(public_id),
    COUNT(*) - COUNT(public_id),
    MIN(public_id),
    MAX(public_id)
  INTO total_active, with_public_id, missing, min_id, max_id
  FROM services
  WHERE status = 'active';
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'SERVICES VERIFICATION';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total active services: %', total_active;
  RAISE NOTICE 'Services with public_id: %', with_public_id;
  RAISE NOTICE 'Services missing public_id: %', missing;
  RAISE NOTICE 'Public ID range: % to %', min_id, max_id;
  
  IF missing > 0 THEN
    RAISE WARNING '⚠ % services still missing public_id!', missing;
  ELSE
    RAISE NOTICE '✓ All services have public_id';
  END IF;
END $$;

-- Check orders
DO $$
DECLARE
  total_orders INTEGER;
  with_public_order_id INTEGER;
  missing INTEGER;
  min_id INTEGER;
  max_id INTEGER;
BEGIN
  SELECT 
    COUNT(*),
    COUNT(public_order_id),
    COUNT(*) - COUNT(public_order_id),
    MIN(public_order_id),
    MAX(public_order_id)
  INTO total_orders, with_public_order_id, missing, min_id, max_id
  FROM orders;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'ORDERS VERIFICATION';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Total orders: %', total_orders;
  RAISE NOTICE 'Orders with public_order_id: %', with_public_order_id;
  RAISE NOTICE 'Orders missing public_order_id: %', missing;
  RAISE NOTICE 'Public order ID range: % to %', min_id, max_id;
  
  IF missing > 0 THEN
    RAISE WARNING '⚠ % orders still missing public_order_id!', missing;
  ELSE
    RAISE NOTICE '✓ All orders have public_order_id';
  END IF;
END $$;

-- Check trigger exists
DO $$
DECLARE
  trigger_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.triggers 
    WHERE trigger_name = 'trg_generate_public_order_id'
  ) INTO trigger_exists;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'TRIGGER VERIFICATION';
  RAISE NOTICE '========================================';
  
  IF trigger_exists THEN
    RAISE NOTICE '✓ Auto-generation trigger exists and active';
  ELSE
    RAISE WARNING '⚠ Trigger not found!';
  END IF;
END $$;

-- Check for duplicate public_id (should be 0)
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT public_id 
    FROM services 
    WHERE public_id IS NOT NULL
    GROUP BY public_id 
    HAVING COUNT(*) > 1
  ) duplicates;
  
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'DUPLICATE CHECK';
  RAISE NOTICE '========================================';
  
  IF dup_count > 0 THEN
    RAISE WARNING '⚠ Found % duplicate public_id values in services!', dup_count;
  ELSE
    RAISE NOTICE '✓ No duplicate public_id values in services';
  END IF;
END $$;

-- Check for duplicate public_order_id (should be 0)
DO $$
DECLARE
  dup_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dup_count
  FROM (
    SELECT public_order_id 
    FROM orders 
    WHERE public_order_id IS NOT NULL
    GROUP BY public_order_id 
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF dup_count > 0 THEN
    RAISE WARNING '⚠ Found % duplicate public_order_id values in orders!', dup_count;
  ELSE
    RAISE NOTICE '✓ No duplicate public_order_id values in orders';
  END IF;
END $$;

-- =============================================================================
-- MIGRATION COMPLETE
-- =============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE '✅ MIGRATION COMPLETE';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Review verification output above';
  RAISE NOTICE '2. Deploy v2.js backend changes';
  RAISE NOTICE '3. Run integration test: ./scripts/test-v2-integration.sh';
  RAISE NOTICE '4. Monitor logs for correct ID mapping';
  RAISE NOTICE '';
END $$;
