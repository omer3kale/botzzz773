-- Create admin_otp_codes table for storing one-time passwords
CREATE TABLE IF NOT EXISTS public.admin_otp_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    otp_code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_admin_otp_email ON public.admin_otp_codes(email);
CREATE INDEX IF NOT EXISTS idx_admin_otp_expires ON public.admin_otp_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_otp_used ON public.admin_otp_codes(used);

-- Enable Row Level Security
ALTER TABLE public.admin_otp_codes ENABLE ROW LEVEL SECURITY;

-- Policy: No public access (only backend functions can access)
-- Make idempotent to avoid "already exists" error
DROP POLICY IF EXISTS "No public access to OTP codes" ON public.admin_otp_codes;
CREATE POLICY "No public access to OTP codes" ON public.admin_otp_codes
    FOR ALL
    USING (false);

-- Cleanup old/expired OTP codes function
CREATE OR REPLACE FUNCTION cleanup_expired_otp_codes()
RETURNS void AS $$
BEGIN
    DELETE FROM public.admin_otp_codes
    WHERE expires_at < NOW() - INTERVAL '1 hour'
    OR (used = TRUE AND created_at < NOW() - INTERVAL '24 hours');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a scheduled job to cleanup (if pg_cron is enabled)
-- SELECT cron.schedule('cleanup-otp-codes', '0 * * * *', 'SELECT cleanup_expired_otp_codes()');
