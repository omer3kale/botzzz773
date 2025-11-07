-- Activate All Services Migration
-- This adds the status column if missing and updates all services to active status

DO $$
BEGIN
    -- Add status column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'services' 
        AND column_name = 'status'
    ) THEN
        ALTER TABLE services 
        ADD COLUMN status VARCHAR(20) DEFAULT 'active';
        
        RAISE NOTICE 'Added status column to services table';
    END IF;
    
    -- Update all services to active status
    UPDATE services 
    SET status = 'active' 
    WHERE status IS DISTINCT FROM 'active';
    
    RAISE NOTICE 'Updated all services to active status';
END $$;

-- Verify the update
SELECT 
    COALESCE(status, 'NULL') as status,
    COUNT(*) as count
FROM services
GROUP BY status
ORDER BY status;
