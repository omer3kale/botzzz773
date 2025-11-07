-- Migration: Harden api_keys table storage
-- Run this on your Supabase database to migrate existing API keys to hashed storage

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'api_keys'
    ) THEN
        CREATE TABLE api_keys (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            user_id UUID,
            key TEXT UNIQUE,
            key_hash TEXT,
            key_prefix VARCHAR(32),
            key_last_four VARCHAR(4),
            name VARCHAR(100),
            permissions TEXT[] DEFAULT ARRAY['read'],
            status VARCHAR(20) DEFAULT 'active',
            last_used TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            expires_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT api_keys_hash_presence CHECK (
                (key IS NULL AND key_hash IS NOT NULL AND key_prefix IS NOT NULL AND key_last_four IS NOT NULL)
                OR (key IS NOT NULL AND key_hash IS NULL AND key_prefix IS NULL AND key_last_four IS NULL)
            )
        );
    END IF;
END
$$;

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_hash TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_prefix VARCHAR(32);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_last_four VARCHAR(4);
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS user_id UUID;

ALTER TABLE api_keys ALTER COLUMN key DROP NOT NULL;

UPDATE api_keys
SET
    key_hash = COALESCE(key_hash, encode(digest(key, 'sha256'), 'hex')),
    key_prefix = COALESCE(key_prefix, substring(key FROM 1 FOR 12)),
    key_last_four = COALESCE(key_last_four, right(key, 4))
WHERE key IS NOT NULL
  AND (key_hash IS NULL OR key_prefix IS NULL OR key_last_four IS NULL);

UPDATE api_keys
SET key = NULL
WHERE key IS NOT NULL
  AND key_hash IS NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'api_keys_hash_presence'
    ) THEN
        ALTER TABLE api_keys
        ADD CONSTRAINT api_keys_hash_presence CHECK (
            (key IS NULL AND key_hash IS NOT NULL AND key_prefix IS NOT NULL AND key_last_four IS NOT NULL)
            OR (key IS NOT NULL AND key_hash IS NULL AND key_prefix IS NULL AND key_last_four IS NULL)
        );
    END IF;
END
$$;

DROP INDEX IF EXISTS idx_api_keys_key;
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_raw ON api_keys(key) WHERE key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix) WHERE key_prefix IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash) WHERE key_hash IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = 'users'
          AND c.column_name = 'id'
    )
    AND EXISTS (
        SELECT 1
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = 'api_keys'
          AND c.column_name = 'user_id'
    )
    AND NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints tc
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'api_keys'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND tc.constraint_name = 'api_keys_user_id_fkey'
    ) THEN
        ALTER TABLE api_keys
        ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id)
            REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END
$$;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE policyname = 'Users can view their own API keys'
          AND tablename = 'api_keys'
    ) THEN
        CREATE POLICY "Users can view their own API keys"
            ON api_keys FOR SELECT
            USING (auth.uid() = user_id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE policyname = 'Users can create their own API keys'
          AND tablename = 'api_keys'
    ) THEN
        CREATE POLICY "Users can create their own API keys"
            ON api_keys FOR INSERT
            WITH CHECK (auth.uid() = user_id);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE policyname = 'Users can delete their own API keys'
          AND tablename = 'api_keys'
    ) THEN
        CREATE POLICY "Users can delete their own API keys"
            ON api_keys FOR DELETE
            USING (auth.uid() = user_id);
    END IF;
END
$$;

COMMENT ON TABLE api_keys IS 'Stores hashed API keys for external integrations';
