-- Migration: Customer portal service visibility controls
-- Date: 2025-11-14
-- Purpose: Allow admins to curate a small set of storefront services

BEGIN;

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS customer_portal_enabled BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS customer_portal_slot SMALLINT,
    ADD COLUMN IF NOT EXISTS customer_portal_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_services_customer_portal_enabled
    ON services(customer_portal_enabled, customer_portal_slot);

COMMIT;
