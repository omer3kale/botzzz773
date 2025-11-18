-- Update the generate_order_number function to use simple incremental numbering
-- This removes the "multiply by 10 and add random digit" logic

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
    next_val BIGINT;
BEGIN
    -- Get next sequence value (no multiplication, just increment)
    next_val := nextval('order_number_seq');
    
    -- Return as text (simple sequential: 37000000, 37000001, 37000002, etc.)
    RETURN next_val::TEXT;
END;
$$ LANGUAGE plpgsql;
