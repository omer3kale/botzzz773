BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS order_number VARCHAR(20);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number
    ON orders(order_number);

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    candidate TEXT;
BEGIN
    LOOP
        candidate := 'ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM orders WHERE order_number = candidate
        );
    END LOOP;
    RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_order_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.order_number IS NULL OR length(trim(NEW.order_number)) = 0 THEN
        NEW.order_number := public.generate_order_number();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orders_generate_order_number ON orders;

CREATE TRIGGER trg_orders_generate_order_number
BEFORE INSERT ON orders
FOR EACH ROW
EXECUTE FUNCTION public.set_order_number();

UPDATE orders
SET order_number = public.generate_order_number()
WHERE order_number IS NULL OR length(trim(order_number)) = 0;

COMMIT;
