-- Migration: add provider/retail pricing columns to services
ALTER TABLE services
    ADD COLUMN IF NOT EXISTS provider_rate DECIMAL(10, 4),
    ADD COLUMN IF NOT EXISTS retail_rate DECIMAL(10, 4),
    ADD COLUMN IF NOT EXISTS markup_percentage DECIMAL(5, 2);

-- Backfill existing data: copy current rate into retail_rate where missing
UPDATE services
SET retail_rate = COALESCE(retail_rate, rate);
