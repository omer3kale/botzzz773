-- Add unique constraint to order_number to prevent duplicates
-- This ensures no two orders can have the same order_number

ALTER TABLE orders 
ADD CONSTRAINT orders_order_number_unique UNIQUE (order_number);

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
