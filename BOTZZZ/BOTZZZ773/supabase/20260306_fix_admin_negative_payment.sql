-- Fix: Admin negative balance adjustments should NOT trigger refund ledger sync
-- The trigger was firing for ALL negative amounts, including admin manual adjustments
-- This caused FK constraint errors because admin adjustments aren't real refunds

CREATE OR REPLACE FUNCTION sync_refund_from_payment()
RETURNS TRIGGER AS $$
DECLARE
    target_order_id UUID;
    effective_amount DECIMAL(10, 2);
    fallback_code TEXT;
BEGIN
    -- Skip non-refund positive payments
    IF NEW.method <> 'refund' AND COALESCE(NEW.amount, 0) >= 0 THEN
        RETURN NEW;
    END IF;

    -- Skip admin manual balance adjustments (negative payments added via admin panel)
    IF NEW.gateway_response IS NOT NULL AND (NEW.gateway_response->>'is_admin_adjustment')::BOOLEAN IS TRUE THEN
        RETURN NEW;
    END IF;

    effective_amount := ABS(COALESCE(NEW.amount, 0));
    IF effective_amount = 0 THEN
        RETURN NEW;
    END IF;

    target_order_id := NEW.order_id;
    IF target_order_id IS NULL AND NEW.gateway_response ? 'order_id' THEN
        BEGIN
            target_order_id := (NEW.gateway_response->>'order_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            target_order_id := NULL;
        END;
    END IF;

    fallback_code := COALESCE(
        NULLIF(NEW.transaction_id, ''),
        'refund_' || REPLACE(uuid_generate_v4()::TEXT, '-', '')
    );

    INSERT INTO refunds (
        refund_code,
        order_id,
        user_id,
        payment_id,
        amount,
        status,
        reason,
        source,
        metadata,
        processed_at
    )
    VALUES (
        fallback_code,
        target_order_id,
        NEW.user_id,
        NEW.id,
        effective_amount,
        COALESCE(NEW.status, 'pending'),
        COALESCE(NEW.gateway_response->>'reason', NEW.memo, 'refund'),
        COALESCE(NEW.gateway_response->>'source', 'system'),
        COALESCE(NEW.gateway_response, '{}'::jsonb),
        CASE WHEN COALESCE(NEW.status, 'pending') IN ('refunded', 'completed', 'success', 'succeeded')
             THEN NOW()
             ELSE NULL
        END
    )
    ON CONFLICT (payment_id) DO UPDATE
    SET amount = EXCLUDED.amount,
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        source = EXCLUDED.source,
        metadata = EXCLUDED.metadata,
        order_id = COALESCE(EXCLUDED.order_id, refunds.order_id),
        user_id = COALESCE(EXCLUDED.user_id, refunds.user_id),
        processed_at = CASE
            WHEN EXCLUDED.processed_at IS NOT NULL THEN EXCLUDED.processed_at
            WHEN EXCLUDED.status IN ('refunded', 'completed', 'success', 'succeeded') AND refunds.processed_at IS NULL
                THEN NOW()
            ELSE refunds.processed_at
        END,
        updated_at = NOW();

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
