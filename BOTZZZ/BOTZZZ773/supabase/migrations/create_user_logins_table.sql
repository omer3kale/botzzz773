-- User Logins Tracking Table
-- Tracks IP address, user agent, and device fingerprint for each login/signup
-- Used to detect multi-account abuse (same person, multiple accounts)

CREATE TABLE IF NOT EXISTS user_logins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    fingerprint TEXT,
    action TEXT NOT NULL DEFAULT 'login', -- 'login', 'signup', 'google-signin'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast duplicate detection queries
CREATE INDEX IF NOT EXISTS idx_user_logins_user_id ON user_logins(user_id);
CREATE INDEX IF NOT EXISTS idx_user_logins_ip ON user_logins(ip_address);
CREATE INDEX IF NOT EXISTS idx_user_logins_fingerprint ON user_logins(fingerprint);
CREATE INDEX IF NOT EXISTS idx_user_logins_created ON user_logins(created_at DESC);

-- RLS
ALTER TABLE user_logins ENABLE ROW LEVEL SECURITY;

-- Only admin can read login records
CREATE POLICY "Admin can read user_logins" ON user_logins
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
    );

-- Service role can insert (used by backend functions)
CREATE POLICY "Service role can insert user_logins" ON user_logins
    FOR INSERT WITH CHECK (true);
