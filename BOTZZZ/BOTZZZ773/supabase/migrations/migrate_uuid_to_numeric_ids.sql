-- Migration: Convert services from UUID to numeric IDs
-- This ensures compatibility with SMM panels that expect integer service IDs

-- Step 1: Add temporary numeric ID column to services
ALTER TABLE services ADD COLUMN IF NOT EXISTS temp_numeric_id SERIAL;

-- Step 2: Create mapping table to preserve UUID to numeric ID relationship during migration
CREATE TABLE IF NOT EXISTS service_id_migration_map (
  old_uuid_id UUID PRIMARY KEY,
  new_numeric_id INTEGER NOT NULL
);

-- Step 3: Populate mapping table with current UUIDs and their new numeric IDs
INSERT INTO service_id_migration_map (old_uuid_id, new_numeric_id)
SELECT id, temp_numeric_id FROM services
ON CONFLICT (old_uuid_id) DO NOTHING;

-- Step 4: Add temporary numeric service_id column to orders table
ALTER TABLE orders ADD COLUMN IF NOT EXISTS temp_service_id INTEGER;

-- Step 5: Migrate orders to use numeric service IDs via mapping table
UPDATE orders o
SET temp_service_id = m.new_numeric_id
FROM service_id_migration_map m
WHERE o.service_id::text = m.old_uuid_id::text;

-- Step 6: Verify all orders were migrated (should return 0)
-- SELECT COUNT(*) as unmigrated_orders FROM orders WHERE temp_service_id IS NULL AND service_id IS NOT NULL;

-- Step 7: Backup old UUID columns by renaming
ALTER TABLE services RENAME COLUMN id TO uuid_backup;
ALTER TABLE orders RENAME COLUMN service_id TO service_uuid_backup;

-- Step 8: Promote temporary numeric columns to primary columns
ALTER TABLE services RENAME COLUMN temp_numeric_id TO id;
ALTER TABLE orders RENAME COLUMN temp_service_id TO service_id;

-- Step 9: Drop ALL foreign key constraints that reference services.id FIRST
DO $$ 
DECLARE
    constraint_rec RECORD;
BEGIN
    -- Find and drop ALL foreign key constraints referencing services (orders + link_management)
    FOR constraint_rec IN
        SELECT con.conname, rel.relname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        WHERE con.confrelid = 'services'::regclass
        AND con.contype = 'f'
    LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', constraint_rec.relname, constraint_rec.conname);
        RAISE NOTICE 'Dropped foreign key: %.%', constraint_rec.relname, constraint_rec.conname;
    END LOOP;
END $$;

-- Step 10: Now drop old primary key constraint on services
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_pkey;

-- Step 11: Set new numeric ID as primary key
ALTER TABLE services ADD PRIMARY KEY (id);

-- Step 12: Migrate link_management table BEFORE re-adding foreign keys
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'link_management' AND column_name = 'primary_service_id') THEN
        -- Add temp column
        ALTER TABLE link_management ADD COLUMN IF NOT EXISTS temp_primary_service_id INTEGER;
        
        -- Migrate using mapping table
        UPDATE link_management lm
        SET temp_primary_service_id = m.new_numeric_id
        FROM service_id_migration_map m
        WHERE lm.primary_service_id::text = m.old_uuid_id::text;
        
        -- Backup and promote
        ALTER TABLE link_management RENAME COLUMN primary_service_id TO primary_service_uuid_backup;
        ALTER TABLE link_management RENAME COLUMN temp_primary_service_id TO primary_service_id;
        
        RAISE NOTICE 'Migrated link_management.primary_service_id to numeric';
    END IF;
END $$;

-- Step 13: Re-add foreign key constraints with new numeric ID references
ALTER TABLE orders ADD CONSTRAINT orders_service_id_fkey 
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT;

-- Also handle link_management foreign key if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'link_management' AND column_name = 'primary_service_id') THEN
        ALTER TABLE link_management ADD CONSTRAINT link_management_primary_service_id_fkey
          FOREIGN KEY (primary_service_id) REFERENCES services(id) ON DELETE SET NULL;
        RAISE NOTICE 'Re-added foreign key: link_management.primary_service_id';
    END IF;
END $$;

-- Step 14: Create index on service_id in orders for performance (if not exists)
-- Note: This index likely already exists from schema.sql, but IF NOT EXISTS ensures safety
CREATE INDEX IF NOT EXISTS idx_orders_service_id ON orders(service_id);

-- Step 15: Verify migration succeeded so far
DO $$
DECLARE
    service_count INTEGER;
    order_count INTEGER;
    orphan_count INTEGER;
BEGIN
    -- Count services
    SELECT COUNT(*) INTO service_count FROM services WHERE pg_typeof(id) = 'integer'::regtype;
    
    -- Count orders
    SELECT COUNT(*) INTO order_count FROM orders WHERE service_id IS NOT NULL;
    
    -- Count orphaned orders
    SELECT COUNT(*) INTO orphan_count
    FROM orders o
    LEFT JOIN services s ON o.service_id = s.id
    WHERE s.id IS NULL AND o.service_id IS NOT NULL;
    
    RAISE NOTICE 'Migration checkpoint: % services migrated, % orders migrated, % orphans', 
                  service_count, order_count, orphan_count;
    
    IF orphan_count > 0 THEN
        RAISE WARNING 'Found % orphaned orders! Migration may have issues.', orphan_count;
    END IF;
END $$;

-- Step 16: Add helpful comments to tables
COMMENT ON COLUMN services.id IS 'Numeric service ID for SMM panel API compatibility';
COMMENT ON COLUMN services.uuid_backup IS 'Original UUID preserved for reference';
COMMENT ON COLUMN orders.service_id IS 'Numeric service ID (foreign key to services.id)';
COMMENT ON COLUMN orders.service_uuid_backup IS 'Original UUID service reference preserved for rollback';

-- Add comment for link_management if it exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'link_management' AND column_name = 'primary_service_id') THEN
        EXECUTE 'COMMENT ON COLUMN link_management.primary_service_id IS ''Numeric service ID (foreign key to services.id)''';
        EXECUTE 'COMMENT ON COLUMN link_management.primary_service_uuid_backup IS ''Original UUID service reference preserved for rollback''';
    END IF;
END $$;

-- Step 17: Grant necessary permissions (service_role bypasses RLS, but authenticated needs access)
GRANT SELECT, INSERT, UPDATE, DELETE ON services TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO authenticated;
GRANT SELECT ON service_id_migration_map TO authenticated;

-- Migration complete!
-- The mapping table (service_id_migration_map) is kept for reference
-- You can drop it after verifying everything works (WAIT 1 WEEK):
-- DROP TABLE service_id_migration_map;

-- Optional: Drop UUID backup columns after verification (WAIT A WEEK FIRST!)
-- ALTER TABLE services DROP COLUMN uuid_backup;
-- ALTER TABLE orders DROP COLUMN service_uuid_backup;

-- Final success message
DO $$
BEGIN
    RAISE NOTICE '✅ Migration from UUID to numeric IDs completed successfully!';
    RAISE NOTICE '📊 Run post_migration_verification.sql to verify everything is correct.';
    RAISE NOTICE '🚀 Deploy dual-compatible v2.js and test goupsocial registration.';
END $$;

