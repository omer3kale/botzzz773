-- Store compressed JSON snapshots of critical datasets
CREATE TABLE IF NOT EXISTS public.data_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_label TEXT NOT NULL,
    scope TEXT[] NOT NULL DEFAULT ARRAY['users','orders','payments'],
    compression TEXT NOT NULL DEFAULT 'gzip+base64',
    checksum TEXT NOT NULL,
    payload TEXT NOT NULL,
    payload_size_bytes INTEGER NOT NULL,
    record_counts JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','failed')),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    meta JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS data_backups_created_at_idx
    ON public.data_backups (created_at DESC);
CREATE INDEX IF NOT EXISTS data_backups_status_idx
    ON public.data_backups (status);

ALTER TABLE public.data_backups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin access to data backups" ON public.data_backups;
CREATE POLICY "Admin access to data backups" ON public.data_backups
    USING (auth.jwt() ->> 'role' = 'admin');

-- Auto-trim old snapshots (keep 30 days by default)
CREATE OR REPLACE FUNCTION cleanup_expired_data_backups()
RETURNS void AS $$
BEGIN
    DELETE FROM public.data_backups
    WHERE expires_at IS NOT NULL AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
