-- Fix: Set processed_at for all refunds that have it NULL
-- These refunds were already applied to user balances but processed_at was never set
-- due to a bug introduced in commit 5258656 (Jan 24, 2026)
-- Total affected: ~1000+ records, ~$348.73
-- This is a DATA-ONLY fix - no balance changes

-- Set processed_at = created_at for all unprocessed refunds
UPDATE refunds
SET processed_at = created_at
WHERE processed_at IS NULL;
