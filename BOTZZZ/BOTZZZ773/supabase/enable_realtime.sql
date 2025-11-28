-- ==========================================
-- BOTZZZ773 - Enable Supabase Realtime
-- ==========================================
-- This SQL enables real-time subscriptions for orders, payments, tickets, and users
-- Run this in your Supabase SQL Editor
-- ==========================================

-- Enable Replica Identity FULL for real-time (needed for UPDATE/DELETE events to include old data)
ALTER TABLE orders REPLICA IDENTITY FULL;
ALTER TABLE payments REPLICA IDENTITY FULL;
ALTER TABLE tickets REPLICA IDENTITY FULL;
ALTER TABLE users REPLICA IDENTITY FULL;

-- Add tables to the supabase_realtime publication
-- First, check if the publication exists and create it if not
DO $$
BEGIN
    -- Drop existing publication if it exists to recreate with all tables
    DROP PUBLICATION IF EXISTS supabase_realtime;
    
    -- Create the publication with all needed tables
    CREATE PUBLICATION supabase_realtime FOR TABLE orders, payments, tickets, users;
    
    RAISE NOTICE 'Supabase realtime publication created successfully';
EXCEPTION
    WHEN others THEN
        -- If creation fails, try adding tables individually
        RAISE NOTICE 'Attempting to add tables individually...';
        
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE orders;
        EXCEPTION WHEN duplicate_object THEN
            RAISE NOTICE 'orders already in publication';
        END;
        
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE payments;
        EXCEPTION WHEN duplicate_object THEN
            RAISE NOTICE 'payments already in publication';
        END;
        
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE tickets;
        EXCEPTION WHEN duplicate_object THEN
            RAISE NOTICE 'tickets already in publication';
        END;
        
        BEGIN
            ALTER PUBLICATION supabase_realtime ADD TABLE users;
        EXCEPTION WHEN duplicate_object THEN
            RAISE NOTICE 'users already in publication';
        END;
END $$;

-- Verify the setup
SELECT schemaname, tablename 
FROM pg_publication_tables 
WHERE pubname = 'supabase_realtime';

-- Show replica identity status
SELECT 
    c.relname AS table_name,
    CASE c.relreplident
        WHEN 'd' THEN 'default (primary key)'
        WHEN 'n' THEN 'nothing'
        WHEN 'f' THEN 'full'
        WHEN 'i' THEN 'index'
    END AS replica_identity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' 
AND c.relname IN ('orders', 'payments', 'tickets', 'users');
