-- Add provider_response column to refill_requests table
-- This stores the full JSON response from the provider for debugging

ALTER TABLE refill_requests
ADD COLUMN IF NOT EXISTS provider_response JSONB;

-- Create index for faster queries on provider_response
CREATE INDEX IF NOT EXISTS idx_provider_response ON refill_requests USING GIN (provider_response);
