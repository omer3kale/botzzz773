-- Fix Supabase linter warnings for:
-- 1. functions with mutable search_path
-- 2. overly permissive "service role" policies that are not scoped to service_role

BEGIN;

-- ---------------------------------------------------------------------------
-- Restrict known service-role policies so they only apply to service_role.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'user_logins'
    ) THEN
        DROP POLICY IF EXISTS "Service role can insert user_logins" ON public.user_logins;

        CREATE POLICY "Service role can insert user_logins"
            ON public.user_logins
            FOR INSERT
            TO service_role
            WITH CHECK (true);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'activity_logs'
    ) THEN
        DROP POLICY IF EXISTS "Service role full access activity_logs" ON public.activity_logs;

        CREATE POLICY "Service role full access activity_logs"
            ON public.activity_logs
            FOR ALL
            TO service_role
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Pin search_path for public functions flagged by the linter.
-- We use dynamic SQL so the migration survives signature changes.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
    fn RECORD;
BEGIN
    FOR fn IN
        SELECT
            n.nspname AS schema_name,
            p.proname AS function_name,
            pg_get_function_identity_arguments(p.oid) AS identity_args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname IN (
              'update_order_status_sync',
              'update_service_categories_updated_at',
              'generate_refill_id',
              'set_customer_status_on_insert',
              'generate_public_order_id',
              'settings_set_updated_at',
              'update_notification_timestamp',
              'prevent_customer_status_failed',
              'deduct_balance',
              'refund_balance',
              'get_failed_orders_summary',
              'get_provider_error_stats',
              'cleanup_expired_rate_limits',
              'record_api_rate_limit',
              'sync_refund_from_payment',
              'auto_refill_id',
              'cleanup_expired_otp_codes',
              'get_link_management_stats',
              'log_provider_error',
              'cleanup_expired_data_backups',
              'find_or_create_link',
              'resolve_user_id',
              'generate_order_number',
              'update_link_statistics',
              'get_user_refund_history',
              'set_order_number',
              'calculate_refund_rate',
              'normalize_pricing_rule_category',
              'mark_ticket_unread_on_admin_reply',
              'merge_link_orders',
              'normalize_category_slug',
              'normalize_service_category',
              'update_category_service_count',
              'update_updated_at_column',
              'recalculate_user_balance',
              'update_refill_requests_updated_at'
          )
    LOOP
        EXECUTE format(
            'ALTER FUNCTION %I.%I(%s) SET search_path = public, pg_catalog',
            fn.schema_name,
            fn.function_name,
            fn.identity_args
        );
    END LOOP;
END $$;

COMMIT;
