-- Track per-identifier request counts within sliding windows
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL,
    route TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_seconds INTEGER NOT NULL DEFAULT 60,
    request_count INTEGER NOT NULL DEFAULT 1,
    request_limit INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure fast lookups and a single record per identifier/window/route
CREATE UNIQUE INDEX IF NOT EXISTS api_rate_limits_identifier_route_window_idx
    ON public.api_rate_limits (identifier, route, window_start);
CREATE INDEX IF NOT EXISTS api_rate_limits_route_idx
    ON public.api_rate_limits (route);
CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx
    ON public.api_rate_limits (window_start);

-- Maintain updated_at automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS api_rate_limits_updated_at_trg ON public.api_rate_limits;
CREATE TRIGGER api_rate_limits_updated_at_trg
    BEFORE UPDATE ON public.api_rate_limits
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Restrictive RLS: only service role (which bypasses RLS) can access
ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No public access to rate limits" ON public.api_rate_limits;
CREATE POLICY "No public access to rate limits" ON public.api_rate_limits
    FOR ALL USING (false);

-- Helper to trim stale rate limit windows
CREATE OR REPLACE FUNCTION cleanup_expired_rate_limits()
RETURNS void AS $$
BEGIN
    DELETE FROM public.api_rate_limits
    WHERE window_start < NOW() - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Atomic increment helper used by Netlify functions via RPC
CREATE OR REPLACE FUNCTION public.record_api_rate_limit(
    p_identifier TEXT,
    p_route TEXT,
    p_window_seconds INTEGER DEFAULT 60,
    p_request_limit INTEGER DEFAULT 60
)
RETURNS TABLE (
    request_count INTEGER,
    request_limit INTEGER,
    window_reset TIMESTAMPTZ
) AS $$
DECLARE
    safe_window INTEGER := GREATEST(p_window_seconds, 1);
    safe_limit INTEGER := GREATEST(p_request_limit, 1);
    window_epoch BIGINT;
    window_start TIMESTAMPTZ;
BEGIN
    window_epoch := FLOOR(EXTRACT(EPOCH FROM NOW()) / safe_window) * safe_window;
    window_start := TO_TIMESTAMP(window_epoch);

    RETURN QUERY
    INSERT INTO public.api_rate_limits AS rl (
        identifier,
        route,
        window_start,
        window_seconds,
        request_limit,
        request_count
    ) VALUES (
        p_identifier,
        p_route,
        window_start,
        safe_window,
        safe_limit,
        1
    )
    ON CONFLICT (identifier, route, window_start)
    DO UPDATE SET request_count = rl.request_count + 1, updated_at = NOW()
    RETURNING rl.request_count, rl.request_limit, window_start + MAKE_INTERVAL(secs => safe_window) AS window_reset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Suggested pg_cron job (optional)
-- SELECT cron.schedule('cleanup-rate-limits', '0 */6 * * *', 'SELECT cleanup_expired_rate_limits()');
