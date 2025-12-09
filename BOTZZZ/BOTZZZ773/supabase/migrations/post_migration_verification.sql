-- Post-Migration Verification Script
-- Run this AFTER the migration to verify success

-- 1. Verify services now have numeric IDs
SELECT 
  'services.id type (should be integer)' as check_type,
  pg_typeof(id) as current_type,
  MIN(id) as min_id,
  MAX(id) as max_id,
  COUNT(*) as count
FROM services
GROUP BY pg_typeof(id);

-- 2. Verify orders now have numeric service_id
SELECT 
  'orders.service_id type (should be integer)' as check_type,
  pg_typeof(service_id) as current_type,
  COUNT(*) as count
FROM orders
WHERE service_id IS NOT NULL
GROUP BY pg_typeof(service_id);

-- 3. Verify all orders still reference valid services
SELECT 
  'Orphaned orders (should be 0)' as check_type,
  COUNT(*) as count
FROM orders o
LEFT JOIN services s ON o.service_id = s.id
WHERE s.id IS NULL AND o.service_id IS NOT NULL;

-- 4. Verify backup columns exist
SELECT 
  'Backup columns exist' as check_type,
  COUNT(*) as count
FROM information_schema.columns
WHERE table_name = 'services' AND column_name = 'uuid_backup';

-- 5. Verify primary key is correct
SELECT 
  tc.table_name,
  kcu.column_name as primary_key_column,
  kcu.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu 
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_name IN ('services', 'orders');

-- 6. Verify foreign key constraint exists
SELECT 
  tc.constraint_name,
  tc.table_name,
  kcu.column_name,
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name = 'orders'
  AND kcu.column_name = 'service_id';

-- 7. Sample of migrated service IDs (should be sequential integers)
SELECT 'Sample migrated service IDs' as check_type, id, name, uuid_backup
FROM services
ORDER BY id
LIMIT 10;

-- 8. Sample of migrated order references (should match services.id)
SELECT 
  'Sample migrated orders' as check_type,
  o.id as order_id,
  o.service_id,
  s.name as service_name,
  o.service_uuid_backup
FROM orders o
JOIN services s ON o.service_id = s.id
LIMIT 10;

-- 9. Verify mapping table exists and is populated
SELECT 
  'Mapping table records' as check_type,
  COUNT(*) as count,
  MIN(new_numeric_id) as min_numeric_id,
  MAX(new_numeric_id) as max_numeric_id
FROM service_id_migration_map;

-- 10. Test API compatibility - check service ID range
SELECT 
  'Service ID range for API' as check_type,
  MIN(id) as min_service_id,
  MAX(id) as max_service_id,
  COUNT(DISTINCT id) as unique_ids,
  COUNT(*) as total_services
FROM services;

-- Migration verification complete!
-- If all checks pass:
-- ✅ services.id is integer
-- ✅ orders.service_id is integer
-- ✅ No orphaned orders
-- ✅ Backup columns exist
-- ✅ Foreign keys in place
-- ✅ Service IDs are sequential integers
-- Then you're ready to test with goupsocial!
