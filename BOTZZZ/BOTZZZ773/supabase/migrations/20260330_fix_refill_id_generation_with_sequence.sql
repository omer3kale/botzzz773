-- Replace random MAX()+increment refill_id generation with a sequence-backed generator.
-- This keeps refill IDs unique under concurrency while preserving a random 1-5 increment.

CREATE SEQUENCE IF NOT EXISTS refill_id_seq START WITH 15095 INCREMENT BY 1;

SELECT setval(
  'refill_id_seq',
  GREATEST(
    15095,
    COALESCE(
      (
        SELECT MAX(refill_id::bigint)
        FROM refill_requests
        WHERE refill_id ~ '^[0-9]+$'
          AND refill_id::bigint >= 15095
          AND refill_id::bigint <= 9999999
      ),
      15094
    ) + 1
  ),
  false
);

DROP FUNCTION IF EXISTS generate_refill_id();

CREATE OR REPLACE FUNCTION generate_refill_id()
RETURNS TEXT AS $$
DECLARE
  random_step INTEGER;
  next_id BIGINT;
BEGIN
  -- Serialize refill_id generation so the random step is applied atomically.
  PERFORM pg_advisory_xact_lock(hashtext('refill_id_seq_random_step'));

  random_step := FLOOR(RANDOM() * 5 + 1)::INTEGER;
  next_id := nextval('refill_id_seq');

  IF random_step > 1 THEN
    PERFORM setval('refill_id_seq', next_id + random_step - 1, true);
    next_id := next_id + random_step - 1;
  END IF;

  RETURN next_id::text;
END;
$$ LANGUAGE plpgsql;
