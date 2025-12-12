-- Composite indexes to optimize duplicate link checks
-- Create index on (service_id, link)
CREATE INDEX IF NOT EXISTS idx_orders_service_link ON orders(service_id, link);

-- Create index on (service_id, link, created_at) for time-window queries
CREATE INDEX IF NOT EXISTS idx_orders_service_link_created ON orders(service_id, link, created_at);
