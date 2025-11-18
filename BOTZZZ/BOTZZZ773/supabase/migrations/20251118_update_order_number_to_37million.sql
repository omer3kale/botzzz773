-- Update order number generation to start from 37 million
BEGIN;

-- Create sequence for order numbers starting at 37 million
CREATE SEQUENCE IF NOT EXISTS public.order_number_seq START WITH 37000000 INCREMENT BY 1;

-- Replace the generate_order_number function to use the sequence
CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    next_number BIGINT;
    candidate TEXT;
BEGIN
    -- Get next number from sequence
    next_number := nextval('public.order_number_seq');
    candidate := next_number::TEXT;
    
    -- Return the number as a string
    RETURN candidate;
END;
$$;

COMMIT;
