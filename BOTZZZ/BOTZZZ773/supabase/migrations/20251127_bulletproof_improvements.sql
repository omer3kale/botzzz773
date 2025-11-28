-- ============================================================
-- Bulletproof System Improvements Migration
-- Date: 2025-11-27
-- Purpose: Add constraints, validations, and improvements(
-- ============================================================

-- ============================================================
-- 1) CATEGORY VALIDATION & NORMALIZATION
-- ============================================================

-- Function to normalize category slugs
CREATE OR REPLACE FUNCTION normalize_category_slug(input TEXT)
RETURNS TEXT AS $$
BEGIN
    IF input IS NULL OR TRIM(input) = '' THEN
        RETURN 'other';
    END IF;
    
    RETURN LOWER(
        REGEXP_REPLACE(
            REGEXP_REPLACE(
                TRIM(input),)
                '[^a-zA-Z0-9\s-]', '', 'g'
            ),
            '\s+', '-', 'g'
        )
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-normalize service category on insert/update
CREATE OR REPLACE FUNCTION normalize_service_category()
RETURNS TRIGGER AS $$
BEGIN
    NEW.category = normalize_category_slug(NEW.category);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_normalize_service_category ON services;
CREATE TRIGGER trigger_normalize_service_category
    BEFORE INSERT OR UPDATE OF category ON services
    FOR EACH ROW
    EXECUTE FUNCTION normalize_service_category();

-- ============================================================
-- 2) ENSURE SERVICES TABLE HAS ALL REQUIRED COLUMNS
-- ============================================================

-- Add public_id if missing (for customer-facing service IDs)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'public_id'
    ) THEN
        ALTER TABLE services ADD COLUMN public_id INTEGER;
        CREATE INDEX IF NOT EXISTS idx_services_public_id ON services(public_id);
    END IF;
END $$;

-- Add currency column if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'currency'
    ) THEN
        ALTER TABLE services ADD COLUMN currency VARCHAR(10) DEFAULT 'USD';
    END IF;
END $$;

-- Add average_time column if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'average_time'
    ) THEN
        ALTER TABLE services ADD COLUMN average_time VARCHAR(50);
    END IF;
END $$;

-- Add capability flags if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'refill_supported') THEN
        ALTER TABLE services ADD COLUMN refill_supported BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'cancel_supported') THEN
        ALTER TABLE services ADD COLUMN cancel_supported BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'dripfeed_supported') THEN
        ALTER TABLE services ADD COLUMN dripfeed_supported BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'subscription_supported') THEN
        ALTER TABLE services ADD COLUMN subscription_supported BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Add admin visibility columns if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'admin_approved') THEN
        ALTER TABLE services ADD COLUMN admin_approved BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'admin_approved_at') THEN
        ALTER TABLE services ADD COLUMN admin_approved_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'admin_approved_by') THEN
        ALTER TABLE services ADD COLUMN admin_approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'admin_visibility_notes') THEN
        ALTER TABLE services ADD COLUMN admin_visibility_notes TEXT;
    END IF;
END $$;

-- Add customer portal columns if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'customer_portal_enabled') THEN
        ALTER TABLE services ADD COLUMN customer_portal_enabled BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'customer_portal_slot') THEN
        ALTER TABLE services ADD COLUMN customer_portal_slot INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'customer_portal_notes') THEN
        ALTER TABLE services ADD COLUMN customer_portal_notes TEXT;
    END IF;
END $$;

-- ============================================================
-- 3) ORDERS TABLE IMPROVEMENTS
-- ============================================================

-- Ensure order_number column exists and has proper sequence
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_number'
    ) THEN
        ALTER TABLE orders ADD COLUMN order_number VARCHAR(20);
    END IF;
END $$;

-- Add provider tracking columns if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'provider_order_id') THEN
        ALTER TABLE orders ADD COLUMN provider_order_id VARCHAR(50);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'provider_cost') THEN
        ALTER TABLE orders ADD COLUMN provider_cost DECIMAL(10, 4);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'provider_status') THEN
        ALTER TABLE orders ADD COLUMN provider_status VARCHAR(50);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'last_status_sync') THEN
        ALTER TABLE orders ADD COLUMN last_status_sync TIMESTAMPTZ;
    END IF;
END $$;

-- Add order reference for refunds
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_reference') THEN
        ALTER TABLE orders ADD COLUMN order_reference VARCHAR(100);
    END IF;
END $$;

-- Add failure tracking columns
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'failure_reason') THEN
        ALTER TABLE orders ADD COLUMN failure_reason TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'failure_metadata') THEN
        ALTER TABLE orders ADD COLUMN failure_metadata JSONB DEFAULT '{}'::jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'silent_failure') THEN
        ALTER TABLE orders ADD COLUMN silent_failure BOOLEAN DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'silent_failure_at') THEN
        ALTER TABLE orders ADD COLUMN silent_failure_at TIMESTAMPTZ;
    END IF;
END $$;

-- ============================================================
-- 4) USERS TABLE IMPROVEMENTS
-- ============================================================

-- Ensure full_name exists (not fullname)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'full_name'
    ) THEN
        -- Check if fullname exists and rename it
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'fullname'
        ) THEN
            ALTER TABLE users RENAME COLUMN fullname TO full_name;
        ELSE
            ALTER TABLE users ADD COLUMN full_name VARCHAR(100);
        END IF;
    END IF;
END $$;

-- Add user rate columns if missing
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'discount_rate') THEN
        ALTER TABLE users ADD COLUMN discount_rate DECIMAL(5, 2) DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_rate') THEN
        ALTER TABLE users ADD COLUMN user_rate DECIMAL(5, 2) DEFAULT 0.00;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'spent') THEN
        ALTER TABLE users ADD COLUMN spent DECIMAL(10, 2) DEFAULT 0.00;
    END IF;
END $$;

-- ============================================================
-- 5) PAYMENTS TABLE IMPROVEMENTS
-- ============================================================

-- Ensure order_id column exists for refund tracking
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'order_id'
    ) THEN
        ALTER TABLE payments ADD COLUMN order_id UUID REFERENCES orders(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
    END IF;
END $$;

-- Ensure details JSONB column exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'details'
    ) THEN
        ALTER TABLE payments ADD COLUMN details JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- ============================================================
-- 6) SERVICE_CATEGORIES TABLE IMPROVEMENTS
-- ============================================================

-- Ensure parent_id column exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'service_categories' AND column_name = 'parent_id'
    ) THEN
        ALTER TABLE service_categories ADD COLUMN parent_id UUID REFERENCES service_categories(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_service_categories_parent ON service_categories(parent_id);
    END IF;
END $$;

-- Add service count cache column
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'service_categories' AND column_name = 'service_count'
    ) THEN
        ALTER TABLE service_categories ADD COLUMN service_count INTEGER DEFAULT 0;
    END IF;
END $$;

-- Function to update category service counts
CREATE OR REPLACE FUNCTION update_category_service_count()
RETURNS TRIGGER AS $$
BEGIN
    -- Update old category count
    IF TG_OP = 'UPDATE' AND OLD.category IS DISTINCT FROM NEW.category THEN
        UPDATE service_categories 
        SET service_count = (
            SELECT COUNT(*) FROM services 
            WHERE normalize_category_slug(category) = slug 
            AND status = 'active' 
            AND admin_approved = TRUE
        )
        WHERE slug = normalize_category_slug(OLD.category);
    END IF;
    
    -- Update new/current category count
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        UPDATE service_categories 
        SET service_count = (
            SELECT COUNT(*) FROM services 
            WHERE normalize_category_slug(category) = slug 
            AND status = 'active' 
            AND admin_approved = TRUE
        )
        WHERE slug = normalize_category_slug(NEW.category);
    END IF;
    
    -- Update deleted category count
    IF TG_OP = 'DELETE' THEN
        UPDATE service_categories 
        SET service_count = (
            SELECT COUNT(*) FROM services 
            WHERE normalize_category_slug(category) = slug 
            AND status = 'active' 
            AND admin_approved = TRUE
        )
        WHERE slug = normalize_category_slug(OLD.category);
        RETURN OLD;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_category_service_count ON services;
CREATE TRIGGER trigger_update_category_service_count
    AFTER INSERT OR UPDATE OF category, status, admin_approved OR DELETE ON services
    FOR EACH ROW
    EXECUTE FUNCTION update_category_service_count();

-- ============================================================
-- 7) ADD USEFUL INDEXES
-- ============================================================

-- Services indexes
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_admin_approved ON services(admin_approved);
CREATE INDEX IF NOT EXISTS idx_services_customer_portal ON services(customer_portal_enabled);
CREATE INDEX IF NOT EXISTS idx_services_provider_id ON services(provider_id);

-- Orders indexes
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);

-- Payments indexes
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_method ON payments(method);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================================
-- 8) AUTO-UPDATE TIMESTAMPS TRIGGERS
-- ============================================================

-- Generic updated_at function (if not exists)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables
DO $$
DECLARE
    tbl TEXT;
    tables TEXT[] := ARRAY['users', 'providers', 'services', 'orders', 'payments', 'tickets', 'service_categories'];
BEGIN
    FOREACH tbl IN ARRAY tables LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%I_updated_at ON %I', tbl, tbl);
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'updated_at'
        ) THEN
            EXECUTE format('
                CREATE TRIGGER update_%I_updated_at
                    BEFORE UPDATE ON %I
                    FOR EACH ROW
                    EXECUTE FUNCTION update_updated_at_column()
            ', tbl, tbl);
        END IF;
    END LOOP;
END $$;

-- ============================================================
-- 9) USER BALANCE CONSISTENCY CHECK
-- ============================================================

-- Function to recalculate user balance from payments
CREATE OR REPLACE FUNCTION recalculate_user_balance(target_user_id UUID)
RETURNS DECIMAL AS $$
DECLARE
    calculated_balance DECIMAL(10, 2);
BEGIN
    SELECT COALESCE(SUM(
        CASE 
            WHEN method = 'refund' OR amount < 0 THEN ABS(amount)  -- Refunds add to balance
            WHEN status IN ('completed', 'success', 'succeeded') THEN amount  -- Deposits add
            ELSE 0
        END
    ), 0) - COALESCE((
        SELECT SUM(charge) FROM orders 
        WHERE user_id = target_user_id 
        AND status NOT IN ('cancelled', 'refunded', 'failed')
    ), 0)
    INTO calculated_balance
    FROM payments
    WHERE user_id = target_user_id
    AND status IN ('completed', 'success', 'succeeded', 'refunded');
    
    RETURN calculated_balance;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 10) SAFETY CONSTRAINTS
-- ============================================================

-- Ensure positive balance constraint (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'users_balance_non_negative' 
        AND conrelid = 'users'::regclass
    ) THEN
        -- Don't enforce for existing data, but log warning
        -- ALTER TABLE users ADD CONSTRAINT users_balance_non_negative CHECK (balance >= 0);
        RAISE NOTICE 'Consider adding balance >= 0 constraint after data review';
    END IF;
END $$;

-- Ensure order charge is positive
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'orders_charge_positive' 
        AND conrelid = 'orders'::regclass
    ) THEN
        ALTER TABLE orders ADD CONSTRAINT orders_charge_positive CHECK (charge >= 0);
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add orders_charge_positive constraint: %', SQLERRM;
END $$;

-- Ensure service rate is positive
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'services_rate_positive' 
        AND conrelid = 'services'::regclass
    ) THEN
        ALTER TABLE services ADD CONSTRAINT services_rate_positive CHECK (rate >= 0);
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not add services_rate_positive constraint: %', SQLERRM;
END $$;

-- ============================================================
-- 11) HELPFUL VIEWS FOR ADMIN DASHBOARD
-- ============================================================

-- Active services with category info
CREATE OR REPLACE VIEW v_active_services_summary AS
SELECT 
    s.id,
    s.public_id,
    s.name,
    s.category,
    sc.name AS category_name,
    sc.icon AS category_icon,
    s.rate,
    s.min_quantity,
    s.max_quantity,
    s.admin_approved,
    s.customer_portal_enabled,
    s.customer_portal_slot,
    p.name AS provider_name,
    s.status
FROM services s
LEFT JOIN service_categories sc ON normalize_category_slug(s.category) = sc.slug
LEFT JOIN providers p ON s.provider_id = p.id
WHERE s.status = 'active';

-- User spending summary
CREATE OR REPLACE VIEW v_user_spending_summary AS
SELECT 
    u.id,
    u.username,
    u.email,
    u.balance,
    u.spent,
    COUNT(DISTINCT o.id) AS total_orders,
    COUNT(DISTINCT CASE WHEN o.status = 'completed' THEN o.id END) AS completed_orders,
    COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled', 'refunded', 'failed') THEN o.charge ELSE 0 END), 0) AS total_spent_on_orders,
    COUNT(DISTINCT p.id) AS total_payments,
    COALESCE(SUM(CASE WHEN p.method != 'refund' AND p.amount > 0 AND p.status IN ('completed', 'success', 'succeeded') THEN p.amount ELSE 0 END), 0) AS total_deposited
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
LEFT JOIN payments p ON u.id = p.user_id
GROUP BY u.id, u.username, u.email, u.balance, u.spent;

-- Daily revenue view
CREATE OR REPLACE VIEW v_daily_revenue AS
SELECT 
    DATE(created_at) AS date,
    COUNT(*) AS order_count,
    SUM(CASE WHEN status NOT IN ('cancelled', 'refunded', 'failed') THEN charge ELSE 0 END) AS gross_revenue,
    SUM(CASE WHEN status = 'completed' THEN charge ELSE 0 END) AS completed_revenue,
    SUM(CASE WHEN status IN ('refunded') THEN charge ELSE 0 END) AS refunded_amount
FROM orders
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- ============================================================
-- 12) INITIAL CATEGORY SERVICE COUNT UPDATE
-- ============================================================

-- Update all category service counts
UPDATE service_categories sc
SET service_count = (
    SELECT COUNT(*) FROM services s
    WHERE normalize_category_slug(s.category) = sc.slug
    AND s.status = 'active'
    AND COALESCE(s.admin_approved, FALSE) = TRUE
);

-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================
SELECT 'Bulletproof improvements migration completed successfully' AS status;
