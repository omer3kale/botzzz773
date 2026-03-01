-- Add overflow_percent column to services table
-- Overflow: extra quantity sent to provider (e.g., 40 = send 140% of ordered quantity)
-- Customer pays for original quantity, provider receives quantity + overflow%
-- Default 0 means no overflow

ALTER TABLE services ADD COLUMN IF NOT EXISTS overflow_percent NUMERIC DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN services.overflow_percent IS 'Percentage of extra quantity to send to provider. E.g., 40 means 100 ordered → 140 sent to provider. Customer pays for 100.';
