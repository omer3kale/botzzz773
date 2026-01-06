-- Fix foreign key constraint for refill_requests table
-- Change from auth.users to public.users

-- Drop existing foreign key constraint
ALTER TABLE refill_requests 
DROP CONSTRAINT IF EXISTS refill_requests_user_id_fkey;

-- Add new foreign key constraint to public.users
ALTER TABLE refill_requests 
ADD CONSTRAINT refill_requests_user_id_fkey 
FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
