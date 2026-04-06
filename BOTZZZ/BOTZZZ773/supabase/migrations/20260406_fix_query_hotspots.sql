-- Fix high-cost query hotspots identified by Supabase query performance report
-- 1. Speed up admin order search (ILIKE filters)
-- 2. Speed up order status sync selection
-- 3. Speed up refill status sync selection
-- 4. Speed up active services listing

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Admin order search: ILIKE across multiple text columns
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_orders_order_number_trgm
    ON public.orders USING gin (order_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_provider_order_id_trgm
    ON public.orders USING gin (provider_order_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_provider_name_trgm
    ON public.orders USING gin (provider_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_service_name_trgm
    ON public.orders USING gin (service_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_link_trgm
    ON public.orders USING gin (link gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_created_at_desc
    ON public.orders (created_at DESC);

-- ---------------------------------------------------------------------------
-- Order sync/status selection
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_orders_status_last_status_sync
    ON public.orders (status, last_status_sync ASC);

CREATE INDEX IF NOT EXISTS idx_orders_order_number_user_id
    ON public.orders (order_number, user_id);

CREATE INDEX IF NOT EXISTS idx_orders_status_charge_cover
    ON public.orders (status)
    INCLUDE (charge, original_charge, provider_cost, provider_currency);

-- ---------------------------------------------------------------------------
-- Refill sync selection
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_refill_requests_status_provider_refill_id
    ON public.refill_requests (status, provider_refill_id)
    WHERE provider_refill_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Services listing
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_services_status_category
    ON public.services (status, category);

COMMIT;
