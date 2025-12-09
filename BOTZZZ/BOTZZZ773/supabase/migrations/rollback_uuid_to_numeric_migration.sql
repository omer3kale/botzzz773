-- Rollback Migration: Restore UUID service IDs
-- Use this ONLY if the migration fails or causes issues
-- IMPORTANT: Only run this if migration was completed recently and data hasn't changed much

-- Step 1: Drop ALL foreign key constraints on orders.service_id (handles any naming)
DO $$ 
DECLARE
    constraint_name TEXT;
BEGIN
    -- Find and drop any foreign key constraint referencing services
    FOR constraint_name IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
        WHERE rel.relname = 'orders'
        AND att.attname = 'service_id'
        AND con.contype = 'f'
    LOOP
        EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', constraint_name);
        RAISE NOTICE 'Dropped constraint: %', constraint_name;
    END LOOP;
END $$;

-- Step 2: Restore UUID columns as primary
ALTER TABLE services RENAME COLUMN id TO temp_numeric_id;
ALTER TABLE orders RENAME COLUMN service_id TO temp_service_id;

ALTER TABLE services RENAME COLUMN uuid_backup TO id;
ALTER TABLE orders RENAME COLUMN service_uuid_backup TO service_id;

-- Step 3: Restore primary key on services
ALTER TABLE services DROP CONSTRAINT IF EXISTS services_pkey;
ALTER TABLE services ADD PRIMARY KEY (id);

-- Step 4: Drop temporary numeric columns
ALTER TABLE services DROP COLUMN IF EXISTS temp_numeric_id;
ALTER TABLE orders DROP COLUMN IF EXISTS temp_service_id;

-- Step 5: Drop mapping table
DROP TABLE IF EXISTS service_id_migration_map;

-- Step 6: Drop index
DROP INDEX IF EXISTS idx_orders_service_id;

-- Step 7: Verify rollback
DO $$
DECLARE
    service_count INTEGER;
    order_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO service_count FROM services WHERE pg_typeof(id) = 'uuid'::regtype;
    SELECT COUNT(*) INTO order_count FROM orders WHERE service_id IS NOT NULL;
    
    RAISE NOTICE '✅ Rollback complete: % services restored to UUID, % orders updated', 
                  service_count, order_count;
END $$;

-- Rollback complete - system restored to UUID-based service IDs
