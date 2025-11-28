-- Verify service_categories table and test SELECT queries

-- 1. Check all categories
SELECT * FROM service_categories ORDER BY display_order;

-- 2. Check count
SELECT COUNT(*) as total_categories FROM service_categories;

-- 3. Check only active categories
SELECT name, slug, icon, display_order 
FROM service_categories 
WHERE status = 'active' 
ORDER BY display_order;

-- 4. Test selecting specific category by slug
SELECT * FROM service_categories WHERE slug = 'instagram';

-- 5. Test selecting specific category by name
SELECT * FROM service_categories WHERE name = 'TikTok';

-- 6. Get categories for dropdown (what the API returns)
SELECT id, name, slug, description, icon, display_order, status
FROM service_categories
WHERE status = 'active'
ORDER BY display_order ASC, name ASC;

-- 7. Test if you can filter by multiple slugs (useful for forms)
SELECT * FROM service_categories 
WHERE slug IN ('instagram', 'youtube', 'tiktok')
ORDER BY display_order;

-- 8. Check the table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'service_categories'
ORDER BY ordinal_position;
