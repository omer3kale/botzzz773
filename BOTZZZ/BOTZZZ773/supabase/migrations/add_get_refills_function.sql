-- Create a PostgreSQL function to get refills with user info
-- This function joins refill_requests with public.users to get username
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

-- Grant access to the function for authenticated users
GRANT EXECUTE ON FUNCTION get_refills_with_emails() TO authenticated;

-- Grant access for anon role if needed (be careful with this)
GRANT EXECUTE ON FUNCTION get_refills_with_emails() TO anon;

-- Grant SELECT on auth.users for the function to work
-- Note: This uses SECURITY DEFINER so it runs as the function owner
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO authenticated;

