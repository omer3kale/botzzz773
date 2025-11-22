-- Update order number generation to start from 37 million and append a random digit
BEGIN;

-- Ensure a dedicated sequence exists for numeric order numbers
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = 'order_number_seq'
    ) THEN
        CREATE SEQUENCE public.order_number_seq
            INCREMENT BY 1
            START WITH 37000000
            MINVALUE 1
            NO CYCLE;
    END IF;
END $$;

-- Align the sequence with the larger of 37M or the current numeric orders (ignores legacy ORD- values)
SELECT setval(
    'public.order_number_seq',
    GREATEST(
        37000000,
        COALESCE(
            (
                SELECT MAX((order_number)::BIGINT / 10)
                FROM orders
                WHERE order_number ~ '^[0-9]+$'
            ),
            37000000
        )
    ),
    true
);

-- Replace the generator to append a random check digit while staying in the 37M band
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    base_number BIGINT;
    random_digit INTEGER;
BEGIN
    base_number := nextval('public.order_number_seq');
    random_digit := floor(random() * 10)::INTEGER; -- 0-9
    RETURN ((base_number * 10) + random_digit)::TEXT;
END;
$$;

COMMIT;
