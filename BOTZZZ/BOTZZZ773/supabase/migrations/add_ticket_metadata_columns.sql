-- Add last_reply_by and closed_at columns to tickets table

ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS last_reply_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;

-- Create index on closed_at for filtering closed tickets
CREATE INDEX IF NOT EXISTS idx_tickets_closed_at ON tickets(closed_at);

-- Verify columns added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tickets' 
AND column_name IN ('last_reply_by', 'closed_at');
