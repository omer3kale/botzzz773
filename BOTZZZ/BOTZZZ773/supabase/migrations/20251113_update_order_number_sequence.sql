BEGIN;

CREATE SEQUENCE IF NOT EXISTS order_number_seq START WITH 7000000;

WITH target_orders AS (
    SELECT id,
           ROW_NUMBER() OVER (ORDER BY created_at NULLS FIRST, id) - 1 AS row_offset
    FROM orders
    WHERE order_number IS NULL
       OR order_number !~ '^[0-9]+$'
       OR (order_number ~ '^[0-9]+$' AND order_number::bigint < 7000000)
),
assigned_numbers AS (
    SELECT id, (7000000 + row_offset)::bigint AS new_number
    FROM target_orders
)
UPDATE orders o
SET order_number = assigned_numbers.new_number::text
FROM assigned_numbers
WHERE o.id = assigned_numbers.id;

SELECT setval(
    'order_number_seq',
    GREATEST(
        7000000,
        COALESCE(
            (SELECT MAX((order_number)::bigint) FILTER (WHERE order_number ~ '^[0-9]+$') FROM orders),
            7000000
        )
    ),
    true
);

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    candidate BIGINT;
BEGIN
    LOOP
        candidate := nextval('order_number_seq');
        EXIT WHEN NOT EXISTS (SELECT 1 FROM orders WHERE order_number = candidate::text);
    END LOOP;
    RETURN candidate::text;
END;
$$;

COMMIT;
