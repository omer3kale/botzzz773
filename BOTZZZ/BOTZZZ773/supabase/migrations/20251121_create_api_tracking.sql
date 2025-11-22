-- Create API tracking reports table for reverse API analysis
CREATE TABLE IF NOT EXISTS public.api_tracking_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_data JSONB NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL,
    total_requests INTEGER DEFAULT 0,
    identified_providers TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_api_tracking_reports_generated_at ON public.api_tracking_reports(generated_at);
CREATE INDEX IF NOT EXISTS idx_api_tracking_reports_total_requests ON public.api_tracking_reports(total_requests);
CREATE INDEX IF NOT EXISTS idx_api_tracking_reports_providers ON public.api_tracking_reports USING GIN(identified_providers);

-- Enable Row Level Security
ALTER TABLE public.api_tracking_reports ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can access tracking reports
CREATE POLICY "Allow admins full access to tracking reports" ON public.api_tracking_reports
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_api_tracking_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER api_tracking_reports_updated_at
    BEFORE UPDATE ON public.api_tracking_reports
    FOR EACH ROW
    EXECUTE FUNCTION update_api_tracking_reports_updated_at();