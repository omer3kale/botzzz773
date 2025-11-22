-- =====================================
-- COPY THIS ENTIRE SCRIPT TO SUPABASE SQL EDITOR
-- MIGRATION SCRIPT: Complete Link Management System (FINAL VERSION)
-- =====================================

-- Create link_management table to track URLs and their associated orders
CREATE TABLE IF NOT EXISTS link_management (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    url TEXT NOT NULL,
    url_hash TEXT NOT NULL UNIQUE,
    primary_service_id UUID REFERENCES services(id),
    service_name TEXT,
    total_orders INTEGER DEFAULT 0,
    total_quantity INTEGER DEFAULT 0,
    cumulative_quantity INTEGER DEFAULT 0,
    last_order_id UUID,
    last_order_at TIMESTAMP WITH TIME ZONE,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'conflicted', 'merged')),
    conflict_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_link_management_url_hash ON link_management(url_hash);
CREATE INDEX IF NOT EXISTS idx_link_management_status ON link_management(status);
CREATE INDEX IF NOT EXISTS idx_link_management_updated_at ON link_management(updated_at);
CREATE INDEX IF NOT EXISTS idx_link_management_service_id ON link_management(primary_service_id);

-- Add link_id column to orders table to track which link each order belongs to
ALTER TABLE orders ADD COLUMN IF NOT EXISTS link_id UUID REFERENCES link_management(id);
CREATE INDEX IF NOT EXISTS idx_orders_link_id ON orders(link_id);

-- Create function to find or create a link record
CREATE OR REPLACE FUNCTION find_or_create_link(input_url TEXT, input_service_id UUID)
RETURNS UUID AS $$
DECLARE
    link_record RECORD;
    url_hash_value TEXT;
    service_record RECORD;
BEGIN
    -- Generate hash for the URL
    url_hash_value := encode(digest(input_url, 'sha256'), 'hex');
    
    -- Get service information
    SELECT id, name INTO service_record FROM services WHERE id = input_service_id;
    
    -- Try to find existing link
    SELECT * INTO link_record FROM link_management WHERE url_hash = url_hash_value;
    
    IF FOUND THEN
        -- Check for service conflicts
        IF link_record.primary_service_id != input_service_id THEN
            -- Update conflict status
            UPDATE link_management 
            SET status = 'conflicted',
                conflict_reason = 'Multiple services for same URL: ' || service_record.name || ' vs ' || link_record.service_name,
                updated_at = NOW()
            WHERE id = link_record.id;
        ELSE
            -- Update counters
            UPDATE link_management 
            SET total_orders = total_orders + 1,
                updated_at = NOW()
            WHERE id = link_record.id;
        END IF;
        
        RETURN link_record.id;
    ELSE
        -- Create new link record
        INSERT INTO link_management (url, url_hash, primary_service_id, service_name, total_orders)
        VALUES (input_url, url_hash_value, input_service_id, service_record.name, 1)
        RETURNING id INTO link_record;
        
        RETURN link_record.id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create function to merge orders from duplicate links
CREATE OR REPLACE FUNCTION merge_link_orders(target_link_id UUID)
RETURNS JSON AS $$
DECLARE
    result JSON;
    merged_count INTEGER := 0;
    target_url_hash TEXT;
BEGIN
    -- Get the URL hash of the target link
    SELECT url_hash INTO target_url_hash FROM link_management WHERE id = target_link_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Target link not found');
    END IF;
    
    -- Update all orders pointing to conflicted links to point to the target link
    WITH conflicted_links AS (
        SELECT id FROM link_management 
        WHERE url_hash = target_url_hash
        AND id != target_link_id
    )
    UPDATE orders 
    SET link_id = target_link_id
    WHERE link_id IN (SELECT id FROM conflicted_links);
    
    GET DIAGNOSTICS merged_count = ROW_COUNT;
    
    -- Update target link statistics
    UPDATE link_management 
    SET total_orders = (
        SELECT COUNT(*) FROM orders WHERE link_id = target_link_id
    ),
    total_quantity = (
        SELECT COALESCE(SUM(quantity), 0) FROM orders WHERE link_id = target_link_id
    ),
    cumulative_quantity = (
        SELECT COALESCE(SUM(quantity), 0) FROM orders 
        WHERE link_id = target_link_id AND status IN ('completed', 'partial')
    ),
    last_order_at = (
        SELECT MAX(created_at) FROM orders WHERE link_id = target_link_id
    ),
    status = 'active',
    conflict_reason = NULL,
    updated_at = NOW()
    WHERE id = target_link_id;
    
    -- Delete the now-empty conflicted link records
    DELETE FROM link_management 
    WHERE url_hash = target_url_hash
    AND id != target_link_id
    AND total_orders = 0;
    
    -- Mark remaining conflicted links as merged
    UPDATE link_management 
    SET status = 'merged',
        updated_at = NOW()
    WHERE url_hash = target_url_hash
    AND id != target_link_id;
    
    SELECT json_build_object(
        'success', true,
        'merged_orders', merged_count,
        'target_link_id', target_link_id
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update link statistics when orders change
CREATE OR REPLACE FUNCTION update_link_statistics()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.link_id IS NOT NULL THEN
        -- New order added
        UPDATE link_management 
        SET total_orders = total_orders + 1,
            total_quantity = total_quantity + NEW.quantity,
            last_order_id = NEW.id,
            last_order_at = NEW.created_at,
            updated_at = NOW()
        WHERE id = NEW.link_id;
        
        -- Update cumulative quantity if order is completed
        IF NEW.status IN ('completed', 'partial') THEN
            UPDATE link_management 
            SET cumulative_quantity = cumulative_quantity + NEW.quantity
            WHERE id = NEW.link_id;
        END IF;
        
    ELSIF TG_OP = 'UPDATE' AND NEW.link_id IS NOT NULL THEN
        -- Order status changed
        IF OLD.status != NEW.status AND NEW.status IN ('completed', 'partial') AND OLD.status NOT IN ('completed', 'partial') THEN
            -- Order became completed
            UPDATE link_management 
            SET cumulative_quantity = cumulative_quantity + NEW.quantity,
                updated_at = NOW()
            WHERE id = NEW.link_id;
        ELSIF OLD.status IN ('completed', 'partial') AND NEW.status NOT IN ('completed', 'partial') THEN
            -- Order became not completed
            UPDATE link_management 
            SET cumulative_quantity = cumulative_quantity - OLD.quantity,
                updated_at = NOW()
            WHERE id = NEW.link_id;
        END IF;
        
    ELSIF TG_OP = 'DELETE' AND OLD.link_id IS NOT NULL THEN
        -- Order deleted
        UPDATE link_management 
        SET total_orders = GREATEST(total_orders - 1, 0),
            total_quantity = GREATEST(total_quantity - OLD.quantity, 0),
            updated_at = NOW()
        WHERE id = OLD.link_id;
        
        -- Update cumulative quantity if order was completed
        IF OLD.status IN ('completed', 'partial') THEN
            UPDATE link_management 
            SET cumulative_quantity = GREATEST(cumulative_quantity - OLD.quantity, 0)
            WHERE id = OLD.link_id;
        END IF;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger on orders table
DROP TRIGGER IF EXISTS trigger_update_link_statistics ON orders;
CREATE TRIGGER trigger_update_link_statistics
    AFTER INSERT OR UPDATE OR DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_link_statistics();

-- Drop existing view if it exists to avoid column naming conflicts
DROP VIEW IF EXISTS link_management_dashboard;

-- Create view for link management dashboard with FIXED column references
CREATE VIEW link_management_dashboard AS
SELECT 
    lm.id,
    lm.url,
    lm.service_name,
    lm.total_orders as order_count,
    lm.total_quantity,
    lm.cumulative_quantity,
    lm.status,
    lm.conflict_reason,
    lm.last_order_at as last_order_date,
    lm.created_at,
    lm.updated_at,
    s.name as primary_service_name,
    COALESCE(
        (SELECT json_agg(
            json_build_object(
                'id', o.id,
                'service_id', o.service_id,
                'service_name', os.name,
                'provider_name', p.name,
                'quantity', o.quantity,
                'status', o.status,
                'provider_order_id', o.provider_order_id,
                'external_order_id', o.external_order_id,
                'order_number', o.order_number,
                'link', o.link,
                'charge', o.charge,
                'remains', o.remains,
                'start_count', o.start_count,
                'created_at', o.created_at,
                'updated_at', o.updated_at
            ) ORDER BY o.created_at DESC
        )
        FROM orders o
        LEFT JOIN services os ON o.service_id = os.id
        LEFT JOIN providers p ON os.provider_id = p.id
        WHERE o.link_id = lm.id),
        '[]'::json
    ) as orders
FROM link_management lm
LEFT JOIN services s ON lm.primary_service_id = s.id
ORDER BY lm.updated_at DESC;

ALTER TABLE link_management ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if already defined to avoid duplication errors
DROP POLICY IF EXISTS "Admin full access to link_management" ON link_management;

-- Allow admin users full access to link_management
CREATE POLICY "Admin full access to link_management" ON link_management
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users 
            WHERE users.id = auth.uid() 
            AND users.role = 'admin'
        )
    );

-- Create function to get link management statistics (needed for dashboard)
CREATE OR REPLACE FUNCTION get_link_management_stats()
RETURNS JSON AS $$
DECLARE
    stats JSON;
BEGIN
    SELECT json_build_object(
        'totalLinks', (SELECT COUNT(*) FROM link_management),
        'conflictedLinks', (SELECT COUNT(*) FROM link_management WHERE status = 'conflicted'),
        'activeLinks', (SELECT COUNT(*) FROM link_management WHERE status = 'active'),
        'totalOrders', (SELECT COALESCE(SUM(total_orders), 0) FROM link_management),
        'totalQuantity', (SELECT COALESCE(SUM(total_quantity), 0) FROM link_management),
        'failedOrders', (
            SELECT COUNT(*) 
            FROM orders o 
            JOIN link_management lm ON o.link_id = lm.id 
            WHERE o.status = 'failed'
        )
    ) INTO stats;
    
    RETURN stats;
END;
$$ LANGUAGE plpgsql;

-- =====================================
-- END OF COMPLETE MIGRATION SCRIPT
-- Migration Complete!
-- =====================================