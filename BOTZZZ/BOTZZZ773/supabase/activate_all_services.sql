-- Activate All Services Migration
-- This updates all inactive services to active status so they appear on the customer-facing catalog

-- Update all inactive services to active
UPDATE services 
SET status = 'active' 
WHERE status = 'inactive' OR status IS NULL;

-- Verify the update
SELECT 
    status,
    COUNT(*) as count
FROM services
GROUP BY status
ORDER BY status;
