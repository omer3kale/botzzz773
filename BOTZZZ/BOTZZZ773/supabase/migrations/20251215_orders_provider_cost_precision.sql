-- Increase precision for provider_cost to prevent truncation of provider responses
-- Previously DECIMAL(10,4) caused values like 0.001435 to be stored as 0.0014
ALTER TABLE public.orders
    ALTER COLUMN provider_cost TYPE NUMERIC(12,5) USING provider_cost::NUMERIC;
