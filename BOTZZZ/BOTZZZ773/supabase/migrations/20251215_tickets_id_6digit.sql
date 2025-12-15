-- Migration: Convert tickets.id to 6-digit integer IDs
-- Range: 100000..999999, cyclic sequence
-- IMPORTANT: Run in maintenance window; backup before applying.

BEGIN;

-- 1) Create sequence for 6-digit IDs
CREATE SEQUENCE IF NOT EXISTS tickets_id_seq
    START 100000
    INCREMENT 1
    MINVALUE 100000
    MAXVALUE 999999
    CYCLE;

-- 2) Add temporary int column
ALTER TABLE public.tickets ADD COLUMN id_int INTEGER;

-- 3) Backfill int IDs for existing rows
UPDATE public.tickets
SET id_int = nextval('tickets_id_seq')
WHERE id_int IS NULL;

-- 4) Ensure uniqueness
ALTER TABLE public.tickets ADD CONSTRAINT tickets_id_int_unique UNIQUE (id_int);

-- 5) Update foreign keys referencing tickets.id
-- Example: ticket_messages.ticket_id → point to new integer IDs
-- Drop existing FK if present (adjust constraint name if different)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_schema = 'public'
          AND table_name = 'ticket_messages'
          AND constraint_type = 'FOREIGN KEY'
    ) THEN
        -- Attempt to drop FK by inferring name; adjust as needed
        -- This block may need manual FK name adjustment depending on your schema
        BEGIN
            ALTER TABLE public.ticket_messages DROP CONSTRAINT ticket_messages_ticket_id_fkey;
        EXCEPTION WHEN undefined_object THEN
            NULL;
        END;
    END IF;
END$$;

-- 6) Create mapping from old UUID to new int IDs for FK update
-- Assumes ticket_messages.ticket_id stores old UUIDs; if already integer, skip this step
-- Add a temp mapping table
CREATE TEMP TABLE tmp_ticket_id_map AS
SELECT id AS old_id, id_int AS new_id
FROM public.tickets;

-- 7) Update child table to new integer IDs
-- If ticket_messages.ticket_id is UUID, we need an int column; else update in place
-- Add new int column if needed
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='ticket_messages' AND column_name='ticket_id_int'
    ) THEN
        ALTER TABLE public.ticket_messages ADD COLUMN ticket_id_int INTEGER;
    END IF;
END$$;

-- Populate new int column by joining map
UPDATE public.ticket_messages tm
SET ticket_id_int = m.new_id
FROM tmp_ticket_id_map m
WHERE tm.ticket_id = m.old_id;

-- 8) Swap columns in child table: drop old, rename new
ALTER TABLE public.ticket_messages DROP COLUMN ticket_id;
ALTER TABLE public.ticket_messages RENAME COLUMN ticket_id_int TO ticket_id;

-- 9) Add FK to new integer ID
ALTER TABLE public.ticket_messages
    ADD CONSTRAINT ticket_messages_ticket_id_fkey
    FOREIGN KEY (ticket_id) REFERENCES public.tickets(id_int) ON DELETE CASCADE;

-- 10) Swap primary key in tickets
ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_pkey;
ALTER TABLE public.tickets ADD CONSTRAINT tickets_pkey PRIMARY KEY (id_int);

-- 11) Drop old UUID id, rename new int column to id
ALTER TABLE public.tickets DROP COLUMN id;
ALTER TABLE public.tickets RENAME COLUMN id_int TO id;

-- 12) Set default from sequence for new inserts
ALTER TABLE public.tickets ALTER COLUMN id SET DEFAULT nextval('tickets_id_seq');

COMMIT;

-- Post-steps:
-- - Review other tables referencing tickets.id and apply similar mapping.
-- - Update stored procedures or triggers if any rely on UUID format.