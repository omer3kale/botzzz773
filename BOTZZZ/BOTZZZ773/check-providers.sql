-- Check configured providers
SELECT 
    id,
    name,
    api_url,
    status,
    created_at
FROM providers
WHERE status = 'active'
ORDER BY created_at DESC;

-- Check provider service count
SELECT 
    p.name as provider_name,
    COUNT(s.id) as total_services,
    SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) as active_services
FROM providers p
LEFT JOIN services s ON s.provider_id = p.id
GROUP BY p.id, p.name;
