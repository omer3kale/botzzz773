-- Update get_refills_with_emails() function to return username and provider_refill_id
-- This fixes the admin refills table to show username instead of email

DROP FUNCTION IF EXISTS get_refills_with_emails();

CREATE OR REPLACE FUNCTION get_refills_with_emails()
RETURNS TABLE (
  id UUID,
  user_id UUID,
  order_number VARCHAR,
  refill_id BIGINT,
  service_id VARCHAR,
  quantity INTEGER,
  status VARCHAR,
  reason TEXT,
  admin_notes TEXT,
  requested_at TIMESTAMP WITH TIME ZONE,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  provider_refill_id VARCHAR,
  email VARCHAR
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    r.id,
    r.user_id,
    r.order_number,
    r.refill_id,
    r.service_id,
    r.quantity,
    r.status,
    r.reason,
    r.admin_notes,
    r.requested_at,
    r.processed_at,
    r.created_at,
    r.updated_at,
    r.provider_refill_id,
    u.username
  FROM refill_requests r
  LEFT JOIN public.users u ON r.user_id = u.id
  ORDER BY r.requested_at DESC;
$$;

-- Grant access to the function
GRANT EXECUTE ON FUNCTION get_refills_with_emails() TO authenticated;
GRANT EXECUTE ON FUNCTION get_refills_with_emails() TO anon;

DO $$
BEGIN
  RAISE NOTICE '✓ Updated get_refills_with_emails() to return username and provider_refill_id';
END $$;
