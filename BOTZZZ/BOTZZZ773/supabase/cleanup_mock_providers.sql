-- Cleanup Mock Providers
-- Run this in Supabase SQL Editor to remove seeded test data

-- First, check what providers exist
SELECT id, name, api_url, status, services_count, created_at 
FROM providers 
ORDER BY created_at;

-- Check your current provider (g1618)
SELECT * FROM providers WHERE id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300';

-- Uncomment below to delete ONLY mock providers (BE CAREFUL!)
-- This will also cascade delete all associated services due to ON DELETE CASCADE
-- This will KEEP your g1618.com provider and only remove test data

-- DELETE FROM providers 
-- WHERE (name LIKE 'SMM Provider%' 
--    OR name = 'Test Provider'
--    OR api_url LIKE '%example.com%')
-- AND id != 'e1189c5b-079e-4a4f-9279-8a2f6e384300';  -- Keep g1618 provider

-- After cleanup, verify:
-- SELECT id, name, api_url, status FROM providers;

-- Optional: Update g1618 provider status if needed
-- UPDATE providers 
-- SET status = 'active', 
--     updated_at = NOW()
-- WHERE id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300';
