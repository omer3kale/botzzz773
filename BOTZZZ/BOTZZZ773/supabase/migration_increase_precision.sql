-- Migration: Increase precision for numeric fields that may exceed 999.99
-- Service prices from providers can be very high (100,000+ for bulk services)

-- Step 1: Drop views that depend on services table
DROP VIEW IF EXISTS v_active_services_summary CASCADE;
DROP VIEW IF EXISTS v_user_spending_summary CASCADE;
DROP VIEW IF EXISTS v_daily_revenue CASCADE;

-- Step 2: Alter table columns
-- Increase markup_percentage precision to allow values > 999%
-- (though in practice markup should be 0-100%, this prevents overflow)
ALTER TABLE services 
ALTER COLUMN markup_percentage TYPE DECIMAL(8, 2);

-- Verify all rate columns have sufficient precision
-- These should already be DECIMAL(10, 4) but let's ensure consistency
ALTER TABLE services 
ALTER COLUMN rate TYPE DECIMAL(12, 4);

ALTER TABLE services 
ALTER COLUMN provider_rate TYPE DECIMAL(12, 4);

ALTER TABLE services 
ALTER COLUMN retail_rate TYPE DECIMAL(12, 4);

-- Update provider cost in orders table as well
ALTER TABLE orders 
ALTER COLUMN provider_cost TYPE DECIMAL(12, 4);

-- Increase provider markup to allow higher percentages if needed
ALTER TABLE providers 
ALTER COLUMN markup TYPE DECIMAL(8, 2);

-- Add missing currency_conversion_info column to price_change_logs
ALTER TABLE price_change_logs 
ADD COLUMN IF NOT EXISTS currency_conversion_info JSONB;

COMMENT ON COLUMN price_change_logs.currency_conversion_info IS 'Currency conversion details: {converted: boolean, originalCurrency: string, originalAmount: number, usdAmount: number}';

-- Increase precision in price_change_logs to match services table
ALTER TABLE price_change_logs 
ALTER COLUMN old_provider_rate TYPE DECIMAL(12, 4);

ALTER TABLE price_change_logs 
ALTER COLUMN new_provider_rate TYPE DECIMAL(12, 4);

ALTER TABLE price_change_logs 
ALTER COLUMN old_retail_rate TYPE DECIMAL(12, 4);

ALTER TABLE price_change_logs 
ALTER COLUMN new_retail_rate TYPE DECIMAL(12, 4);

ALTER TABLE price_change_logs 
ALTER COLUMN markup_used TYPE DECIMAL(8, 2);

-- Step 3: Recreate views
CREATE OR REPLACE VIEW v_active_services_summary AS
SELECT 
    s.id,
    s.public_id,
    s.name,
    s.category,
    sc.name AS category_name,
    sc.icon AS category_icon,
    s.rate,
    s.min_quantity,
    s.max_quantity,
    s.admin_approved,
    s.customer_portal_enabled,
    s.customer_portal_slot,
    p.name AS provider_name,
    s.status
FROM services s
LEFT JOIN service_categories sc ON normalize_category_slug(s.category) = sc.slug
LEFT JOIN providers p ON s.provider_id = p.id
WHERE s.status = 'active';

CREATE OR REPLACE VIEW v_user_spending_summary AS
SELECT 
    u.id,
    u.email,
    u.username,
    u.balance,
    u.spent,
    COUNT(DISTINCT o.id) AS total_orders,
    COALESCE(SUM(o.charge), 0) AS total_spent_orders,
    u.status,
    u.created_at
FROM users u
LEFT JOIN orders o ON u.id = o.user_id AND o.status NOT IN ('cancelled', 'refunded')
GROUP BY u.id, u.email, u.username, u.balance, u.spent, u.status, u.created_at;

CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT 
    DATE(o.created_at) AS order_date,
    COUNT(o.id) AS total_orders,
    SUM(o.charge) AS total_revenue,
    SUM(COALESCE(o.provider_cost, 0)) AS total_cost,
    SUM(o.charge) - SUM(COALESCE(o.provider_cost, 0)) AS total_profit
FROM orders o
WHERE o.status NOT IN ('cancelled', 'refunded')
GROUP BY DATE(o.created_at)
ORDER BY order_date DESC;

-- Note: This migration allows:
-- - markup_percentage: up to 999,999.99%
-- - rate fields: up to 99,999,999.9999 USD
-- - This should be more than sufficient for any SMM panel service
