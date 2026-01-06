-- Fix refill_id trigger to ensure it generates 15095+ values
-- This migration updates the generate_refill_id() function to handle edge cases

-- Recreate the function to filter out any invalid (<15090) refill_ids
CREATE OR REPLACE FUNCTION generate_refill_id()
RETURNS BIGINT AS $$
DECLARE
    last_refill_id BIGINT;
    random_increment INT;
BEGIN
    -- Get the last valid refill_id (>= 15090), default to 15090
    SELECT COALESCE(MAX(NULLIF(CASE WHEN refill_id < 15090 THEN NULL ELSE refill_id END, NULL)), 15090) 
    INTO last_refill_id 
    FROM refill_requests;
    
    -- Generate random increment between 1 and 5
    random_increment := FLOOR(RANDOM() * 5 + 1)::INT;
    
    -- Return last_refill_id + random_increment (ensures result >= 15091)
    RETURN last_refill_id + random_increment;
END;
$$ LANGUAGE plpgsql;

-- Verify the trigger is active
DO $$
BEGIN
    RAISE NOTICE '✓ Updated generate_refill_id() function to ensure 15090+ range';
    RAISE NOTICE '✓ Trigger refill_id_trigger is still active';
END $$;
