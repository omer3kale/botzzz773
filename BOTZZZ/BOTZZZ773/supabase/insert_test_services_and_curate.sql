--
-- PRODUCTION-READY: Insert Test Services and Enable for Customer Portal
-- 
-- PREREQUISITES (Run in order):
-- 1. add_missing_columns.sql - Adds all required columns to services/orders/providers tables
-- 2. Then run this file in Supabase SQL Editor
--
-- What this does:
-- 1. Cleans up any duplicate services
-- 2. Creates the unique constraint on services table (if not exists)
-- 3. Inserts 7 admin-approved test services for g1618.com
-- 4. Runs the curation script to enable them for customer portal
-- 5. Assigns them slots 1-7 in the customer storefront
--

BEGIN;

-- Step 0: Clean up duplicate services and create unique constraint
DO $$ 
DECLARE
    duplicate_count INT;
BEGIN
    -- First, find and log duplicates
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
    
    -- Now create the unique constraint if it doesn't exist
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

-- Step 1: Insert 7 admin-approved test services
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

-- Step 2: Run the curation script to enable these services for customer portal
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

        IF provider_id_input IS NULL
           AND provider_service_ref IS NULL
           AND curated_provider_name IS NULL
           AND curated_provider_api_url IS NULL THEN
            RAISE NOTICE 'Skipping empty provider_config entry.';
            CONTINUE;
        END IF;

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

        IF curated_provider IS NULL THEN
            SELECT provider_id INTO curated_provider
            FROM services
            WHERE provider_service_id = COALESCE(provider_service_ref, provider_id_input)
               OR provider_order_id = COALESCE(provider_service_ref, provider_id_input)
            LIMIT 1;
        END IF;

        IF curated_provider IS NULL THEN
            SELECT id INTO curated_provider
            FROM providers
            WHERE (curated_provider_name IS NOT NULL AND LOWER(name) = LOWER(curated_provider_name))
               OR (curated_provider_api_url IS NOT NULL AND LOWER(api_url) = LOWER(curated_provider_api_url))
            LIMIT 1;
        END IF;

        IF curated_provider IS NULL THEN
            IF curated_provider_name IS NOT NULL AND curated_provider_api_url IS NOT NULL THEN
                curated_provider := gen_random_uuid();
                RAISE NOTICE 'No existing provider matched; creating % (%).', curated_provider_name, curated_provider;
            ELSE
                RAISE EXCEPTION 'Unable to resolve provider. Update provider_config entry with UUID/name/API URL or a provider_service_ref value.';
            END IF;
        END IF;

        IF curated_provider_name IS NULL THEN
            RAISE EXCEPTION 'Set provider name in configuration block.';
        END IF;

        IF curated_provider_api_url IS NULL THEN
            RAISE EXCEPTION 'Set provider API URL in configuration block.';
        END IF;

        IF curated_provider_api_key IS NULL THEN
            RAISE EXCEPTION 'Set provider API key in configuration block.';
        END IF;

        IF curated_limit <= 0 THEN
            RAISE EXCEPTION 'Curated limit must be greater than zero.';
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

        -- Remove leftover flags from services that lost their curated status
        UPDATE services
        SET
            customer_portal_enabled = FALSE,
            customer_portal_slot = NULL,
            customer_portal_notes = 'Removed from storefront rotation '
                || TO_CHAR(NOW(), 'YYYY-MM-DD'),
            updated_at = NOW()
        WHERE customer_portal_enabled = TRUE
            AND provider_id = curated_provider
          AND id NOT IN (
              SELECT id FROM services
              WHERE provider_id = curated_provider
                AND customer_portal_enabled = TRUE
          );

        -- Surface a summary
        RAISE NOTICE 'Curated storefront slots populated for %, review via: SELECT public_id, name, customer_portal_slot FROM services WHERE customer_portal_enabled = TRUE AND provider_id = % ORDER BY customer_portal_slot;', curated_provider_name, curated_provider;
    END LOOP;
END $$;

COMMIT;

-- Verification Query - Run this after to confirm success
SELECT 
    public_id,
    name,
    category,
    rate,
    customer_portal_slot,
    customer_portal_enabled,
    admin_approved
FROM services 
WHERE provider_id = 'e1189c5b-079e-4a4f-9279-8a2f6e384300'
  AND customer_portal_enabled = TRUE
ORDER BY customer_portal_slot;
