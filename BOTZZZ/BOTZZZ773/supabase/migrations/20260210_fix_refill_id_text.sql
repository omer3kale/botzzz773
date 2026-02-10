-- Fix generate_refill_id for varchar refill_id
-- Ensures numeric comparison works after refill_id was converted to VARCHAR

DROP FUNCTION IF EXISTS generate_refill_id();

CREATE OR REPLACE FUNCTION generate_refill_id()
RETURNS TEXT AS $$
DECLARE
    last_refill_id BIGINT;
    random_increment INT;
BEGIN
    SELECT COALESCE(
        MAX(
            CASE
                WHEN refill_id ~ '^[0-9]+$' AND refill_id::bigint >= 15090 THEN refill_id::bigint
                ELSE NULL
            END
        ),
        15090
    )
    INTO last_refill_id
    FROM refill_requests;

    random_increment := FLOOR(RANDOM() * 5 + 1)::INT;

    RETURN (last_refill_id + random_increment)::text;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS refill_id_trigger ON refill_requests;
DROP FUNCTION IF EXISTS auto_refill_id();

CREATE OR REPLACE FUNCTION auto_refill_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.refill_id IS NULL THEN
        NEW.refill_id := generate_refill_id();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refill_id_trigger
BEFORE INSERT ON refill_requests
FOR EACH ROW
EXECUTE FUNCTION auto_refill_id();
