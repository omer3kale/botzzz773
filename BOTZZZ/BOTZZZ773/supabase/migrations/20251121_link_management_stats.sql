-- Additional functions for link management statistics

-- Create function to get link management statistics
CREATE OR REPLACE FUNCTION get_link_management_stats()
RETURNS JSON AS $$
DECLARE
    stats JSON;
BEGIN
    SELECT json_build_object(
        'totalLinks', (SELECT COUNT(*) FROM link_management),
        'conflictedLinks', (SELECT COUNT(*) FROM link_management WHERE status = 'conflicted'),
        'totalOrders', (SELECT COALESCE(SUM(total_orders), 0) FROM link_management),
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