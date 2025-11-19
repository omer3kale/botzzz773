-- Create service_categories table
CREATE TABLE IF NOT EXISTS public.service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT DEFAULT 'fas fa-folder',
    display_order INTEGER DEFAULT 1,
    parent_id UUID REFERENCES public.service_categories(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_service_categories_slug ON public.service_categories(slug);
CREATE INDEX IF NOT EXISTS idx_service_categories_status ON public.service_categories(status);
CREATE INDEX IF NOT EXISTS idx_service_categories_parent ON public.service_categories(parent_id);

-- Insert default categories
INSERT INTO public.service_categories (name, slug, description, icon, display_order, status)
VALUES 
    ('Instagram', 'instagram', 'Instagram services', 'fab fa-instagram', 1, 'active'),
    ('TikTok', 'tiktok', 'TikTok services', 'fab fa-tiktok', 2, 'active'),
    ('YouTube', 'youtube', 'YouTube services', 'fab fa-youtube', 3, 'active'),
    ('Twitter', 'twitter', 'Twitter/X services', 'fab fa-twitter', 4, 'active'),
    ('Facebook', 'facebook', 'Facebook services', 'fab fa-facebook', 5, 'active')
ON CONFLICT (slug) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can read active categories
CREATE POLICY "Allow public read active categories" ON public.service_categories
    FOR SELECT
    USING (status = 'active');

-- Policy: Admins can manage all categories
CREATE POLICY "Allow admins full access to categories" ON public.service_categories
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_service_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_categories_updated_at
    BEFORE UPDATE ON public.service_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_service_categories_updated_at();
