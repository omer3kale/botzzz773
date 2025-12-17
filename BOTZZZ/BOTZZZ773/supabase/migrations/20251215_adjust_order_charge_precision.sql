-- Widen precision for order charges to preserve micro amounts
-- Also handles dependent view `link_management_dashboard` by dropping and recreating

BEGIN;

-- Ensure column exists and widen precision
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS original_charge NUMERIC(12,5);

-- Drop dependent view(s) that reference orders.charge to allow type change
DROP VIEW IF EXISTS link_management_dashboard;
DROP VIEW IF EXISTS v_user_spending_summary;
DROP VIEW IF EXISTS v_daily_revenue;

-- Alter column types
ALTER TABLE orders
  ALTER COLUMN charge TYPE NUMERIC(12,5) USING charge::NUMERIC(12,5);

ALTER TABLE orders
  ALTER COLUMN original_charge TYPE NUMERIC(12,5) USING original_charge::NUMERIC(12,5);

-- Recreate link_management_dashboard view (definition sourced from migration)
CREATE OR REPLACE VIEW link_management_dashboard AS
SELECT 
    lm.id,
    lm.url,
    lm.service_name,
    lm.total_orders as order_count,
    lm.total_quantity,
    lm.cumulative_quantity,
    lm.status,
    lm.conflict_reason,
    lm.last_order_at as last_order_date,
    lm.created_at,
    lm.updated_at,
    s.name as primary_service_name,
    COALESCE(
        (SELECT json_agg(
            json_build_object(
                'id', o.id,
                'service_id', o.service_id,
                'service_name', os.name,
                'provider_name', p.name,
                'quantity', o.quantity,
                'status', o.status,
                'provider_order_id', o.provider_order_id,
                'external_order_id', o.external_order_id,
                'order_number', o.order_number,
                'link', o.link,
                'charge', o.charge,
                'remains', o.remains,
                'start_count', o.start_count,
                'created_at', o.created_at,
                'updated_at', o.updated_at
            ) ORDER BY o.created_at DESC
        )
        FROM orders o
        LEFT JOIN services os ON o.service_id = os.id
        LEFT JOIN providers p ON os.provider_id = p.id
        WHERE o.link_id = lm.id),
        '[]'::json
    ) as orders
FROM link_management lm
LEFT JOIN services s ON lm.primary_service_id = s.id
ORDER BY lm.updated_at DESC;

-- Recreate other dependent views (sourced from existing migrations)

-- User spending summary
CREATE OR REPLACE VIEW v_user_spending_summary AS
SELECT 
  u.id,
  u.username,
  u.email,
  u.balance,
  u.spent,
  COUNT(DISTINCT o.id) AS total_orders,
  COUNT(DISTINCT CASE WHEN o.status = 'completed' THEN o.id END) AS completed_orders,
  COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled', 'refunded', 'failed') THEN o.charge ELSE 0 END), 0) AS total_spent_on_orders,
  COUNT(DISTINCT p.id) AS total_payments,
  COALESCE(SUM(CASE WHEN p.method != 'refund' AND p.amount > 0 AND p.status IN ('completed', 'success', 'succeeded') THEN p.amount ELSE 0 END), 0) AS total_deposited
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
LEFT JOIN payments p ON u.id = p.user_id
GROUP BY u.id, u.username, u.email, u.balance, u.spent;

-- Daily revenue view
CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT 
  DATE(created_at) AS date,
  COUNT(*) AS order_count,
  SUM(CASE WHEN status NOT IN ('cancelled', 'refunded', 'failed') THEN charge ELSE 0 END) AS gross_revenue,
  SUM(CASE WHEN status = 'completed' THEN charge ELSE 0 END) AS completed_revenue,
  SUM(CASE WHEN status IN ('refunded') THEN charge ELSE 0 END) AS refunded_amount
FROM orders
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

COMMIT;
