-- Add read tracking for ticket messages

-- Add has_unread_replies column to tickets table
ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS has_unread_replies BOOLEAN DEFAULT false;

-- Add last_viewed_at column to track when user last viewed the ticket
ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMP WITH TIME ZONE;

-- Create index for filtering tickets with unread replies
CREATE INDEX IF NOT EXISTS idx_tickets_unread ON tickets(user_id, has_unread_replies) WHERE has_unread_replies = true;

-- Function to mark ticket as having unread replies when admin replies
CREATE OR REPLACE FUNCTION mark_ticket_unread_on_admin_reply()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_admin = true THEN
    UPDATE tickets 
    SET has_unread_replies = true,
        updated_at = NOW()
    WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: When a new admin message is inserted, mark ticket as unread
DROP TRIGGER IF EXISTS ticket_message_admin_reply ON ticket_messages;
CREATE TRIGGER ticket_message_admin_reply
AFTER INSERT ON ticket_messages
FOR EACH ROW
EXECUTE FUNCTION mark_ticket_unread_on_admin_reply();

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tickets' 
AND column_name IN ('has_unread_replies', 'last_viewed_at');
