-- Smart pricing rules for automated markup management
CREATE TABLE IF NOT EXISTS public.pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    provider_id UUID REFERENCES public.providers(id) ON DELETE CASCADE,
    category_slug TEXT,
    min_markup_percent NUMERIC(6,2),
    target_markup_percent NUMERIC(6,2),
    max_markup_percent NUMERIC(6,2),
    retail_floor NUMERIC(12,4),
    retail_ceiling NUMERIC(12,4),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pricing_rules_status_priority ON public.pricing_rules(status, priority);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_provider ON public.pricing_rules(provider_id);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_category ON public.pricing_rules(category_slug);

ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage pricing rules" ON public.pricing_rules;
CREATE POLICY "Admins manage pricing rules" ON public.pricing_rules
    FOR ALL
    USING (auth.jwt() ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() ->> 'role' = 'admin');

CREATE OR REPLACE FUNCTION normalize_pricing_rule_category()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.category_slug IS NOT NULL THEN
        NEW.category_slug = lower(trim(NEW.category_slug));
        IF NEW.category_slug = '' THEN
            NEW.category_slug = NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS normalize_pricing_rule_category_insert ON public.pricing_rules;
CREATE TRIGGER normalize_pricing_rule_category_insert
    BEFORE INSERT OR UPDATE ON public.pricing_rules
    FOR EACH ROW
    EXECUTE FUNCTION normalize_pricing_rule_category();

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_pricing_rules_updated_at ON public.pricing_rules;
CREATE TRIGGER update_pricing_rules_updated_at
    BEFORE UPDATE ON public.pricing_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

INSERT INTO public.pricing_rules (name, priority, status, target_markup_percent, min_markup_percent, notes)
SELECT 'Global baseline pricing', 100, 'active', 22.5, 12.5, 'Default markup applied when no specific provider/category rule exists'
WHERE NOT EXISTS (SELECT 1 FROM public.pricing_rules);

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS pricing_rule_id UUID REFERENCES public.pricing_rules(id),
  ADD COLUMN IF NOT EXISTS pricing_last_applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pricing_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_services_pricing_rule_id ON public.services(pricing_rule_id);
