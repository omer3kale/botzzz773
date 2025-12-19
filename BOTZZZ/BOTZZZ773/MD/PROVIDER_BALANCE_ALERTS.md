# Provider Low Balance Alert System - Implementation Summary

## ✅ Completed Setup

### 1. Admin Settings Form Fields
**Location:** [admin-settings.js](admin-settings.js#L627-L649) - Payment Settings section

Added 3 new form fields for admin configuration:
- `providerLowBalanceAlertEnabled` (checkbox) - Enable/disable alerts
- `providerLowBalanceThreshold` (number) - Alert threshold in USD (default: 0.5)
- `providerBalanceCheckFrequency` (select) - Check frequency (daily/twice-daily/weekly)

Settings saved to database via POST /.netlify/functions/settings

### 2. Backend Balance Check Implementation
**Location:** [scheduled-provider-sync.js](netlify/functions/scheduled-provider-sync.js)

**New Functions Added:**

1. **loadAlertSettings()** - Loads provider alert configuration from 'payment' settings
   - Falls back to defaults: threshold=0.5 USD, enabled=true, frequency=daily

2. **sendLowBalanceAlert()** - Sends email notification to admin
   - Loads SMTP settings from database
   - Handles localhost SMTP (development)
   - Includes HTML email with provider name, balance, threshold
   - Gets admin email from 'general' settings or env var

3. **checkProviderBalances()** - Main balance checking logic
   - Iterates through all active providers
   - Converts non-USD balances to USD using convertToUSD()
   - Identifies providers below threshold
   - Checks if alert already sent in last 24 hours (spam prevention)
   - Logs alert to `provider_balance_alerts` table for audit trail

4. **Integrated into handler** - Balance check runs on each sync cycle

### 3. Database Table Schema
**Location:** [migration_provider_balance_alerts.sql](supabase/migration_provider_balance_alerts.sql)

**Table: provider_balance_alerts**
```sql
CREATE TABLE provider_balance_alerts (
  id BIGSERIAL PRIMARY KEY,
  provider_id UUID (FK to providers),
  balance_usd DECIMAL(10,2),
  threshold_usd DECIMAL(10,2),
  alert_type VARCHAR(50) DEFAULT 'low_balance',
  created_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  acknowledged_by UUID (FK to users),
  notes TEXT
)
```

**Indexes:**
- `idx_provider_balance_alerts_provider_id` - For fast provider lookups
- `idx_provider_balance_alerts_created_at` - For recent alerts
- `idx_provider_balance_alerts_unacknowledged` - For unacked alerts

**Row-Level Security (RLS):**
- Only admins can view balance alerts
- Only admins can acknowledge alerts

## 🔄 How It Works

### Flow:
1. Admin sets threshold (0.5 USD) and frequency (daily) in Payment Settings
2. Settings saved to database via settings endpoint
3. Scheduled sync runs (daily/twice-daily/weekly based on frequency)
4. For each provider:
   - Current balance fetched and synced (existing logic)
   - Balance compared to threshold
5. If balance < threshold AND no alert sent in 24h:
   - Email sent to admin with provider name + balance + threshold
   - Alert logged to `provider_balance_alerts` table
6. Admin can acknowledge/review alerts in future UI

### Email Notification:
**Subject:** ⚠️ Low Balance Alert: {Provider Name}

**Content:**
```
Provider: {name}
Current Balance: {balance} {currency}
Alert Threshold: {threshold} USD
```

## 📋 Setup Checklist

- [x] Admin form fields added to Payment Settings
- [x] Settings persist to database
- [x] loadAlertSettings() function implemented
- [x] sendLowBalanceAlert() function implemented
- [x] checkProviderBalances() function implemented
- [x] 24-hour spam prevention logic added
- [x] Database schema migration created
- [x] RLS policies configured
- [x] Currency conversion integrated (convertToUSD)
- [x] SMTP localhost handling (skip auth for dev)

## ⚙️ Configuration

### Via Admin Settings (Payment section):
- **Enable Alerts:** Check box
- **Threshold:** 0.5 (or any USD amount)
- **Frequency:** daily / twice-daily / weekly

### Via Environment Variables (fallback):
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@botzzz773.com
SMTP_PASS=password
SMTP_FROM=noreply@botzzz773.com
ADMIN_EMAIL=admin@botzzz773.com
```

## 🚀 Deployment Steps

1. **Run migration in Supabase:**
   - Execute [migration_provider_balance_alerts.sql](supabase/migration_provider_balance_alerts.sql)
   - Or via Supabase dashboard → SQL Editor

2. **Deploy to Netlify:**
   ```bash
   git push  # Triggers Netlify deploy
   ```

3. **Test:**
   - Manually trigger: `curl https://<domain>/.netlify/functions/scheduled-provider-sync`
   - Or wait for scheduled function to run
   - Check `provider_balance_alerts` table for logged alerts

## 📝 Next Steps (Optional)

1. **Admin Dashboard View:**
   - Add "Balance Alerts" section in admin panel
   - Show list of recent/unacknowledged alerts
   - Allow admin to acknowledge + add notes

2. **Alert History:**
   - Query `provider_balance_alerts` for provider alert history
   - Show on provider detail page

3. **Auto-Actions:**
   - Auto-disable low-balance providers (prevent failed orders)
   - Auto-pause services temporarily
   - Send reminder emails after N days

4. **Webhook Notifications:**
   - Send alert via Slack/Telegram in addition to email
   - Add webhook integration to admin settings

## 📞 Support

**Triggered by:** `scheduled-provider-sync` function (runs on schedule)

**Settings stored in:** `settings` table, key='payment'

**Alerts logged in:** `provider_balance_alerts` table

**Email sent via:** SMTP settings from `settings` table, key='notification'

**Frequency controlled by:** `providerBalanceCheckFrequency` setting (daily/twice-daily/weekly)

**Default threshold:** 0.5 USD (configurable per admin)

**Spam prevention:** 24-hour cooldown between alerts for same provider
