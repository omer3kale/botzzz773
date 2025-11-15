--
-- HOW TO USE
-- 1. Populate the JSON array below with one entry per provider (UUID/name/API URL/API key/markup/currency/limit).
-- 2. Optional: set `provider_service_ref` when you only know a provider_service_id or provider_order_id; the script will resolve the owning provider automatically.
-- 3. Run this entire file once in the Supabase SQL editor; it will iterate over all entries and curate storefront slots.
--
-- FIELD REFERENCE:
--   provider_id_input    : UUID or name/API URL lookup string (leave blank to auto-create)
--   provider_service_ref : provider_service_id or provider_order_id (alternative lookup path)
--   name                 : Provider display name (e.g., "g1618.com", "BestSMM", etc.)
--   api_url              : Provider API endpoint (e.g., "https://g1618.com/api/v2")
--   api_key              : Real API key for the provider
--   markup               : Markup percentage to add to provider rates (default: 20.0)
--   currency             : Currency code (default: "USD")
--   limit                : Number of top services to curate for customer portal (default: 7)

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

        -- Resolve provider UUID from the supplied identifier(s)
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

    -- Guarantee provider metadata aligns with frontend references
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

    -- Surface a summary row for quick verification
    RAISE NOTICE 'Curated storefront slots populated for %, review via: SELECT public_id, name, customer_portal_slot FROM services WHERE customer_portal_enabled = TRUE AND provider_id = % ORDER BY customer_portal_slot;', curated_provider_name, curated_provider;
    END LOOP;
END $$;
