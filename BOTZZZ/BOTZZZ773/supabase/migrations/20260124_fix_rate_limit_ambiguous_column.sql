-- Fix ambiguous column reference in record_api_rate_limit function
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
    INSERT INTO public.api_rate_limits (
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
    DO UPDATE SET 
        request_count = public.api_rate_limits.request_count + 1, 
        updated_at = NOW()
    RETURNING 
        public.api_rate_limits.request_count, 
        public.api_rate_limits.request_limit, 
        public.api_rate_limits.window_start + MAKE_INTERVAL(secs => safe_window) AS window_reset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
