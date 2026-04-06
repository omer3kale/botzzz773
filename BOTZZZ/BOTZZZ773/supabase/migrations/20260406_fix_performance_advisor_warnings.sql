-- Fix Supabase performance advisor warnings:
-- 1. Avoid per-row auth function re-evaluation in RLS policies
-- 2. Remove duplicate permissive policies
-- 3. Drop duplicate indexes covered by unique constraints

BEGIN;

-- ---------------------------------------------------------------------------
-- service_categories: replace duplicate policies with canonical optimized ones
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Allow public read active categories" ON public.service_categories;
DROP POLICY IF EXISTS "Public read access for active categories" ON public.service_categories;
DROP POLICY IF EXISTS "Allow admins full access to categories" ON public.service_categories;
DROP POLICY IF EXISTS "Admin full access to categories" ON public.service_categories;
DROP POLICY IF EXISTS "Public or admin read categories" ON public.service_categories;
DROP POLICY IF EXISTS "Admins can insert categories" ON public.service_categories;
DROP POLICY IF EXISTS "Admins can update categories" ON public.service_categories;
DROP POLICY IF EXISTS "Admins can delete categories" ON public.service_categories;

CREATE POLICY "Public or admin read categories"
    ON public.service_categories
    FOR SELECT
    USING (
        status = 'active'
        OR EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    );

CREATE POLICY "Admins can insert categories"
    ON public.service_categories
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    );

CREATE POLICY "Admins can update categories"
    ON public.service_categories
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    );

CREATE POLICY "Admins can delete categories"
    ON public.service_categories
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    );

-- ---------------------------------------------------------------------------
-- refill_requests: merge overlapping SELECT policies and optimize auth calls
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view their own refill requests" ON public.refill_requests;
DROP POLICY IF EXISTS "Users can create refill requests" ON public.refill_requests;
DROP POLICY IF EXISTS "Admins can view all refill requests" ON public.refill_requests;
DROP POLICY IF EXISTS "Admins can update refill requests" ON public.refill_requests;
DROP POLICY IF EXISTS "Users or admins can view refill requests" ON public.refill_requests;

CREATE POLICY "Users or admins can view refill requests"
    ON public.refill_requests
    FOR SELECT
    USING (
        (SELECT auth.uid()) = user_id
        OR EXISTS (
            SELECT 1
            FROM public.users
            WHERE public.users.id = (SELECT auth.uid())
              AND public.users.role = 'admin'
        )
    );

CREATE POLICY "Users can create refill requests"
    ON public.refill_requests
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Admins can update refill requests"
    ON public.refill_requests
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE public.users.id = (SELECT auth.uid())
              AND public.users.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE public.users.id = (SELECT auth.uid())
              AND public.users.role = 'admin'
        )
    );

-- ---------------------------------------------------------------------------
-- Optimize existing policies flagged by auth_rls_initplan
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Admin access to data backups" ON public.data_backups;
CREATE POLICY "Admin access to data backups"
    ON public.data_backups
    FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Users can view own ticket messages" ON public.ticket_messages;
CREATE POLICY "Users can view own ticket messages"
    ON public.ticket_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.tickets
            WHERE tickets.id = ticket_messages.ticket_id
              AND tickets.user_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can view their own API keys" ON public.api_keys;
CREATE POLICY "Users can view their own API keys"
    ON public.api_keys
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create their own API keys" ON public.api_keys;
CREATE POLICY "Users can create their own API keys"
    ON public.api_keys
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own API keys" ON public.api_keys;
CREATE POLICY "Users can delete their own API keys"
    ON public.api_keys
    FOR DELETE
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins manage pricing rules" ON public.pricing_rules;
CREATE POLICY "Admins manage pricing rules"
    ON public.pricing_rules
    FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Admin full access to link_management" ON public.link_management;
CREATE POLICY "Admin full access to link_management"
    ON public.link_management
    FOR ALL
    USING (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Admin can read user_logins" ON public.user_logins;
CREATE POLICY "Admin can read user_logins"
    ON public.user_logins
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1
            FROM public.users
            WHERE users.id = (SELECT auth.uid())
              AND users.role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Users can view own data" ON public.users;
CREATE POLICY "Users can view own data"
    ON public.users
    FOR SELECT
    USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile"
    ON public.users
    FOR UPDATE
    USING ((SELECT auth.uid()) = id)
    WITH CHECK ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "Users can view own orders" ON public.orders;
CREATE POLICY "Users can view own orders"
    ON public.orders
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create orders" ON public.orders;
CREATE POLICY "Users can create orders"
    ON public.orders
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
CREATE POLICY "Users can view own payments"
    ON public.payments
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view own tickets" ON public.tickets;
CREATE POLICY "Users can view own tickets"
    ON public.tickets
    FOR SELECT
    USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create tickets" ON public.tickets;
CREATE POLICY "Users can create tickets"
    ON public.tickets
    FOR INSERT
    WITH CHECK ((SELECT auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Drop duplicate indexes already covered by unique constraints
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_orders_order_number;
DROP INDEX IF EXISTS public.idx_tickets_short_id;

COMMIT;
