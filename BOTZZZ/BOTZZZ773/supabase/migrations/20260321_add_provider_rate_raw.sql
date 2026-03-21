-- Add raw provider rate and currency columns to services table
-- These store the original price BEFORE USD conversion
-- Used for price change detection to avoid false positives from FX fluctuations

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS provider_rate_raw numeric(12,6),
  ADD COLUMN IF NOT EXISTS provider_currency varchar(10) DEFAULT 'USD';

-- Backfill: for existing rows, copy provider_rate as raw and assume USD
-- (will be corrected on next sync for non-USD providers)
UPDATE public.services
  SET provider_rate_raw = provider_rate,
      provider_currency = 'USD'
  WHERE provider_rate_raw IS NULL AND provider_rate IS NOT NULL;

-- Index for fast lookups on currency
CREATE INDEX IF NOT EXISTS idx_services_provider_currency ON public.services(provider_currency);
