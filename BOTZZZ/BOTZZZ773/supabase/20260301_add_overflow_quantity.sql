-- Add overflow_quantity column to orders table
-- Stores the actual quantity sent to provider (includes overflow)
-- Example: customer qty=50, overflow=40%, overflow_quantity=70

ALTER TABLE orders ADD COLUMN IF NOT EXISTS overflow_quantity INT;

-- Add comment for documentation
COMMENT ON COLUMN orders.overflow_quantity IS 'Actual quantity sent to provider including overflow. NULL if no overflow applied.';
