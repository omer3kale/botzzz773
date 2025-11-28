-- ============================================
-- Create Test User for Production Testing
-- Run this in Supabase SQL Editor
-- ============================================

-- Create test user with initial balance
INSERT INTO users (id, email, password, role, balance, created_at)
VALUES (
    gen_random_uuid(),
    'test@botzzz773.com',
    -- Password: Test123! 
    -- (you'll need to hash this properly or set via signup)
    '\\\',
    'user',
    50.00,
    NOW()
)
ON CONFLICT (email) 
DO UPDATE SET 
    balance = 50.00,
    updated_at = NOW();

-- Verify user created
SELECT id, email, balance, role, created_at 
FROM users 
WHERE email = 'test@botzzz773.com';
