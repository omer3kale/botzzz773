--
-- Add unique constraint to services table for (provider_id, provider_service_id)
-- This enables ON CONFLICT handling when syncing services from providers
--
-- Run this in Supabase SQL Editor before running insert_test_services_and_curate.sql
--

-- Add the unique constraint
ALTER TABLE services 
ADD CONSTRAINT services_provider_service_unique 
UNIQUE (provider_id, provider_service_id);

-- Verify the constraint was created
SELECT 
    conname AS constraint_name,
    contype AS constraint_type,
    pg_get_constraintdef(oid) AS constraint_definition
FROM pg_constraint
WHERE conrelid = 'services'::regclass
  AND conname = 'services_provider_service_unique';
