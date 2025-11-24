-- Migration: Add Silent Failure Support for Orders
-- Date: 2025-11-24
-- Description: Add customer_status and provider_error columns to enable silent failure handling

-- Add customer_status column (what customers see - always positive)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS customer_status VARCHAR(50) DEFAULT 'pending';

-- Add provider_error column (detailed error for admin review)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS provider_error TEXT;

-- Add comments for clarity
COMMENT ON COLUMN orders.customer_status IS 'Status displayed to customers (always shows positive states like processing, completed)';
COMMENT ON COLUMN orders.status IS 'Actual internal order status (includes failed, error, cancelled for admin visibility)';
COMMENT ON COLUMN orders.provider_error IS 'Detailed provider error message saved when order submission fails';

-- Update existing failed/error orders to show 'processing' to customers
UPDATE orders 
SET customer_status = CASE 
    WHEN status IN ('failed', 'error') THEN 'processing'
    WHEN status = 'cancelled' THEN 'cancelled'
    WHEN status = 'completed' THEN 'completed'
    WHEN status = 'partial' THEN 'partial'
    WHEN status IN ('pending', 'processing', 'in_progress') THEN status
    ELSE 'processing'
END
WHERE customer_status IS NULL OR customer_status = '';

-- Ensure all orders have a customer_status
UPDATE orders 
SET customer_status = 'processing'
WHERE customer_status IS NULL;

-- Create index for fast filtering of failed orders in admin panel
CREATE INDEX IF NOT EXISTS idx_orders_status_failed 
ON orders(status) 
WHERE status IN ('failed', 'error');

-- Create index for customer queries (using customer_status)
CREATE INDEX IF NOT EXISTS idx_orders_customer_status 
ON orders(user_id, customer_status);

-- Add constraint to ensure customer_status is always set
ALTER TABLE orders 
ADD CONSTRAINT check_customer_status_not_null 
CHECK (customer_status IS NOT NULL AND customer_status <> '');
