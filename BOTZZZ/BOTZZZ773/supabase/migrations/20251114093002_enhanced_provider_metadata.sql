-- Migration: Enhanced provider tracking metadata
-- Date: 2025-11-14
-- Purpose: Capture additional provider/service/order telemetry for easier maintenance

BEGIN;

-- === Services Enhancements ===
ALTER TABLE services
    ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS average_time VARCHAR(100),
    ADD COLUMN IF NOT EXISTS refill_supported BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS cancel_supported BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS dripfeed_supported BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS subscription_supported BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS provider_metadata JSONB;

UPDATE services
SET currency = COALESCE(currency, 'USD');

CREATE INDEX IF NOT EXISTS idx_services_currency ON services(currency);
CREATE INDEX IF NOT EXISTS idx_services_refill_supported ON services(refill_supported);

-- === Providers Enhancements ===
ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS last_balance_sync TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS response_latency_ms INTEGER,
    ADD COLUMN IF NOT EXISTS health_status VARCHAR(20) DEFAULT 'unknown';

UPDATE providers
SET currency = COALESCE(currency, 'USD');

CREATE INDEX IF NOT EXISTS idx_providers_currency ON providers(currency);
CREATE INDEX IF NOT EXISTS idx_providers_health_status ON providers(health_status);

-- === Orders Enhancements ===
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS start_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS remains INTEGER,
    ADD COLUMN IF NOT EXISTS provider_cost DECIMAL(10, 4),
    ADD COLUMN IF NOT EXISTS provider_currency VARCHAR(10) DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS provider_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS provider_response JSONB,
    ADD COLUMN IF NOT EXISTS provider_notes TEXT,
    ADD COLUMN IF NOT EXISTS refill_id VARCHAR(50),
    ADD COLUMN IF NOT EXISTS refill_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS refill_requested_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS refill_completed_at TIMESTAMP WITH TIME ZONE;

UPDATE orders
SET provider_currency = COALESCE(provider_currency, 'USD');

CREATE INDEX IF NOT EXISTS idx_orders_provider_currency ON orders(provider_currency);
CREATE INDEX IF NOT EXISTS idx_orders_refill_status ON orders(refill_status);

COMMIT;
