-- Add richer failure metadata for silent failure system

-- Orders table gets source/code/context columns for downstream UI
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS failure_source TEXT,
    ADD COLUMN IF NOT EXISTS failure_code TEXT,
    ADD COLUMN IF NOT EXISTS failure_context JSONB DEFAULT '{}'::jsonb;

-- Provider errors log expands to capture more than provider responses
ALTER TABLE provider_errors
    ADD COLUMN IF NOT EXISTS failure_source TEXT DEFAULT 'provider',
    ADD COLUMN IF NOT EXISTS failure_code TEXT,
    ADD COLUMN IF NOT EXISTS failure_context JSONB DEFAULT '{}'::jsonb;

UPDATE provider_errors
SET failure_source = 'provider'
WHERE failure_source IS NULL;

-- Backfill historical failure metadata on orders
WITH legacy_failures AS (
    SELECT id,
           provider_error,
           CASE
               WHEN provider_error ILIKE '%insufficient%' THEN 'provider_insufficient_balance'
               WHEN provider_error ILIKE '%invalid link%' THEN 'provider_invalid_link'
               WHEN provider_error ILIKE '%quantity%' THEN 'provider_quantity_rejected'
               WHEN provider_error ILIKE '%suspend%' THEN 'system_provider_suspended'
               ELSE 'provider_failure'
           END AS derived_code,
           CASE
               WHEN provider_error IS NULL OR provider_error = '' THEN 'system'
               ELSE 'provider'
           END AS derived_source
    FROM orders
    WHERE status IN ('failed', 'error')
)
UPDATE orders o
SET failure_source = COALESCE(o.failure_source, lf.derived_source),
    failure_code = COALESCE(o.failure_code, lf.derived_code),
    failure_context = jsonb_strip_nulls(
        COALESCE(o.failure_context, '{}'::jsonb)
        || jsonb_build_object(
            'migration', '20251124_add_failure_metadata',
            'provider_error_snapshot', NULLIF(o.provider_error, '')
        )
    )
FROM legacy_failures lf
WHERE o.id = lf.id
  AND (o.failure_source IS NULL OR o.failure_code IS NULL OR o.failure_context = '{}'::jsonb);

-- Backfill provider_errors with derived codes/context for legacy rows
WITH legacy_provider_logs AS (
    SELECT id,
           order_id,
           error_message,
           CASE
               WHEN error_message ILIKE '%insufficient%' THEN 'provider_insufficient_balance'
               WHEN error_message ILIKE '%invalid link%' THEN 'provider_invalid_link'
               WHEN error_message ILIKE '%quantity%' THEN 'provider_quantity_rejected'
               WHEN error_message ILIKE '%suspend%' THEN 'system_provider_suspended'
               ELSE 'provider_failure'
           END AS derived_code
    FROM provider_errors
    WHERE failure_code IS NULL
)
UPDATE provider_errors pe
SET failure_source = COALESCE(pe.failure_source, 'provider'),
    failure_code = COALESCE(pe.failure_code, lpl.derived_code),
    failure_context = jsonb_strip_nulls(
        COALESCE(pe.failure_context, '{}'::jsonb)
        || jsonb_build_object(
            'migration', '20251124_add_failure_metadata',
            'error_message_snapshot', NULLIF(pe.error_message, '')
        )
    )
FROM legacy_provider_logs lpl
WHERE pe.id = lpl.id;

CREATE INDEX IF NOT EXISTS idx_provider_errors_failure_source
    ON provider_errors(failure_source);

-- Recreate trigger function with new metadata
CREATE OR REPLACE FUNCTION log_provider_error()
RETURNS TRIGGER AS $$
DECLARE
    v_provider_id UUID;
    v_should_log BOOLEAN := FALSE;
    v_failure_source TEXT := COALESCE(NEW.failure_source, 'provider');
    v_failure_code TEXT := NEW.failure_code;
    v_failure_context JSONB := COALESCE(NEW.failure_context, '{}'::jsonb);
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

    -- If status is failed/error and we have a failure message, upsert into log
    IF NEW.status IN ('failed', 'error')
       AND NEW.provider_error IS NOT NULL
       AND NEW.provider_error <> '' THEN

        IF TG_OP = 'INSERT' THEN
            v_should_log := TRUE;
        ELSIF OLD.status NOT IN ('failed', 'error') OR OLD.provider_error IS DISTINCT FROM NEW.provider_error THEN
            v_should_log := TRUE;
        END IF;

        IF v_should_log THEN
            INSERT INTO provider_errors (
                order_id,
                provider_id,
                error_message,
                failure_source,
                failure_code,
                failure_context
            )
            VALUES (
                NEW.id,
                v_provider_id,
                NEW.provider_error,
                v_failure_source,
                v_failure_code,
                v_failure_context
            )
            ON CONFLICT (order_id) DO UPDATE
            SET retry_count = provider_errors.retry_count + 1,
                last_retry_at = NOW(),
                error_message = EXCLUDED.error_message,
                provider_id = COALESCE(EXCLUDED.provider_id, provider_errors.provider_id),
                failure_source = COALESCE(EXCLUDED.failure_source, provider_errors.failure_source),
                failure_code = COALESCE(EXCLUDED.failure_code, provider_errors.failure_code),
                failure_context = COALESCE(EXCLUDED.failure_context, provider_errors.failure_context),
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

COMMENT ON COLUMN orders.failure_source IS 'Categorizes why the order failed (provider, system, user, etc.)';
COMMENT ON COLUMN orders.failure_code IS 'Short code identifying the failure reason';
COMMENT ON COLUMN orders.failure_context IS 'JSON payload with structured metadata about the failure';
COMMENT ON COLUMN provider_errors.failure_source IS 'Categorizes why the order failed when the log entry was recorded';
COMMENT ON COLUMN provider_errors.failure_code IS 'Short code identifying the failure reason for analytics';
COMMENT ON COLUMN provider_errors.failure_context IS 'Structured metadata for failure analysis';

-- Verification queries for operators to confirm migration results
SELECT failure_source, failure_code, COUNT(*) AS total
FROM orders
WHERE status IN ('failed', 'error')
GROUP BY failure_source, failure_code
ORDER BY total DESC;

SELECT failure_source, failure_code, COUNT(*) AS total
FROM provider_errors
GROUP BY failure_source, failure_code
ORDER BY total DESC;
