-- Add low_balance_alerts_enabled column to providers table
ALTER TABLE providers ADD COLUMN IF NOT EXISTS low_balance_alerts_enabled BOOLEAN DEFAULT true;

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_providers_low_balance_alerts ON providers(low_balance_alerts_enabled) WHERE low_balance_alerts_enabled = true;
