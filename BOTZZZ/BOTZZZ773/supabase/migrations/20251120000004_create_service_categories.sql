-- Create service_categories table for dynamic category management
CREATE TABLE IF NOT EXISTS public.service_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    icon TEXT DEFAULT 'fas fa-folder',
    display_order INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_service_categories_slug ON public.service_categories(slug);
CREATE INDEX IF NOT EXISTS idx_service_categories_status ON public.service_categories(status);
CREATE INDEX IF NOT EXISTS idx_service_categories_display_order ON public.service_categories(display_order);

-- Enable Row Level Security
ALTER TABLE public.service_categories ENABLE ROW LEVEL SECURITY;

-- Policy: Public read access for active categories
DROP POLICY IF EXISTS "Public read access for active categories" ON public.service_categories;
CREATE POLICY "Public read access for active categories" ON public.service_categories
    FOR SELECT 
    USING (status = 'active');

-- Policy: Admin full access
DROP POLICY IF EXISTS "Admin full access to categories" ON public.service_categories;
CREATE POLICY "Admin full access to categories" ON public.service_categories
    FOR ALL 
    USING (auth.jwt() ->> 'role' = 'admin');

-- Insert default categories if table is empty
INSERT INTO public.service_categories (name, slug, description, icon, display_order) 
SELECT * FROM (VALUES
    ('Instagram', 'instagram', 'Instagram social media services', 'fab fa-instagram', 1),
    ('TikTok', 'tiktok', 'TikTok video platform services', 'fab fa-tiktok', 2),
    ('YouTube', 'youtube', 'YouTube video services', 'fab fa-youtube', 3),
    ('Twitter', 'twitter', 'Twitter social media services', 'fab fa-twitter', 4),
    ('Facebook', 'facebook', 'Facebook social media services', 'fab fa-facebook', 5),
    ('Other', 'other', 'Miscellaneous services', 'fas fa-box', 6)
) AS defaults(name, slug, description, icon, display_order)
WHERE NOT EXISTS (SELECT 1 FROM public.service_categories LIMIT 1);

-- Update function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update updated_at on category updates
DROP TRIGGER IF EXISTS update_service_categories_updated_at ON public.service_categories;
CREATE TRIGGER update_service_categories_updated_at
    BEFORE UPDATE ON public.service_categories
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();