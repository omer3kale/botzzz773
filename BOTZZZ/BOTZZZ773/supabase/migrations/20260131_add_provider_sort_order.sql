-- Migration: Add provider sort order column
-- Date: 2025-01-31
-- Purpose: Enable custom provider ordering via drag-and-drop UI

BEGIN;

-- Add sort_order column to providers table
ALTER TABLE providers
    ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Create index on sort_order for efficient sorting
CREATE INDEX IF NOT EXISTS idx_providers_sort_order ON providers(sort_order);

-- Update existing providers with sequential sort order based on creation order
UPDATE providers
SET sort_order = (
    SELECT COUNT(*) FROM providers p2 
    WHERE p2.created_at <= providers.created_at
) - 1
WHERE sort_order = 0;

COMMIT;
