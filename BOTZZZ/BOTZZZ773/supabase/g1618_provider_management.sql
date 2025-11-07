-- g1618 Provider Management
-- Scripts to manage your g1618.com SMM panel provider

-- 1. Check provider details
SELECT 
    id,
    name,
    api_url,
    status,
    markup,
    balance,
    services_count,
    last_sync,
    created_at
FROM providers 
WHERE id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300';

-- 2. Check services linked to g1618 provider
SELECT 
    id,
    name,
    category,
    rate,
    min_quantity,
    max_quantity,
    status,
    provider_service_id
FROM services 
WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
ORDER BY category, name;

-- 3. Count services by category for g1618
SELECT 
    category,
    COUNT(*) as service_count,
    AVG(rate) as avg_rate
FROM services 
WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
GROUP BY category
ORDER BY service_count DESC;

-- 4. Update provider status to active (if needed)
-- UPDATE providers 
-- SET status = 'active',
--     updated_at = NOW()
-- WHERE id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300';

-- 5. Update provider markup (if needed)
-- UPDATE providers 
-- SET markup = 20.00,  -- Change to your desired markup percentage
--     updated_at = NOW()
-- WHERE id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300';

-- 6. Activate all g1618 services (if needed)
-- UPDATE services 
-- SET status = 'active',
--     updated_at = NOW()
-- WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
--   AND status = 'inactive';

-- 7. Check for duplicate services (same provider_service_id)
SELECT 
    provider_service_id,
    COUNT(*) as duplicate_count,
    STRING_AGG(name, ' | ') as service_names
FROM services 
WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
  AND provider_service_id IS NOT NULL
GROUP BY provider_service_id
HAVING COUNT(*) > 1;

-- 8. Delete inactive g1618 services (use carefully!)
-- DELETE FROM services 
-- WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
--   AND status = 'inactive';

-- 9. Reset services_count for g1618 provider
-- UPDATE providers 
-- SET services_count = (
--     SELECT COUNT(*) 
--     FROM services 
--     WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
-- ),
-- updated_at = NOW()
-- WHERE id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300';
