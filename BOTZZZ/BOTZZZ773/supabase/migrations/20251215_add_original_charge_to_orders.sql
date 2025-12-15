-- Add original_charge to orders to preserve initial customer charge
-- and backfill it for existing records

BEGIN;

ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS original_charge numeric(10,2);

-- Backfill from current charge where original_charge is null
UPDATE public.orders
SET original_charge = charge
WHERE original_charge IS NULL;

COMMIT;
