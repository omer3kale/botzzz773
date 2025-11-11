-- Migration: add provider tracking fields to orders
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS provider_cost DECIMAL(10, 4),
    ADD COLUMN IF NOT EXISTS provider_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS last_status_sync TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_orders_provider_order_id ON orders(provider_order_id);
