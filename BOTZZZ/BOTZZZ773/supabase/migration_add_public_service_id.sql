-- Migration: Add public_id sequence for services with dynamic primary key detection
-- Provides customer-facing incremental identifiers starting at 7000

DO $$
DECLARE
    pk_column text;
    backfill_sql text;
BEGIN
    -- Create sequence if it does not exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = 'services_public_id_seq'
    ) THEN
        CREATE SEQUENCE services_public_id_seq
            START 7000
            INCREMENT 1;
    END IF;

    -- Add column if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'services'
          AND column_name = 'public_id'
    ) THEN
        ALTER TABLE public.services
            ADD COLUMN public_id BIGINT UNIQUE;
    END IF;

    -- Ensure default pulls from sequence (safe to repeat)
    EXECUTE 'ALTER TABLE public.services
             ALTER COLUMN public_id SET DEFAULT nextval(''services_public_id_seq'')';

    -- Ensure the sequence is owned by the column
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'services'
          AND column_name = 'public_id'
    ) THEN
        ALTER SEQUENCE services_public_id_seq OWNED BY public.services.public_id;
    END IF;

    -- Discover primary key column for services table
    SELECT a.attname
    INTO pk_column
    FROM pg_index i
    JOIN pg_attribute a
      ON a.attrelid = i.indrelid
     AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'public.services'::regclass
      AND i.indisprimary
    ORDER BY a.attnum
    LIMIT 1;

    IF pk_column IS NULL THEN
        RAISE EXCEPTION 'Unable to locate primary key column for services table.';
    END IF;

    -- Backfill missing public IDs in creation order
    -- Check if created_at column exists for proper ordering
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'services'
          AND column_name = 'created_at'
    ) THEN
        backfill_sql := format(
            'WITH numbered AS (
                SELECT %1$I,
                       row_number() OVER (
                           ORDER BY created_at, %1$I
                       ) + 6999 AS new_public_id
                FROM public.services
                WHERE public_id IS NULL
            )
            UPDATE public.services AS s
            SET public_id = numbered.new_public_id
            FROM numbered
            WHERE s.%1$I = numbered.%1$I;'
        , pk_column);
    ELSE
        -- Fallback to primary key ordering if created_at doesn't exist
        backfill_sql := format(
            'WITH numbered AS (
                SELECT %1$I,
                       row_number() OVER (ORDER BY %1$I) + 6999 AS new_public_id
                FROM public.services
                WHERE public_id IS NULL
            )
            UPDATE public.services AS s
            SET public_id = numbered.new_public_id
            FROM numbered
            WHERE s.%1$I = numbered.%1$I;'
        , pk_column);
    END IF;

    EXECUTE backfill_sql;

    -- Align sequence with highest existing value
    PERFORM setval(
        'services_public_id_seq',
        COALESCE((SELECT MAX(public_id) FROM public.services), 6999),
        true
    );
END $$;
