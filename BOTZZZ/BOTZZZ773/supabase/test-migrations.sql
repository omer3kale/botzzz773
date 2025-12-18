-- Run these SQL commands in Supabase SQL Editor to set up test data

-- 1. First, run the migrations to add columns if not already done
-- Execute this in Supabase SQL Editor:
/*
ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS has_unread_replies BOOLEAN DEFAULT false;

ALTER TABLE tickets
ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_tickets_unread ON tickets(user_id, has_unread_replies) WHERE has_unread_replies = true;

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

DROP TRIGGER IF EXISTS ticket_message_admin_reply ON ticket_messages;
CREATE TRIGGER ticket_message_admin_reply
AFTER INSERT ON ticket_messages
FOR EACH ROW
EXECUTE FUNCTION mark_ticket_unread_on_admin_reply();
*/

-- 2. Check existing columns
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'tickets' 
ORDER BY ordinal_position;

-- 3. Check if there are any tickets with unread replies
SELECT id, short_id, subject, has_unread_replies, created_at 
FROM tickets 
WHERE has_unread_replies = true 
LIMIT 10;

-- 4. Count unread tickets per user
SELECT user_id, COUNT(*) as unread_count 
FROM tickets 
WHERE has_unread_replies = true 
GROUP BY user_id;
