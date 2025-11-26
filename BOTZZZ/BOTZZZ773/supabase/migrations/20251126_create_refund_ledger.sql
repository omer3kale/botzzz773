-- Refund ledger & payment metadata upgrade

-- 1) Payments table gains references and metadata used by refunds
ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES orders(id) ON DELETE SET NULL;

ALTER TABLE payments
    ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb;

UPDATE payments
SET details = '{}'::jsonb
WHERE details IS NULL;

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);

-- 2) Dedicated refund ledger mirrors refund payments for analytics
CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    refund_code TEXT UNIQUE NOT NULL,
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    payment_id UUID UNIQUE REFERENCES payments(id) ON DELETE CASCADE,
    amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
    status TEXT DEFAULT 'pending',
    reason TEXT,
    source TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_refunds_order_id ON refunds(order_id);
CREATE INDEX IF NOT EXISTS idx_refunds_user_id ON refunds(user_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds(status);

-- Trigger helper keeps updated_at fresh on manual edits
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_refunds_updated_at'
    ) THEN
        CREATE TRIGGER update_refunds_updated_at
            BEFORE UPDATE ON refunds
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
    END IF;
END;
$$;

-- 3) Trigger copies refund payments into the ledger
CREATE OR REPLACE FUNCTION sync_refund_from_payment()
RETURNS TRIGGER AS $$
DECLARE
    target_order_id UUID;
    effective_amount DECIMAL(10, 2);
    fallback_code TEXT;
BEGIN
    IF NEW.method <> 'refund' AND COALESCE(NEW.amount, 0) >= 0 THEN
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

DROP TRIGGER IF EXISTS trigger_payments_refund_ledger ON payments;
CREATE TRIGGER trigger_payments_refund_ledger
    AFTER INSERT OR UPDATE ON payments
    FOR EACH ROW
    WHEN (NEW.method = 'refund' OR COALESCE(NEW.amount, 0) < 0)
    EXECUTE FUNCTION sync_refund_from_payment();

-- 4) Backfill existing refund payments into the ledger
WITH refund_candidates AS (
    SELECT
        p.id AS payment_id,
        p.transaction_id,
        p.user_id,
        ABS(COALESCE(p.amount, 0)) AS amount,
        COALESCE(p.status, 'pending') AS status,
        COALESCE(p.gateway_response->>'reason', p.memo, 'refund') AS reason,
        COALESCE(p.gateway_response->>'source', 'system') AS source,
        p.gateway_response,
        p.created_at,
        p.updated_at,
        CASE
            WHEN p.order_id IS NOT NULL THEN p.order_id
            WHEN (p.gateway_response ? 'order_id')
                 AND (p.gateway_response->>'order_id') ~* '^[0-9a-fA-F-]{32,36}$'
                THEN (p.gateway_response->>'order_id')::UUID
            ELSE NULL
        END AS resolved_order_id
    FROM payments p
    WHERE p.method = 'refund'
       OR COALESCE(p.amount, 0) < 0
)
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
    created_at,
    updated_at,
    processed_at
)
SELECT
    COALESCE(rc.transaction_id, 'refund_' || REPLACE(uuid_generate_v4()::TEXT, '-', '')),
    rc.resolved_order_id,
    rc.user_id,
    rc.payment_id,
    rc.amount,
    rc.status,
    rc.reason,
    rc.source,
    COALESCE(rc.gateway_response, '{}'::jsonb),
    rc.created_at,
    rc.updated_at,
    CASE WHEN rc.status IN ('refunded', 'completed', 'success', 'succeeded') THEN rc.updated_at ELSE NULL END
FROM refund_candidates rc
ON CONFLICT (payment_id) DO NOTHING;
