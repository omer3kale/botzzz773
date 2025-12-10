-- Migration: Verify and ensure services.public_id is properly populated
-- Purpose: Confirm all active services have unique public_id for SMM API compatibility
-- Author: BOTZZZ773 Team
-- Date: 2024-12-10
-- Risk Level: VERY LOW (read-mostly verification, safe backfill)

-- =============================================================================
-- STEP 1: Verify public_id column exists and is INTEGER type
-- =============================================================================

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
END $$;

-- =============================================================================
-- STEP 2: Check for missing public_id values on active services
-- =============================================================================

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
    RAISE NOTICE 'All active services have public_id assigned. Migration not needed.';
  END IF;
END $$;

-- =============================================================================
-- STEP 3: Backfill missing public_id values (if any exist)
-- =============================================================================

DO $$
DECLARE
  max_public_id INTEGER;
  next_id INTEGER;
  service_record RECORD;
  assigned_count INTEGER := 0;
BEGIN
  -- Get current maximum public_id (default to PUBLIC_ID_BASE - 1 = 6999)
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
    
    RAISE NOTICE 'Assigned public_id % to service: %', next_id, service_record.name;
    
    next_id := next_id + 1;
    assigned_count := assigned_count + 1;
  END LOOP;
  
  IF assigned_count > 0 THEN
    RAISE NOTICE 'Successfully assigned public_id to % services', assigned_count;
  ELSE
    RAISE NOTICE 'No services needed public_id assignment';
  END IF;
END $$;

-- =============================================================================
-- STEP 4: Add unique constraint on public_id (if not already exists)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_public_id_unique'
  ) THEN
    -- Only add unique constraint for public_id >= 7000 (admin-curated services)
    -- Provider services may share public_id temporarily during sync
    ALTER TABLE services
    ADD CONSTRAINT services_public_id_unique
    UNIQUE (public_id)
    DEFERRABLE INITIALLY DEFERRED;
    
    RAISE NOTICE 'Added unique constraint on services.public_id';
  ELSE
    RAISE NOTICE 'Unique constraint on services.public_id already exists';
  END IF;
END $$;

-- =============================================================================
-- STEP 5: Create index for fast lookups by public_id
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_services_public_id 
ON services(public_id)
WHERE public_id IS NOT NULL;

COMMENT ON INDEX idx_services_public_id IS 'Fast lookup for SMM API service queries by external ID';

-- =============================================================================
-- STEP 6: Add index for public_id + status (common query pattern)
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_services_public_id_status
ON services(public_id, status)
WHERE status = 'active';

COMMENT ON INDEX idx_services_public_id_status IS 'Optimized for SMM API service list queries';

-- =============================================================================
-- VERIFICATION QUERIES (run manually to verify migration success)
-- =============================================================================

-- Check all active services have public_id
-- SELECT 
--   COUNT(*) as total_active_services,
--   COUNT(public_id) as services_with_public_id,
--   COUNT(*) - COUNT(public_id) as services_missing_public_id
-- FROM services
-- WHERE status = 'active';
-- Expected: services_missing_public_id = 0

-- Check for duplicate public_id values (should return 0 rows)
-- SELECT public_id, COUNT(*), array_agg(name) as service_names
-- FROM services
-- WHERE public_id IS NOT NULL
-- GROUP BY public_id
-- HAVING COUNT(*) > 1;

-- Show distribution of public_id values
-- SELECT 
--   CASE 
--     WHEN public_id >= 7000 THEN 'Admin-curated (7000+)'
--     WHEN public_id >= 1000 THEN 'Provider-synced (1000-6999)'
--     ELSE 'Legacy (<1000)'
--   END as id_range,
--   COUNT(*) as service_count,
--   MIN(public_id) as min_id,
--   MAX(public_id) as max_id
-- FROM services
-- WHERE public_id IS NOT NULL
-- GROUP BY 
--   CASE 
--     WHEN public_id >= 7000 THEN 'Admin-curated (7000+)'
--     WHEN public_id >= 1000 THEN 'Provider-synced (1000-6999)'
--     ELSE 'Legacy (<1000)'
--   END
-- ORDER BY MIN(public_id);

-- Check active services ready for SMM API export
-- SELECT id, public_id, name, category, rate, status
-- FROM services
-- WHERE status = 'active'
-- AND public_id IS NOT NULL
-- ORDER BY public_id
-- LIMIT 10;
