-- =====================================
-- COPY THIS ENTIRE SCRIPT TO SUPABASE SQL EDITOR
-- Script 1 of 2: Main Link Management System
-- =====================================

-- Link Management System Database Schema
-- This script creates the necessary tables and functions to prevent order conflicts

-- Create link_management table to track URLs and their associated orders
CREATE TABLE IF NOT EXISTS link_management (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    url TEXT NOT NULL,
    url_hash TEXT NOT NULL UNIQUE, -- Hash of the URL for efficient lookups
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'conflicted', 'failed', 'merged')),
    primary_service_id UUID REFERENCES services(id),
    total_orders INTEGER DEFAULT 0,
    total_quantity INTEGER DEFAULT 0,
    last_order_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for efficient URL lookups
CREATE INDEX IF NOT EXISTS idx_link_management_url_hash ON link_management(url_hash);
CREATE INDEX IF NOT EXISTS idx_link_management_status ON link_management(status);
CREATE INDEX IF NOT EXISTS idx_link_management_updated_at ON link_management(updated_at);

-- Add link_id to orders table to associate orders with links
ALTER TABLE orders ADD COLUMN IF NOT EXISTS link_id UUID REFERENCES link_management(id);
CREATE INDEX IF NOT EXISTS idx_orders_link_id ON orders(link_id);

-- Create function to generate URL hash
CREATE OR REPLACE FUNCTION generate_url_hash(input_url TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Normalize URL (remove trailing slashes, convert to lowercase, etc.)
    RETURN encode(digest(
        lower(
            regexp_replace(
                regexp_replace(input_url, '^https?://', ''),
                '/$', ''
            )
        ), 'sha256'
    ), 'hex');
END;
$$ LANGUAGE plpgsql;

-- Create function to update link statistics
CREATE OR REPLACE FUNCTION update_link_statistics()
RETURNS TRIGGER AS $$
BEGIN
    -- Update statistics for the affected link
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE link_management 
        SET 
            total_orders = (
                SELECT COUNT(*) 
                FROM orders 
                WHERE link_id = NEW.link_id
            ),
            total_quantity = (
                SELECT COALESCE(SUM(quantity), 0) 
                FROM orders 
                WHERE link_id = NEW.link_id
            ),
            last_order_at = (
                SELECT MAX(created_at) 
                FROM orders 
                WHERE link_id = NEW.link_id
            ),
            updated_at = NOW()
        WHERE id = NEW.link_id;
    END IF;
    
    IF TG_OP = 'DELETE' THEN
        UPDATE link_management 
        SET 
            total_orders = (
                SELECT COUNT(*) 
                FROM orders 
                WHERE link_id = OLD.link_id
            ),
            total_quantity = (
                SELECT COALESCE(SUM(quantity), 0) 
                FROM orders 
                WHERE link_id = OLD.link_id
            ),
            last_order_at = (
                SELECT MAX(created_at) 
                FROM orders 
                WHERE link_id = OLD.link_id
            ),
            updated_at = NOW()
        WHERE id = OLD.link_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update link statistics
DROP TRIGGER IF EXISTS trigger_update_link_statistics ON orders;
CREATE TRIGGER trigger_update_link_statistics
    AFTER INSERT OR UPDATE OR DELETE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_link_statistics();

-- Create function to detect and mark conflicts
CREATE OR REPLACE FUNCTION detect_link_conflicts()
RETURNS INTEGER AS $$
DECLARE
    conflict_count INTEGER := 0;
BEGIN
    -- Mark links as conflicted if they have multiple active orders for the same service
    UPDATE link_management 
    SET status = 'conflicted', updated_at = NOW()
    WHERE id IN (
        SELECT DISTINCT link_id
        FROM orders o1
        WHERE EXISTS (
            SELECT 1 
            FROM orders o2 
            WHERE o2.link_id = o1.link_id 
            AND o2.service_id = o1.service_id
            AND o2.id != o1.id
            AND o2.status IN ('pending', 'in_progress', 'processing')
            AND o1.status IN ('pending', 'in_progress', 'processing')
        )
        AND link_id IS NOT NULL
    );
    
    GET DIAGNOSTICS conflict_count = ROW_COUNT;
    RETURN conflict_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to find or create link record
CREATE OR REPLACE FUNCTION find_or_create_link(input_url TEXT, service_id UUID)
RETURNS UUID AS $$
DECLARE
    url_hash_value TEXT;
    link_id UUID;
    existing_orders INTEGER;
BEGIN
    -- Generate hash for the URL
    url_hash_value := generate_url_hash(input_url);
    
    -- Try to find existing link
    SELECT id INTO link_id 
    FROM link_management 
    WHERE url_hash = url_hash_value;
    
    -- If not found, create new link record
    IF link_id IS NULL THEN
        INSERT INTO link_management (url, url_hash, primary_service_id)
        VALUES (input_url, url_hash_value, service_id)
        RETURNING id INTO link_id;
    END IF;
    
    -- Check for potential conflicts
    SELECT COUNT(*) INTO existing_orders
    FROM orders 
    WHERE link_id = link_id 
    AND service_id = service_id
    AND status IN ('pending', 'in_progress', 'processing');
    
    -- Mark as conflicted if there are existing active orders for the same service
    IF existing_orders > 0 THEN
        UPDATE link_management 
        SET status = 'conflicted', updated_at = NOW()
        WHERE id = link_id;
    END IF;
    
    RETURN link_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to merge duplicate orders for a link
CREATE OR REPLACE FUNCTION merge_link_orders(target_link_id UUID)
RETURNS TEXT AS $$
DECLARE
    merged_count INTEGER := 0;
    order_rec RECORD;
    primary_order_id INTEGER;
    total_quantity INTEGER := 0;
BEGIN
    -- For each service type, merge orders
    FOR order_rec IN 
        SELECT service_id, COUNT(*) as order_count, SUM(quantity) as total_qty
        FROM orders 
        WHERE link_id = target_link_id
        GROUP BY service_id
        HAVING COUNT(*) > 1
    LOOP
        -- Find the primary order (most recent successful one, or earliest if none successful)
        SELECT id INTO primary_order_id
        FROM orders 
        WHERE link_id = target_link_id AND service_id = order_rec.service_id
        ORDER BY 
            CASE WHEN status = 'completed' THEN 1 ELSE 2 END,
            created_at DESC
        LIMIT 1;
        
        -- Update the primary order with combined quantity
        UPDATE orders 
        SET 
            quantity = order_rec.total_qty,
            notes = COALESCE(notes, '') || ' [MERGED ORDER - Combined from ' || order_rec.order_count || ' orders]',
            updated_at = NOW()
        WHERE id = primary_order_id;
        
        -- Cancel or delete the duplicate orders
        UPDATE orders 
        SET 
            status = 'cancelled',
            notes = COALESCE(notes, '') || ' [CANCELLED - Merged into order #' || primary_order_id || ']',
            updated_at = NOW()
        WHERE link_id = target_link_id 
        AND service_id = order_rec.service_id
        AND id != primary_order_id;
        
        merged_count := merged_count + (order_rec.order_count - 1);
    END LOOP;
    
    -- Update link status
    UPDATE link_management 
    SET 
        status = CASE WHEN merged_count > 0 THEN 'active' ELSE status END,
        updated_at = NOW()
    WHERE id = target_link_id;
    
    RETURN 'Merged ' || merged_count || ' duplicate orders';
END;
$$ LANGUAGE plpgsql;

-- Create view for link management dashboard
CREATE OR REPLACE VIEW link_management_dashboard AS
SELECT 
    lm.id,
    lm.url,
    lm.status,
    lm.total_orders,
    lm.total_quantity,
    lm.last_order_at,
    lm.created_at,
    lm.updated_at,
    s.name as primary_service_name,
    json_agg(
        json_build_object(
            'id', o.id,
            'service_id', o.service_id,
            'service_name', os.name,
            'provider_name', p.name,
            'quantity', o.quantity,
            'status', o.status,
            'external_id', o.external_id,
            'created_at', o.created_at
        ) ORDER BY o.created_at DESC
    ) as orders
FROM link_management lm
LEFT JOIN services s ON lm.primary_service_id = s.id
LEFT JOIN orders o ON lm.id = o.link_id
LEFT JOIN services os ON o.service_id = os.id
LEFT JOIN providers p ON os.provider_id = p.id
GROUP BY lm.id, lm.url, lm.status, lm.total_orders, lm.total_quantity, 
         lm.last_order_at, lm.created_at, lm.updated_at, s.name;

-- Create RLS policies for link_management table
ALTER TABLE link_management ENABLE ROW LEVEL SECURITY;

-- Admin access policy
CREATE POLICY "Admin full access to link_management" ON link_management
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_link_management_created_at ON link_management(created_at);
CREATE INDEX IF NOT EXISTS idx_link_management_service_id ON link_management(primary_service_id);

-- Initial data migration: populate link_management for existing orders
INSERT INTO link_management (url, url_hash, primary_service_id, created_at, updated_at)
SELECT DISTINCT 
    o.link as url,
    generate_url_hash(o.link) as url_hash,
    o.service_id as primary_service_id,
    MIN(o.created_at) as created_at,
    MAX(o.updated_at) as updated_at
FROM orders o
WHERE o.link IS NOT NULL 
AND o.link != ''
AND NOT EXISTS (
    SELECT 1 FROM link_management lm 
    WHERE lm.url_hash = generate_url_hash(o.link)
)
GROUP BY o.link, o.service_id;

-- Update existing orders with link_id
UPDATE orders 
SET link_id = lm.id
FROM link_management lm
WHERE orders.link IS NOT NULL 
AND orders.link != ''
AND lm.url_hash = generate_url_hash(orders.link)
AND orders.link_id IS NULL;

-- Run initial conflict detection
SELECT detect_link_conflicts();

-- =====================================
-- END OF SCRIPT 1
-- Run this first, then proceed to Script 2
-- =====================================