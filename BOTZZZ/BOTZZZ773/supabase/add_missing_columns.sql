--
-- Add Missing Columns to Services and Orders Tables
-- Run this FIRST before insert_test_services_and_curate.sql
--

BEGIN;

-- ================================================
-- SERVICES TABLE - Add missing columns
-- ================================================

-- Add public_id for human-readable service IDs
ALTER TABLE services ADD COLUMN IF NOT EXISTS public_id VARCHAR(20) UNIQUE;

-- Add admin approval fields
ALTER TABLE services ADD COLUMN IF NOT EXISTS admin_approved BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMP WITH TIME ZONE;

-- Add customer portal fields
ALTER TABLE services ADD COLUMN IF NOT EXISTS customer_portal_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS customer_portal_slot INTEGER;
ALTER TABLE services ADD COLUMN IF NOT EXISTS customer_portal_notes TEXT;

-- Add additional service metadata fields
ALTER TABLE services ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD';
ALTER TABLE services ADD COLUMN IF NOT EXISTS average_time VARCHAR(100);
ALTER TABLE services ADD COLUMN IF NOT EXISTS refill_supported BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS cancel_supported BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS dripfeed_supported BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS subscription_supported BOOLEAN DEFAULT FALSE;

-- Add provider_order_id for orders context (used in some queries)
ALTER TABLE services ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(50);

-- ================================================
-- ORDERS TABLE - Ensure provider_order_id exists
-- ================================================

-- provider_order_id should already exist, but we'll verify
ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(50);

-- Add public_id for human-readable order IDs
ALTER TABLE orders ADD COLUMN IF NOT EXISTS public_id VARCHAR(20) UNIQUE;

-- ================================================
-- PROVIDERS TABLE - Add missing fields
-- ================================================

ALTER TABLE providers ADD COLUMN IF NOT EXISTS health_status VARCHAR(20) DEFAULT 'unknown';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS response_latency_ms INTEGER;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_balance_sync TIMESTAMP WITH TIME ZONE;

-- ================================================
-- CREATE INDEXES for performance
-- ================================================

-- Services indexes
CREATE INDEX IF NOT EXISTS idx_services_provider_service_id ON services(provider_id, provider_service_id);
CREATE INDEX IF NOT EXISTS idx_services_customer_portal ON services(customer_portal_enabled, customer_portal_slot) WHERE customer_portal_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_services_admin_approved ON services(admin_approved) WHERE admin_approved = TRUE;
CREATE INDEX IF NOT EXISTS idx_services_public_id ON services(public_id);

-- Orders indexes
CREATE INDEX IF NOT EXISTS idx_orders_provider_order_id ON orders(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_public_id ON orders(public_id);

-- ================================================
-- GENERATE public_id for existing records
-- ================================================

-- Generate public_id for existing services (SRV-001, SRV-002, etc.)
DO $$
DECLARE
    service_record RECORD;
    counter INT := 1;
BEGIN
    FOR service_record IN 
        SELECT id FROM services WHERE public_id IS NULL ORDER BY created_at ASC
    LOOP
        UPDATE services 
        SET public_id = 'SRV-' || LPAD(counter::TEXT, 5, '0')
        WHERE id = service_record.id;
        counter := counter + 1;
    END LOOP;
    
    RAISE NOTICE 'Generated public_id for % services', counter - 1;
END $$;

-- Generate public_id for existing orders (if order_number doesn't exist)
DO $$
DECLARE
    order_record RECORD;
    counter INT := 1;
BEGIN
    FOR order_record IN 
        SELECT id FROM orders WHERE public_id IS NULL ORDER BY created_at ASC
    LOOP
        UPDATE orders 
        SET public_id = 'ORD-' || LPAD(counter::TEXT, 6, '0')
        WHERE id = order_record.id;
        counter := counter + 1;
    END LOOP;
    
    RAISE NOTICE 'Generated public_id for % orders', counter - 1;
END $$;

COMMIT;

-- Verify the changes
SELECT 
    'Services Table' as table_name,
    COUNT(*) as total_rows,
    COUNT(public_id) as with_public_id,
    COUNT(CASE WHEN admin_approved = TRUE THEN 1 END) as admin_approved,
    COUNT(CASE WHEN customer_portal_enabled = TRUE THEN 1 END) as customer_portal_enabled
FROM services
UNION ALL
SELECT 
    'Orders Table' as table_name,
    COUNT(*) as total_rows,
    COUNT(public_id) as with_public_id,
    NULL as admin_approved,
    NULL as customer_portal_enabled
FROM orders;
