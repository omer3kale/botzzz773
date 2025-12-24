-- Add alerted_at column to orders table for failed order alert tracking
-- This prevents duplicate alert notifications for the same order

ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS alerted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Add index for better query performance when filtering by alerted_at
CREATE INDEX IF NOT EXISTS idx_orders_alerted_at ON orders(alerted_at);
CREATE INDEX IF NOT EXISTS idx_orders_status_alerted ON orders(status, alerted_at) WHERE status IN ('failed', 'error');
