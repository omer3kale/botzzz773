-- Add refill_requested_at column to refill_requests table
ALTER TABLE refill_requests 
ADD COLUMN IF NOT EXISTS refill_requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add refill_requested_at column to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS refill_requested_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_refill_requests_requested_at ON refill_requests(refill_requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_refill_requested_at ON orders(refill_requested_at DESC);
