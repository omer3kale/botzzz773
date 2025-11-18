-- Migration: Add order_reference column to orders and backfill values
-- Run in Supabase SQL Editor or via your migration runner

BEGIN;

-- Add the column if not already present
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_reference VARCHAR(50);

-- Add an index to support lookups
CREATE INDEX IF NOT EXISTS idx_orders_order_reference ON orders(order_reference);

-- Backfill: prefer existing order_number, then public_id
UPDATE orders
SET order_reference = order_number
WHERE (order_reference IS NULL OR trim(order_reference) = '')
  AND order_number IS NOT NULL;

UPDATE orders
SET order_reference = public_id::text
WHERE (order_reference IS NULL OR trim(order_reference) = '')
  AND public_id IS NOT NULL;

COMMIT;

-- Notes:
-- - This migration is idempotent: it uses IF NOT EXISTS and guarded UPDATEs.
-- - If you prefer a different backfill strategy (prefixes, sequential IDs), modify the UPDATE logic.
