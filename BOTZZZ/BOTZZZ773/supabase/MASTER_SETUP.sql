--
-- MASTER SETUP: Complete Production Database Setup
-- 
-- This file runs everything you need in the correct order.
-- Copy and paste this ENTIRE file into Supabase SQL Editor and click RUN.
--
-- What this does:
-- 1. Adds all missing columns to services/orders/providers tables
-- 2. Cleans up duplicate services
-- 3. Creates unique constraints
-- 4. Inserts 7 test services from g1618.com
-- 5. Enables them for customer portal (slots 1-7)
--

-- ================================================
-- STEP 1: Add Missing Columns
-- ================================================

BEGIN;

-- Services table columns
ALTER TABLE services ADD COLUMN IF NOT EXISTS public_id VARCHAR(20) UNIQUE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS admin_approved BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS admin_approved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS customer_portal_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS customer_portal_slot INTEGER;
ALTER TABLE services ADD COLUMN IF NOT EXISTS customer_portal_notes TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD';
ALTER TABLE services ADD COLUMN IF NOT EXISTS average_time VARCHAR(100);
ALTER TABLE services ADD COLUMN IF NOT EXISTS refill_supported BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS cancel_supported BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS dripfeed_supported BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS subscription_supported BOOLEAN DEFAULT FALSE;
ALTER TABLE services ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(50);

-- Orders table columns
ALTER TABLE orders ADD COLUMN IF NOT EXISTS provider_order_id VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS public_id VARCHAR(20) UNIQUE;

-- Providers table columns
ALTER TABLE providers ADD COLUMN IF NOT EXISTS health_status VARCHAR(20) DEFAULT 'unknown';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'USD';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS response_latency_ms INTEGER;
ALTER TABLE providers ADD COLUMN IF NOT EXISTS last_balance_sync TIMESTAMP WITH TIME ZONE;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_services_provider_service_id ON services(provider_id, provider_service_id);
CREATE INDEX IF NOT EXISTS idx_services_customer_portal ON services(customer_portal_enabled, customer_portal_slot) WHERE customer_portal_enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_services_admin_approved ON services(admin_approved) WHERE admin_approved = TRUE;
CREATE INDEX IF NOT EXISTS idx_services_public_id ON services(public_id);
CREATE INDEX IF NOT EXISTS idx_orders_provider_order_id ON orders(provider_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_public_id ON orders(public_id);

COMMIT;

DO $$ BEGIN RAISE NOTICE '✅ Step 1 Complete: Added missing columns and indexes'; END $$;

-- ================================================
-- STEP 2: Clean Duplicates & Create Constraint
-- ================================================

BEGIN;

DO $$ 
DECLARE
    duplicate_count INT;
BEGIN
    -- Find and log duplicates
    SELECT COUNT(*) INTO duplicate_count
    FROM (
        SELECT provider_id, provider_service_id, COUNT(*) as cnt
        FROM services
        WHERE provider_service_id IS NOT NULL
        GROUP BY provider_id, provider_service_id
        HAVING COUNT(*) > 1
    ) duplicates;
    
    IF duplicate_count > 0 THEN
        RAISE NOTICE 'Found % duplicate provider_service_id combinations. Cleaning up...', duplicate_count;
        
        -- Delete duplicates, keeping only the most recently updated one
        DELETE FROM services
        WHERE id IN (
            SELECT id
            FROM (
                SELECT 
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY provider_id, provider_service_id 
                        ORDER BY updated_at DESC, created_at DESC
                    ) as rn
                FROM services
                WHERE provider_service_id IS NOT NULL
            ) ranked
            WHERE rn > 1
        );
        
        RAISE NOTICE 'Cleaned up duplicate services. Keeping most recent entries.';
    ELSE
        RAISE NOTICE 'No duplicates found.';
    END IF;
    
    -- Create the unique constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_constraint 
        WHERE conname = 'services_provider_service_unique'
    ) THEN
        ALTER TABLE services 
        ADD CONSTRAINT services_provider_service_unique 
        UNIQUE (provider_id, provider_service_id);
        
        RAISE NOTICE 'Created unique constraint: services_provider_service_unique';
    ELSE
        RAISE NOTICE 'Unique constraint already exists: services_provider_service_unique';
    END IF;
END $$;

COMMIT;

DO $$ BEGIN RAISE NOTICE '✅ Step 2 Complete: Cleaned duplicates and created constraints'; END $$;

-- ================================================
-- STEP 3: Insert Test Services
-- ================================================

BEGIN;

INSERT INTO services (
    id,
    provider_id,
    name,
    category,
    rate,
    min_quantity,
    max_quantity,
    description,
    status,
    provider_service_id,
    admin_approved,
    admin_approved_at,
    currency,
    average_time,
    refill_supported,
    cancel_supported,
    dripfeed_supported,
    subscription_supported,
    created_at,
    updated_at
)
VALUES 
    (gen_random_uuid(), 'e1189c5b-079e-4a4f-9279-8a2f6e384300', 'Instagram Followers - High Quality', 'instagram', 0.50, 100, 10000, 'Premium Instagram followers from real accounts with profile pictures and posts', 'active', 'IG-FOLLOW-HQ-001', TRUE, NOW(), 'USD', '24-48 hours', true, false, true, false, NOW(), NOW()),
    (gen_random_uuid(), 'e1189c5b-079e-4a4f-9279-8a2f6e384300', 'Instagram Likes - Fast Delivery', 'instagram', 0.30, 50, 5000, 'Fast Instagram likes delivery within 1-2 hours from active accounts', 'active', 'IG-LIKES-FAST-001', TRUE, NOW(), 'USD', '1-2 hours', false, true, false, false, NOW(), NOW()),
    (gen_random_uuid(), 'e1189c5b-079e-4a4f-9279-8a2f6e384300', 'TikTok Followers - Real Users', 'tiktok', 0.75, 100, 20000, 'Organic TikTok followers from active users, non-drop guarantee', 'active', 'TT-FOLLOW-REAL-001', TRUE, NOW(), 'USD', '12-24 hours', true, false, true, false, NOW(), NOW()),
    (gen_random_uuid(), 'e1189c5b-079e-4a4f-9279-8a2f6e384300', 'YouTube Views - Non Drop', 'youtube', 0.40, 1000, 100000, 'Permanent YouTube views from real viewers, guaranteed no drop', 'active', 'YT-VIEWS-ND-001', TRUE, NOW(), 'USD', '24-72 hours', true, false, false, false, NOW(), NOW()),
    (gen_random_uuid(), 'e1189c5b-079e-4a4f-9279-8a2f6e384300', 'Facebook Page Likes', 'facebook', 0.60, 100, 10000, 'Real Facebook page likes from active profiles with complete information', 'active', 'FB-LIKES-PAGE-001', TRUE, NOW(), 'USD', '6-12 hours', false, true, false, false, NOW(), NOW()),
    (gen_random_uuid(), 'e1189c5b-079e-4a4f-9279-8a2f6e384300', 'Twitter Followers - Active', 'twitter', 0.55, 50, 5000, 'Active Twitter followers with profile pictures and tweets', 'active', 'TW-FOLLOW-ACT-001', TRUE, NOW(), 'USD', '12-24 hours', true, true, false, false, NOW(), NOW()),
    (gen_random_uuid(), 'e1189c5b-079e-4a4f-9279-8a2f6e384300', 'Spotify Plays - Real Listeners', 'spotify', 0.35, 1000, 50000, 'Real Spotify plays from genuine listeners, improves algorithm ranking', 'active', 'SP-PLAYS-REAL-001', TRUE, NOW(), 'USD', '24-48 hours', false, false, true, false, NOW(), NOW())
ON CONFLICT (provider_id, provider_service_id) DO UPDATE
SET
    name = EXCLUDED.name,
    category = EXCLUDED.category,
    rate = EXCLUDED.rate,
    min_quantity = EXCLUDED.min_quantity,
    max_quantity = EXCLUDED.max_quantity,
    description = EXCLUDED.description,
    status = EXCLUDED.status,
    admin_approved = EXCLUDED.admin_approved,
    admin_approved_at = EXCLUDED.admin_approved_at,
    currency = EXCLUDED.currency,
    average_time = EXCLUDED.average_time,
    refill_supported = EXCLUDED.refill_supported,
    cancel_supported = EXCLUDED.cancel_supported,
    dripfeed_supported = EXCLUDED.dripfeed_supported,
    subscription_supported = EXCLUDED.subscription_supported,
    updated_at = NOW();

COMMIT;

DO $$ BEGIN RAISE NOTICE '✅ Step 3 Complete: Inserted 7 test services'; END $$;

-- ================================================
-- STEP 4: Run Curation Script
-- ================================================

BEGIN;

DO $$
DECLARE
    provider_record JSONB;
    curated_provider UUID;
    provider_id_input TEXT;
    provider_service_ref TEXT;
    curated_provider_name TEXT;
    curated_provider_api_url TEXT;
    curated_provider_api_key TEXT;
    curated_provider_markup NUMERIC;
    curated_provider_currency TEXT;
    curated_limit INT;
BEGIN
    FOR provider_record IN
        SELECT jsonb_array_elements(
            '[
                {
                    "provider_id_input": "e1189c5b-079e-4a4f-9279-8a2f6e384300",
                    "provider_service_ref": "",
                    "name": "g1618.com",
                    "api_url": "https://g1618.com/api/v2",
                    "api_key": "b552bb05450f180977b41771ba844b98",
                    "markup": 20.0,
                    "currency": "USD",
                    "limit": 7
                }
            ]'::jsonb
        ) AS config
    LOOP
        curated_provider := NULL;
        provider_id_input := NULLIF(btrim((provider_record->>'provider_id_input')), '');
        provider_service_ref := NULLIF(btrim((provider_record->>'provider_service_ref')), '');
        curated_provider_name := NULLIF(btrim((provider_record->>'name')), '');
        curated_provider_api_url := NULLIF(btrim((provider_record->>'api_url')), '');
        curated_provider_api_key := NULLIF(btrim((provider_record->>'api_key')), '');
        curated_provider_markup := COALESCE(NULLIF(provider_record->>'markup', '')::NUMERIC, 20.0);
        curated_provider_currency := COALESCE(NULLIF(btrim(provider_record->>'currency'), ''), 'USD');
        curated_limit := COALESCE(NULLIF(provider_record->>'limit', '')::INT, 7);

        -- Resolve provider UUID
        IF provider_id_input IS NOT NULL THEN
            BEGIN
                curated_provider := provider_id_input::uuid;
            EXCEPTION WHEN invalid_text_representation THEN
                curated_provider := NULL;
            END;

            IF curated_provider IS NULL THEN
                SELECT id INTO curated_provider
                FROM providers
                WHERE id::text = provider_id_input
                   OR LOWER(name) = LOWER(provider_id_input)
                   OR LOWER(api_url) = LOWER(provider_id_input)
                LIMIT 1;
            END IF;
        END IF;

        IF curated_provider IS NULL AND curated_provider_name IS NOT NULL AND curated_provider_api_url IS NOT NULL THEN
            curated_provider := gen_random_uuid();
            RAISE NOTICE 'No existing provider matched; creating % (%).', curated_provider_name, curated_provider;
        END IF;

        -- Update provider metadata
        INSERT INTO providers (
            id, 
            name, 
            api_url, 
            api_key, 
            status, 
            markup, 
            currency, 
            health_status, 
            balance,
            services_count,
            response_latency_ms,
            last_balance_sync,
            last_sync,
            updated_at,
            created_at
        )
        VALUES (
            curated_provider,
            curated_provider_name,
            curated_provider_api_url,
            curated_provider_api_key,
            'active',
            curated_provider_markup,
            curated_provider_currency,
            'healthy',
            0.00,
            0,
            NULL,
            NULL,
            NULL,
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE
        SET
            name = EXCLUDED.name,
            api_url = EXCLUDED.api_url,
            api_key = curated_provider_api_key,
            status = 'active',
            markup = curated_provider_markup,
            currency = curated_provider_currency,
            health_status = 'healthy',
            updated_at = NOW();

        -- Auto-select only admin-approved services (prioritize existing portal slot order)
        WITH ranked AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    ORDER BY
                        COALESCE(customer_portal_slot, 32767) ASC,
                        name ASC
                ) AS slot
            FROM services
            WHERE provider_id = curated_provider
              AND status = 'active'
              AND admin_approved IS TRUE
        ),
        curated AS (
            SELECT id, slot
            FROM ranked
            WHERE slot <= curated_limit
        )
        UPDATE services AS svc
        SET
            customer_portal_enabled = TRUE,
            customer_portal_slot = curated.slot,
            admin_approved_at = COALESCE(admin_approved_at, NOW()),
            customer_portal_notes = CONCAT('Auto-curated slot ', curated.slot, ' on ', TO_CHAR(NOW(), 'YYYY-MM-DD')),
            updated_at = NOW()
        FROM curated
        WHERE svc.id = curated.id;

        RAISE NOTICE '✅ Curated storefront slots populated for %', curated_provider_name;
    END LOOP;
END $$;

COMMIT;

DO $$ BEGIN RAISE NOTICE '✅ Step 4 Complete: Enabled services for customer portal'; END $$;

-- ================================================
-- FINAL VERIFICATION
-- ================================================

SELECT 
    public_id,
    name,
    category,
    rate,
    customer_portal_slot,
    customer_portal_enabled,
    admin_approved,
    provider_service_id
FROM services 
WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
  AND customer_portal_enabled = TRUE
ORDER BY customer_portal_slot;

-- ✅ ALL DONE! Your 7 test services are now live on the customer portal.
