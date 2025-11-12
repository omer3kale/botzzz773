-- Hotfix: ensure all services have a public_id and the backing sequence is aligned
-- Run this script in the Supabase SQL editor or via psql as a privileged role.

DO $$
DECLARE
    current_max BIGINT;
BEGIN
    -- Create the sequence if it was never provisioned
    IF NOT EXISTS (
        SELECT 1
        FROM pg_class
        WHERE relname = 'services_public_id_seq'
    ) THEN
        CREATE SEQUENCE services_public_id_seq
            START WITH 7000
            INCREMENT BY 1;
    END IF;

    -- Add the public_id column if still missing
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'services'
          AND column_name = 'public_id'
    ) THEN
        ALTER TABLE public.services
            ADD COLUMN public_id BIGINT UNIQUE;
    END IF;

    -- Attach the sequence to the column when possible
    BEGIN
        ALTER TABLE public.services
            ALTER COLUMN public_id SET DEFAULT nextval('services_public_id_seq');
        ALTER SEQUENCE services_public_id_seq OWNED BY public.services.public_id;
    EXCEPTION
        WHEN undefined_table THEN
            NULL; -- table missing would have raised earlier
    END;

    -- Backfill any missing identifiers using creation order when available
    WITH numbered AS (
        SELECT id,
               ROW_NUMBER() OVER (
                   ORDER BY created_at NULLS LAST, id
               ) + 6999 AS new_public_id
        FROM public.services
        WHERE public_id IS NULL
    )
    UPDATE public.services AS svc
    SET public_id = numbered.new_public_id
    FROM numbered
    WHERE svc.id = numbered.id;

    -- Realign the sequence with the highest assigned value
    SELECT COALESCE(MAX(public_id), 6999)
    INTO current_max
    FROM public.services;

    PERFORM setval('services_public_id_seq', current_max, true);
END $$;
