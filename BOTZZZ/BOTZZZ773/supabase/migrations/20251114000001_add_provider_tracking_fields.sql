-- Migration: Add missing provider tracking fields
-- Date: 2025-11-14
-- Purpose: Add columns for proper provider order tracking and status synchronization

BEGIN;

-- Ensure services table has all provider tracking columns
ALTER TABLE services
    ADD COLUMN IF NOT EXISTS public_id INTEGER,
    ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(100);

-- Add index for provider_order_id on services if it doesn't exist
CREATE INDEX IF NOT EXISTS idx_services_provider_order_id ON services(provider_order_id);

-- Add index for public_id on services if it doesn't exist  
CREATE INDEX IF NOT EXISTS idx_services_public_id ON services(public_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_services_public_id_unique ON services(public_id) WHERE public_id IS NOT NULL;

-- Ensure orders table has complete provider tracking
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS mode VARCHAR(20) DEFAULT 'Auto',
    ADD COLUMN IF NOT EXISTS last_status_sync TIMESTAMP WITH TIME ZONE;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_orders_mode ON orders(mode);
CREATE INDEX IF NOT EXISTS idx_orders_last_status_sync ON orders(last_status_sync);

-- Add trigger to automatically update last_status_sync when provider_status changes
CREATE OR REPLACE FUNCTION update_order_status_sync()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND OLD.provider_status IS DISTINCT FROM NEW.provider_status) THEN
        NEW.last_status_sync = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_order_status_sync ON orders;

CREATE TRIGGER trg_update_order_status_sync
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_order_status_sync();

COMMIT;
