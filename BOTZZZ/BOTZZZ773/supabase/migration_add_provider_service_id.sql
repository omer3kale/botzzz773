-- Migration: Add provider_service_id to services table
-- This field stores the provider's service ID for API integration

DO $$ 
BEGIN
    -- Add provider_service_id column if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'services' 
        AND column_name = 'provider_service_id'
    ) THEN
        ALTER TABLE services 
        ADD COLUMN provider_service_id VARCHAR(50);
        
        RAISE NOTICE 'Added provider_service_id column to services table';
    ELSE
    
        RAISE NOTICE 'provider_service_id column already exists';
    END IF;
    
    -- Create index for faster lookups if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes 
        WHERE indexname = 'idx_services_provider_service_id'
    ) THEN
        CREATE INDEX idx_services_provider_service_id ON services(provider_service_id);
        RAISE NOTICE 'Created index on provider_service_id';
    ELSE
        RAISE NOTICE 'Index on provider_service_id already exists';
    END IF;
END $$;

-- Verify the changes
SELECT 
    column_name, 
    data_type, 
    character_maximum_length,
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'services' 
AND column_name = 'provider_service_id';
