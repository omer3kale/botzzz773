-- Update refill_requests status constraint to include 'in progress'
-- This migration fixes the check constraint to allow 'in progress' status

BEGIN;

-- Drop the existing check constraint
ALTER TABLE refill_requests DROP CONSTRAINT IF EXISTS refill_requests_status_check;

-- Add the new check constraint with 'in progress' status
ALTER TABLE refill_requests 
ADD CONSTRAINT refill_requests_status_check 
CHECK (status IN ('pending', 'in progress', 'completed', 'rejected'));

COMMIT;
