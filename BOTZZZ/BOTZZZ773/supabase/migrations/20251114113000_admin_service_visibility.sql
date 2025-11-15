-- Migration: Explicit admin approval controls for customer-facing services
-- Date: 2025-11-14
-- Purpose: Ensure only manually-approved services surface to customers across the panel

BEGIN;

ALTER TABLE services
    ADD COLUMN IF NOT EXISTS admin_approved BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS admin_approved_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS admin_visibility_notes TEXT;

UPDATE services
SET admin_approved = true,
    admin_approved_at = COALESCE(admin_approved_at, NOW())
WHERE status = 'active'
  AND (admin_approved IS DISTINCT FROM true OR admin_approved IS NULL);

CREATE INDEX IF NOT EXISTS idx_services_admin_approved ON services(admin_approved);

COMMIT;
