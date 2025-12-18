-- Migration: Add short_id column to existing tickets table
-- This adds the short_id column to tickets and generates 6-digit IDs for existing tickets

-- Add short_id column if it doesn't exist
ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS short_id VARCHAR(6) UNIQUE;

-- Create a function to generate unique short IDs
CREATE OR REPLACE FUNCTION generate_unique_short_id()
RETURNS VARCHAR(6) AS $$
DECLARE
  new_id VARCHAR(6);
  id_exists BOOLEAN;
BEGIN
  LOOP
    -- Generate a random 6-digit number (100000-999999)
    new_id := LPAD((FLOOR(RANDOM() * 900000 + 100000)::TEXT), 6, '0');
    
    -- Check if it already exists
    SELECT EXISTS(SELECT 1 FROM tickets WHERE short_id = new_id) INTO id_exists;
    
    -- If it doesn't exist, return it
    IF NOT id_exists THEN
      RETURN new_id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Update existing tickets that don't have a short_id
UPDATE tickets
SET short_id = generate_unique_short_id()
WHERE short_id IS NULL;

-- Make short_id NOT NULL after populating existing records
ALTER TABLE tickets
ALTER COLUMN short_id SET NOT NULL;

-- Add index on short_id if it doesn't exist
CREATE UNIQUE INDEX IF NOT EXISTS idx_tickets_short_id ON tickets(short_id);

-- Drop the function after using it (optional, but keeps schema clean)
DROP FUNCTION IF EXISTS generate_unique_short_id();

-- Verify the migration
SELECT COUNT(*) as total_tickets, 
       COUNT(short_id) as tickets_with_short_id,
       COUNT(CASE WHEN short_id IS NULL THEN 1 END) as tickets_without_short_id
FROM tickets;
