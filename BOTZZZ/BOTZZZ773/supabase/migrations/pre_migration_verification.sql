-- Pre-Migration Verification Script
-- Run this BEFORE the migration to ensure safety

-- 1. Check how many services exist
SELECT 'Total services:' as check_type, COUNT(*) as count FROM services;

-- 2. Check how many orders reference services
SELECT 'Total orders:' as check_type, COUNT(*) as count FROM orders;

-- 3. Check for orphaned orders (orders referencing non-existent services)
SELECT 'Orphaned orders:' as check_type, COUNT(*) as count 
FROM orders o 
LEFT JOIN services s ON o.service_id::text = s.id::text 
WHERE s.id IS NULL AND o.service_id IS NOT NULL;

-- 4. Check service ID data types
SELECT 
  'services.id type' as check_type,
  pg_typeof(id) as current_type,
  COUNT(*) as count
FROM services
GROUP BY pg_typeof(id);

-- 5. Check orders.service_id data types
SELECT 
  'orders.service_id type' as check_type,
  pg_typeof(service_id) as current_type,
  COUNT(*) as count
FROM orders
WHERE service_id IS NOT NULL
GROUP BY pg_typeof(service_id);

-- 6. Check for any existing temp columns (should not exist)
SELECT 
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name IN ('services', 'orders')
  AND column_name LIKE 'temp_%';

-- 7. Sample of current service IDs
SELECT 'Sample service IDs' as check_type, id, name 
FROM services 
LIMIT 5;

-- 8. Sample of current order service references
SELECT 'Sample order service refs' as check_type, o.id, o.service_id, s.name
FROM orders o
LEFT JOIN services s ON o.service_id::text = s.id::text
LIMIT 5;

-- All checks complete. If everything looks good, proceed with migration.
