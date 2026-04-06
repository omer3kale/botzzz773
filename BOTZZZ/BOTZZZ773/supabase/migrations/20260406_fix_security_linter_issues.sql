-- Fix Supabase security linter findings:
-- 1. Remove SECURITY DEFINER behavior from exposed views by forcing SECURITY INVOKER
-- 2. Enable RLS on exposed public tables
-- 3. Add minimum safe policies for user-owned tables
--
-- Notes:
-- - Netlify functions use the service role key, so enabling RLS here does not block backend flows.
-- - Browser/anon access to sensitive tables remains blocked unless a policy explicitly allows it.

BEGIN;

-- ---------------------------------------------------------------------------
-- Views: force invoker semantics so the querying role's permissions apply.
-- ---------------------------------------------------------------------------

ALTER VIEW IF EXISTS public.v_user_spending_summary SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_daily_revenue SET (security_invoker = true);
ALTER VIEW IF EXISTS public.link_management_dashboard SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_active_services_summary SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Enable RLS on all tables flagged by Supabase linter.
-- ---------------------------------------------------------------------------

ALTER TABLE IF EXISTS public.tiktok_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.service_id_migration_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.api_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.ticket_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.delivery_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.price_change_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Policies for user-owned tables.
-- These only apply when you query through PostgREST/Supabase Auth.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'users'
          AND policyname = 'Users can view own data'
    ) THEN
        CREATE POLICY "Users can view own data"
            ON public.users
            FOR SELECT
            USING (auth.uid() = id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'users'
          AND policyname = 'Users can update own profile'
    ) THEN
        CREATE POLICY "Users can update own profile"
            ON public.users
            FOR UPDATE
            USING (auth.uid() = id)
            WITH CHECK (auth.uid() = id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'orders'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'orders'
          AND policyname = 'Users can view own orders'
    ) THEN
        CREATE POLICY "Users can view own orders"
            ON public.orders
            FOR SELECT
            USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'orders'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'orders'
          AND policyname = 'Users can create orders'
    ) THEN
        CREATE POLICY "Users can create orders"
            ON public.orders
            FOR INSERT
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'payments'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'payments'
          AND policyname = 'Users can view own payments'
    ) THEN
        CREATE POLICY "Users can view own payments"
            ON public.payments
            FOR SELECT
            USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tickets'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tickets'
          AND policyname = 'Users can view own tickets'
    ) THEN
        CREATE POLICY "Users can view own tickets"
            ON public.tickets
            FOR SELECT
            USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'tickets'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'tickets'
          AND policyname = 'Users can create tickets'
    ) THEN
        CREATE POLICY "Users can create tickets"
            ON public.tickets
            FOR INSERT
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ticket_messages'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'ticket_messages'
          AND policyname = 'Users can view own ticket messages'
    ) THEN
        CREATE POLICY "Users can view own ticket messages"
            ON public.ticket_messages
            FOR SELECT
            USING (
                EXISTS (
                    SELECT 1
                    FROM public.tickets
                    WHERE tickets.id = ticket_messages.ticket_id
                      AND tickets.user_id = auth.uid()
                )
            );
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'api_keys'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'api_keys'
          AND policyname = 'Users can view their own API keys'
    ) THEN
        CREATE POLICY "Users can view their own API keys"
            ON public.api_keys
            FOR SELECT
            USING (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'api_keys'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'api_keys'
          AND policyname = 'Users can create their own API keys'
    ) THEN
        CREATE POLICY "Users can create their own API keys"
            ON public.api_keys
            FOR INSERT
            WITH CHECK (auth.uid() = user_id);
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'api_keys'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'api_keys'
          AND policyname = 'Users can delete their own API keys'
    ) THEN
        CREATE POLICY "Users can delete their own API keys"
            ON public.api_keys
            FOR DELETE
            USING (auth.uid() = user_id);
    END IF;
END $$;

COMMIT;
