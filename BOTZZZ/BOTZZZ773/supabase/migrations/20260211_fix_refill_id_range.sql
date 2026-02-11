-- Clamp refill_id generation to a safe 5-digit range
-- Ignores any legacy long refill_id values

DROP FUNCTION IF EXISTS generate_refill_id();

CREATE OR REPLACE FUNCTION generate_refill_id()
RETURNS TEXT AS $$
DECLARE
    last_refill_id BIGINT;
    random_increment INT;
    min_id CONSTANT BIGINT := 15090;
    max_id CONSTANT BIGINT := 99999;
BEGIN
    SELECT COALESCE(
        MAX(
            CASE
                WHEN refill_id ~ '^[0-9]+$'
                  AND refill_id::bigint >= min_id
                  AND refill_id::bigint <= max_id
                THEN refill_id::bigint
                ELSE NULL
            END
        ),
        min_id
    )
    INTO last_refill_id
    FROM refill_requests;

    random_increment := FLOOR(RANDOM() * 5 + 1)::INT;

    IF last_refill_id >= max_id THEN
        last_refill_id := min_id;
    END IF;

    RETURN (last_refill_id + random_increment)::text;
END;
$$ LANGUAGE plpgsql;

-- Keep trigger in place (recreate for safety)
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
