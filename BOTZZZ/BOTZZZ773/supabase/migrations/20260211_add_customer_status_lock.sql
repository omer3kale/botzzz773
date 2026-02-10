ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS customer_status_lock VARCHAR(20),
    ADD COLUMN IF NOT EXISTS customer_status_lock_reason TEXT,
    ADD COLUMN IF NOT EXISTS customer_status_lock_at TIMESTAMPTZ;
