-- Create refill_requests table
CREATE TABLE IF NOT EXISTS refill_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    order_number VARCHAR(100) NOT NULL,
    refill_id BIGINT NOT NULL UNIQUE,
    service_id VARCHAR(100) NOT NULL, -- public_id instead of UUID
    quantity INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected', 'processing')),
    reason TEXT,
    admin_notes TEXT,
    requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create sequence for refill_id (starts at 15095)
CREATE SEQUENCE refill_id_seq START 15095 INCREMENT 1;

-- Create function to generate refill_id with random increment (1-5)
CREATE OR REPLACE FUNCTION generate_refill_id()
RETURNS BIGINT AS $$
DECLARE
    last_refill_id BIGINT;
    random_increment INT;
BEGIN
    -- Get the last refill_id, but ensure it's at least 15090
    SELECT COALESCE(MAX(NULLIF(CASE WHEN refill_id < 15090 THEN NULL ELSE refill_id END, NULL)), 15090) 
    INTO last_refill_id 
    FROM refill_requests;
    
    -- Generate random increment between 1 and 5
    random_increment := FLOOR(RANDOM() * 5 + 1)::INT;
    
    -- Return last_refill_id + random_increment (ensures result >= 15091)
    RETURN last_refill_id + random_increment;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate refill_id
CREATE OR REPLACE FUNCTION auto_refill_id()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.refill_id IS NULL THEN
        NEW.refill_id := generate_refill_id();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refill_id_trigger
BEFORE INSERT ON refill_requests
FOR EACH ROW
EXECUTE FUNCTION auto_refill_id();

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_refill_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refill_requests_updated_at_trigger
BEFORE UPDATE ON refill_requests
FOR EACH ROW
EXECUTE FUNCTION update_refill_requests_updated_at();

-- Create indexes
CREATE INDEX idx_refill_requests_user_id ON refill_requests(user_id);
CREATE INDEX idx_refill_requests_order_number ON refill_requests(order_number);
CREATE INDEX idx_refill_requests_status ON refill_requests(status);
CREATE INDEX idx_refill_requests_refill_id ON refill_requests(refill_id);
CREATE INDEX idx_refill_requests_requested_at ON refill_requests(requested_at DESC);

-- Enable RLS
ALTER TABLE refill_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can view their own refill requests
CREATE POLICY "Users can view their own refill requests"
    ON refill_requests FOR SELECT
    USING (auth.uid() = user_id);

-- Users can create refill requests
CREATE POLICY "Users can create refill requests"
    ON refill_requests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Admins can view all refill requests (role = 'admin')
CREATE POLICY "Admins can view all refill requests"
    ON refill_requests FOR SELECT
    USING (
        auth.uid() = user_id 
        OR EXISTS (
            SELECT 1 FROM public.users
            WHERE public.users.id = auth.uid()
            AND public.users.role = 'admin'
        )
    );

-- Admins can update refill requests
CREATE POLICY "Admins can update refill requests"
    ON refill_requests FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.users
        WHERE public.users.id = auth.uid()
        AND public.users.role = 'admin'
    ));
