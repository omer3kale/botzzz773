-- Increase user balance precision from 2 to 5 decimals
-- This allows micro-transactions (e.g., $0.00039) to be properly tracked
-- Date: 2025-12-15

BEGIN;

-- Step 1: Drop dependent view (only v_user_spending_summary)
DROP VIEW IF EXISTS v_user_spending_summary CASCADE;

-- Step 2: Change users.balance to NUMERIC(12,5) for 5-decimal precision
ALTER TABLE users 
  ALTER COLUMN balance TYPE NUMERIC(12,5);

-- Step 3: Change payments.amount to NUMERIC(12,5) for consistency
ALTER TABLE payments 
  ALTER COLUMN amount TYPE NUMERIC(12,5);

-- Step 4: Recreate v_user_spending_summary view
CREATE OR REPLACE VIEW v_user_spending_summary AS
SELECT 
  u.id AS user_id,
  u.username,
  u.email,
  u.balance,
  COUNT(DISTINCT o.id) AS total_orders,
  COALESCE(SUM(o.charge), 0) AS total_spent,
  COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.charge ELSE 0 END), 0) AS completed_spending,
  COALESCE(SUM(CASE WHEN o.status = 'pending' THEN o.charge ELSE 0 END), 0) AS pending_spending
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
GROUP BY u.id, u.username, u.email, u.balance;

-- Step 5: Add comments explaining the precision increase
COMMENT ON COLUMN users.balance IS 'User account balance in USD with 5-decimal precision for micro-transactions';
COMMENT ON COLUMN payments.amount IS 'Payment/refund amount in USD with 5-decimal precision';

COMMIT;
