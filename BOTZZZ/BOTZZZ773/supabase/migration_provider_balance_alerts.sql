-- Create provider_balance_alerts table for tracking low balance notifications
CREATE TABLE IF NOT EXISTS provider_balance_alerts (
  id BIGSERIAL PRIMARY KEY,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  balance_usd DECIMAL(10, 2) NOT NULL,
  threshold_usd DECIMAL(10, 2) NOT NULL,
  alert_type VARCHAR(50) DEFAULT 'low_balance',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  acknowledged_by UUID REFERENCES users(id),
  notes TEXT
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_provider_balance_alerts_provider_id ON provider_balance_alerts(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_balance_alerts_created_at ON provider_balance_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_balance_alerts_unacknowledged ON provider_balance_alerts(provider_id, acknowledged_at) WHERE acknowledged_at IS NULL;

-- Enable RLS
ALTER TABLE provider_balance_alerts ENABLE ROW LEVEL SECURITY;

-- RLS: Only admins can view balance alerts
CREATE POLICY "admins_view_balance_alerts"
  ON provider_balance_alerts
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ));

-- RLS: Only admins can acknowledge alerts
CREATE POLICY "admins_acknowledge_alerts"
  ON provider_balance_alerts
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'admin'
  ));
