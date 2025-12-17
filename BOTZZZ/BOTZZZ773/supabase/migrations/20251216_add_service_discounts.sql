-- Add service_discounts JSONB column to users table
-- This stores per-service custom discount rates for each user
-- Format: { "service_id": discount_percentage, ... }
-- Example: { "9071": 10, "9080": 15 }

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS service_discounts JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN users.service_discounts IS 'Custom discount rates per service. Format: { service_id: discount_percentage }';
