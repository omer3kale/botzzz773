-- Create admin notifications table
-- Stores all admin notifications: low balance alerts, failed orders, payment notifications, new user registrations

CREATE TABLE IF NOT EXISTS admin_notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notification_type VARCHAR(50) NOT NULL, -- 'low_balance', 'failed_order', 'payment', 'new_user'
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    read_at TIMESTAMP WITH TIME ZONE,
    data JSONB, -- Store additional context: provider_name, order_id, user_id, amount, etc.
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_notifications_read ON admin_notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON admin_notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON admin_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON admin_notifications(read) WHERE read = FALSE;

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_notification_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_notification_timestamp_trigger
BEFORE UPDATE ON admin_notifications
FOR EACH ROW
EXECUTE FUNCTION update_notification_timestamp();
