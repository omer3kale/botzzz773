-- Silent Failure System - Additional Constraints and Triggers
-- Ensures data integrity and automatic customer_status management

-- ============================================
-- CONSTRAINTS
-- ============================================

-- Make sure the silent-failure columns exist (no-op if created already)
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_status VARCHAR(50) DEFAULT 'pending';

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS provider_error TEXT;

-- Normalize legacy rows so forthcoming constraints succeed
UPDATE orders
SET customer_status = 'pending'
WHERE customer_status IS NULL OR customer_status = '';

UPDATE orders
SET customer_status = 'processing'
WHERE status IN ('failed', 'error')
    AND customer_status <> 'processing';

-- Add check constraint for customer_status values
ALTER TABLE orders 
ADD CONSTRAINT check_customer_status_valid 
CHECK (customer_status IN ('pending', 'processing', 'completed', 'partial', 'canceled'));

-- Add check constraint for status values
ALTER TABLE orders 
ADD CONSTRAINT check_status_valid 
CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'canceled', 'failed', 'error', 'awaiting'));

-- Ensure provider_error is only set when status is failed/error
-- (This is a soft constraint - we'll enforce via trigger)

-- ============================================
-- TRIGGER: Auto-set customer_status on insert
-- ============================================

CREATE OR REPLACE FUNCTION set_customer_status_on_insert()
RETURNS TRIGGER AS $$
BEGIN
    -- If status is failed/error we always mask as processing for customers
    IF NEW.status IN ('failed', 'error') THEN
        NEW.customer_status := 'processing';
    ELSIF NEW.customer_status IS NULL OR NEW.customer_status = '' THEN
        -- All other statuses fall back to pending when not provided
        NEW.customer_status := 'pending';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_set_customer_status_on_insert ON orders;
CREATE TRIGGER trigger_set_customer_status_on_insert
    BEFORE INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION set_customer_status_on_insert();

-- ============================================
-- TRIGGER: Prevent customer_status from showing 'failed'
-- ============================================

CREATE OR REPLACE FUNCTION prevent_customer_status_failed()
RETURNS TRIGGER AS $$
BEGIN
    -- If someone tries to set customer_status to 'failed' or 'error', override to 'processing'
    IF NEW.customer_status = 'failed' OR NEW.customer_status = 'error' THEN
        NEW.customer_status := 'processing';
        RAISE NOTICE 'customer_status cannot be "failed" or "error" - automatically changed to "processing"';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for both INSERT and UPDATE
DROP TRIGGER IF EXISTS trigger_prevent_customer_status_failed ON orders;
CREATE TRIGGER trigger_prevent_customer_status_failed
    BEFORE INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION prevent_customer_status_failed();

-- ============================================
-- TRIGGER: Auto-log provider errors to separate table
-- ============================================

-- Create provider_errors log table for analytics
CREATE TABLE IF NOT EXISTS provider_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
    error_message TEXT NOT NULL,
    error_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMPTZ,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    notes TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_errors_order_id ON provider_errors(order_id);
CREATE INDEX IF NOT EXISTS idx_provider_errors_provider_id ON provider_errors(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_errors_unresolved ON provider_errors(resolved) WHERE resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_provider_errors_timestamp ON provider_errors(error_timestamp DESC);

-- Trigger function to log provider errors
CREATE OR REPLACE FUNCTION log_provider_error()
RETURNS TRIGGER AS $$
DECLARE
    v_provider_id UUID;
    v_should_log BOOLEAN := FALSE;
BEGIN
    -- Determine provider_id from related service when possible
    IF NEW.service_id IS NOT NULL THEN
        SELECT s.provider_id
        INTO v_provider_id
        FROM services s
        WHERE s.id = NEW.service_id
        LIMIT 1;
    ELSE
        v_provider_id := NULL;
    END IF;

    -- If status is failed/error and we have a provider error message, upsert into log
    IF NEW.status IN ('failed', 'error') 
       AND NEW.provider_error IS NOT NULL 
       AND NEW.provider_error <> '' THEN

        IF TG_OP = 'INSERT' THEN
            v_should_log := TRUE;
        ELSIF OLD.status NOT IN ('failed', 'error') OR OLD.provider_error IS DISTINCT FROM NEW.provider_error THEN
            v_should_log := TRUE;
        END IF;

        IF v_should_log THEN
            INSERT INTO provider_errors (order_id, provider_id, error_message)
            VALUES (NEW.id, v_provider_id, NEW.provider_error)
            ON CONFLICT (order_id) DO UPDATE
            SET retry_count = provider_errors.retry_count + 1,
                last_retry_at = NOW(),
                error_message = EXCLUDED.error_message,
                provider_id = COALESCE(EXCLUDED.provider_id, provider_errors.provider_id),
                resolved = FALSE,
                resolved_at = NULL;
        END IF;
    END IF;

    -- If we transitioned out of failed/error, mark current log as resolved
    IF TG_OP <> 'INSERT'
       AND OLD.status IN ('failed', 'error')
       AND NEW.status NOT IN ('failed', 'error') THEN
        UPDATE provider_errors
        SET resolved = TRUE,
            resolved_at = NOW()
        WHERE order_id = NEW.id 
          AND resolved = FALSE;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_log_provider_error ON orders;
CREATE TRIGGER trigger_log_provider_error
    AFTER INSERT OR UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION log_provider_error();

-- ============================================
-- FUNCTION: Get failed orders summary
-- ============================================

CREATE OR REPLACE FUNCTION get_failed_orders_summary()
RETURNS TABLE (
    total_failed BIGINT,
    total_affected_revenue NUMERIC,
    unique_providers BIGINT,
    avg_retry_count NUMERIC,
    oldest_unresolved TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT pe.order_id)::BIGINT as total_failed,
        COALESCE(SUM(o.charge), 0)::NUMERIC as total_affected_revenue,
        COUNT(DISTINCT pe.provider_id)::BIGINT as unique_providers,
        COALESCE(AVG(pe.retry_count), 0)::NUMERIC as avg_retry_count,
        MIN(pe.error_timestamp) as oldest_unresolved
    FROM provider_errors pe
    LEFT JOIN orders o ON pe.order_id = o.id
    WHERE pe.resolved = FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- FUNCTION: Get provider error stats
-- ============================================

CREATE OR REPLACE FUNCTION get_provider_error_stats(time_range INTERVAL DEFAULT '7 days')
RETURNS TABLE (
    provider_name TEXT,
    error_count BIGINT,
    unique_errors BIGINT,
    avg_retry_count NUMERIC,
    last_error TIMESTAMPTZ,
    total_affected_revenue NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.name::TEXT as provider_name,
        COUNT(*)::BIGINT as error_count,
        COUNT(DISTINCT pe.error_message)::BIGINT as unique_errors,
        COALESCE(AVG(pe.retry_count), 0)::NUMERIC as avg_retry_count,
        MAX(pe.error_timestamp) as last_error,
        COALESCE(SUM(o.charge), 0)::NUMERIC as total_affected_revenue
    FROM provider_errors pe
    JOIN providers p ON pe.provider_id = p.id
    LEFT JOIN orders o ON pe.order_id = o.id
    WHERE pe.error_timestamp >= NOW() - time_range
    GROUP BY p.id, p.name
    ORDER BY error_count DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================

COMMENT ON COLUMN orders.customer_status IS 'Customer-facing status - never shows "failed" or "error"';
COMMENT ON COLUMN orders.provider_error IS 'Internal provider error message - only visible to admins';
COMMENT ON TABLE provider_errors IS 'Audit log of all provider errors for analytics and monitoring';

COMMENT ON FUNCTION set_customer_status_on_insert() IS 'Ensures customer_status is always set to a safe default value';
COMMENT ON FUNCTION prevent_customer_status_failed() IS 'Prevents customer_status from ever being set to "failed" or "error"';
COMMENT ON FUNCTION log_provider_error() IS 'Automatically logs provider errors to provider_errors table for tracking';
COMMENT ON FUNCTION get_failed_orders_summary() IS 'Returns summary statistics of unresolved failed orders';
COMMENT ON FUNCTION get_provider_error_stats(INTERVAL) IS 'Returns error statistics grouped by provider for monitoring';

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

-- Allow authenticated users to read their own orders (but not see internal errors)
-- This is handled by RLS policies in the main migration

-- Allow service role to access provider_errors table
ALTER TABLE provider_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can access all provider errors"
    ON provider_errors
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Run these after migration to verify:

-- 1. Check constraints
-- SELECT conname, pg_get_constraintdef(oid) 
-- FROM pg_constraint 
-- WHERE conrelid = 'orders'::regclass 
-- AND conname LIKE '%status%';

-- 2. Check triggers
-- SELECT tgname, tgtype, tgenabled 
-- FROM pg_trigger 
-- WHERE tgrelid = 'orders'::regclass;

-- 3. Test failed orders summary
-- SELECT * FROM get_failed_orders_summary();

-- 4. Test provider error stats
-- SELECT * FROM get_provider_error_stats('7 days');

-- Migration complete!
