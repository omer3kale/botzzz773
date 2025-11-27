-- Optional: Refund Analytics Views & Functions
-- This migration adds convenience views for refund reporting
-- NOT REQUIRED - only run if you need advanced analytics

-- View: Refund summary by user
CREATE OR REPLACE VIEW refund_summary_by_user AS
SELECT 
    u.id AS user_id,
    u.email,
    u.username,
    COUNT(r.id) AS total_refunds,
    COALESCE(SUM(r.amount), 0) AS total_refunded,
    MIN(r.created_at) AS first_refund_date,
    MAX(r.created_at) AS last_refund_date
FROM users u
LEFT JOIN refunds r ON r.user_id = u.id
WHERE r.status IN ('refunded', 'completed', 'success', 'succeeded')
GROUP BY u.id, u.email, u.username;

-- View: Refund summary by order
CREATE OR REPLACE VIEW refund_summary_by_order AS
SELECT 
    o.id AS order_id,
    o.order_number,
    o.status AS order_status,
    COUNT(r.id) AS refund_count,
    COALESCE(SUM(r.amount), 0) AS total_refunded,
    MAX(r.created_at) AS last_refund_date,
    ARRAY_AGG(r.reason) FILTER (WHERE r.reason IS NOT NULL) AS refund_reasons
FROM orders o
LEFT JOIN refunds r ON r.order_id = o.id
WHERE r.id IS NOT NULL
GROUP BY o.id, o.order_number, o.status;

-- View: Daily refund statistics
CREATE OR REPLACE VIEW daily_refund_stats AS
SELECT 
    DATE(r.created_at) AS refund_date,
    COUNT(r.id) AS refund_count,
    COALESCE(SUM(r.amount), 0) AS total_amount,
    COUNT(DISTINCT r.user_id) AS unique_users,
    COUNT(DISTINCT r.order_id) AS unique_orders,
    ARRAY_AGG(DISTINCT r.reason) FILTER (WHERE r.reason IS NOT NULL) AS reasons
FROM refunds r
WHERE r.status IN ('refunded', 'completed', 'success', 'succeeded')
GROUP BY DATE(r.created_at)
ORDER BY refund_date DESC;

-- Function: Get user refund history
CREATE OR REPLACE FUNCTION get_user_refund_history(
    target_user_id UUID,
    limit_count INTEGER DEFAULT 50
)
RETURNS TABLE (
    refund_id UUID,
    refund_code TEXT,
    amount DECIMAL(10, 2),
    order_number TEXT,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE,
    status TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.refund_code,
        r.amount,
        o.order_number,
        r.reason,
        r.created_at,
        r.status
    FROM refunds r
    LEFT JOIN orders o ON o.id = r.order_id
    WHERE r.user_id = target_user_id
    ORDER BY r.created_at DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Function: Calculate refund rate (useful for fraud detection)
CREATE OR REPLACE FUNCTION calculate_refund_rate(
    target_user_id UUID DEFAULT NULL,
    days_back INTEGER DEFAULT 30
)
RETURNS TABLE (
    user_id UUID,
    total_orders INTEGER,
    total_refunds INTEGER,
    refund_rate DECIMAL(5, 2),
    total_spent DECIMAL(10, 2),
    total_refunded DECIMAL(10, 2)
) AS $$
BEGIN
    RETURN QUERY
    WITH user_stats AS (
        SELECT 
            o.user_id,
            COUNT(DISTINCT o.id) AS order_count,
            COALESCE(SUM(o.charge), 0) AS spent,
            COUNT(DISTINCT r.id) AS refund_count,
            COALESCE(SUM(r.amount), 0) AS refunded
        FROM orders o
        LEFT JOIN refunds r ON r.order_id = o.id
        WHERE 
            o.created_at >= NOW() - (days_back || ' days')::INTERVAL
            AND (target_user_id IS NULL OR o.user_id = target_user_id)
        GROUP BY o.user_id
    )
    SELECT 
        us.user_id,
        us.order_count::INTEGER,
        us.refund_count::INTEGER,
        CASE 
            WHEN us.order_count > 0 
            THEN ROUND((us.refund_count::DECIMAL / us.order_count::DECIMAL) * 100, 2)
            ELSE 0
        END AS refund_rate,
        us.spent,
        us.refunded
    FROM user_stats us
    ORDER BY refund_rate DESC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON VIEW refund_summary_by_user IS 'Aggregates refund data per user for analytics';
COMMENT ON VIEW refund_summary_by_order IS 'Shows all refunds associated with each order';
COMMENT ON VIEW daily_refund_stats IS 'Daily refund metrics for trend analysis';
COMMENT ON FUNCTION get_user_refund_history IS 'Retrieves paginated refund history for a user';
COMMENT ON FUNCTION calculate_refund_rate IS 'Calculates refund rate percentage for fraud detection';
