-- Move pg_trgm out of public schema to satisfy Supabase security linter

BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_extension e
        JOIN pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_trgm'
          AND n.nspname = 'public'
    ) THEN
        ALTER EXTENSION pg_trgm SET SCHEMA extensions;
    END IF;
END $$;

COMMIT;
