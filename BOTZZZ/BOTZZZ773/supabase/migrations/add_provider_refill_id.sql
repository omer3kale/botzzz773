-- Add provider_refill_id column to refill_requests table
-- This stores the provider's refill ID, while our own refill_id starts from 15095

ALTER TABLE refill_requests 
ADD COLUMN IF NOT EXISTS provider_refill_id VARCHAR(100);

-- Create index for faster queries on provider_refill_id
CREATE INDEX IF NOT EXISTS idx_provider_refill_id ON refill_requests(provider_refill_id);
