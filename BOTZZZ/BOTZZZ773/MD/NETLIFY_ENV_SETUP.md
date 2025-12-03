# Netlify Environment Configuration Guide

Complete guide for configuring all environment variables for BOTZZZ773 via Netlify CLI.

## Quick Setup

Run the automated configuration script:

```bash
./scripts/configure-netlify-env.sh
```

The script will:
1. Verify Netlify CLI is installed and authenticated
2. Link to your Netlify site
3. Prompt for all required environment variables
4. Apply configuration to all deploy contexts
5. Display verification of configured variables

## Manual Configuration

If you prefer to configure manually or need to update specific variables:

### Prerequisites

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login and link
netlify login
netlify link
```

### Core Configuration

```bash
# Authentication & Database
netlify env:set JWT_SECRET "<your-secret-generated-with-openssl-rand-base64-64>"
netlify env:set SUPABASE_URL "https://your-project.supabase.co"
netlify env:set SUPABASE_ANON_KEY "your-anon-key"
netlify env:set SUPABASE_SERVICE_ROLE_KEY "your-service-role-key"

# Site Configuration
netlify env:set SITE_URL "https://www.botzzz773.pro"
netlify env:set FRONTEND_URL "https://www.botzzz773.pro"
netlify env:set ADMIN_EMAIL "admin@botzzz773.pro"
netlify env:set G_ADMIN_EMAIL "admin@botzzz773.pro"
netlify env:set APP_NAME "BOTZZZ773"
```

### Payment Gateway Configuration

#### Heleket Pay

```bash
netlify env:set HELEKET_MERCHANT_ID "877688f4-03e0-48d7-8c5d-3482c8370290"
netlify env:set HELEKET_API_KEY "your-heleket-api-key"
netlify env:set HELEKET_API_BASE "https://api.heleket.com"  # optional
```

#### Cryptomus

```bash
netlify env:set CRYPTOMUS_MERCHANT_ID "your-merchant-id"
netlify env:set CRYPTOMUS_API_KEY "your-cryptomus-api-key"
```

#### Payeer

```bash
netlify env:set PAYEER_MERCHANT_ID "your-merchant-id"
netlify env:set PAYEER_SECRET_KEY "your-secret-key"
netlify env:set PAYEER_ACCOUNT "P1135369069"
```

### SMTP Configuration (for OTP emails)

```bash
netlify env:set SMTP_HOST "smtp.gmail.com"
netlify env:set SMTP_PORT "587"
netlify env:set SMTP_USER "your-email@gmail.com"
netlify env:set SMTP_PASS "your-16-char-app-password"
```

> **Gmail App Password**: Generate at https://myaccount.google.com/apppasswords

### Optional Configuration

```bash
# Minimum deposit amount (defaults to 5 if not set)
netlify env:set MIN_DEPOSIT_AMOUNT "5"

# Admin OTP email (defaults to ADMIN_EMAIL if not set)
netlify env:set ADMIN_OTP_EMAIL "admin@botzzz773.pro"

# Pricing configuration (optional overrides)
netlify env:set DEFAULT_TARGET_MARKUP_PERCENT "22.5"
netlify env:set DEFAULT_MIN_MARKUP_PERCENT "12"
netlify env:set PRICING_RULE_CACHE_MS "60000"
netlify env:set PROVIDER_AUTOMATION_ORDER_LIMIT "75"

# Stripe (if using Stripe checkout)
netlify env:set STRIPE_SECRET_KEY "sk_live_..."
netlify env:set STRIPE_PUBLISHABLE_KEY "pk_live_..."
netlify env:set STRIPE_WEBHOOK_SECRET "whsec_..."
```

## Deploy Context Configuration

Apply variables to specific contexts (production, deploy-preview, branch-deploy):

```bash
# Production only
netlify env:set HELEKET_API_KEY "prod-key" --context=production

# Deploy previews
netlify env:set HELEKET_API_KEY "test-key" --context=deploy-preview

# Branch deploys
netlify env:set HELEKET_API_KEY "dev-key" --context=branch-deploy

# All contexts
netlify env:set SITE_URL "https://www.botzzz773.pro"
```

## Verification

List all configured environment variables:

```bash
# Simple list
netlify env:list

# JSON format for detailed inspection
netlify env:list --json | jq '.scopes[] | {scope, env}'
```

## Environment Variable Reference

### Required Variables

| Variable | Purpose | Where to Get |
|----------|---------|--------------|
| `JWT_SECRET` | Token signing secret | Generate: `openssl rand -base64 64` |
| `SUPABASE_URL` | Supabase project URL | Supabase Dashboard → Settings → API |
| `SUPABASE_ANON_KEY` | Client authentication | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side admin access | Supabase Dashboard → Settings → API |
| `SITE_URL` | Public site URL | Your domain |
| `FRONTEND_URL` | Frontend URL (usually same as SITE_URL) | Your domain |
| `ADMIN_EMAIL` | Admin contact email | Your email |

### Payment Gateway Variables

| Variable | Purpose | Where to Get |
|----------|---------|--------------|
| `HELEKET_MERCHANT_ID` | Heleket merchant UUID | Heleket Dashboard |
| `HELEKET_API_KEY` | Heleket API secret | Heleket Dashboard |
| `CRYPTOMUS_MERCHANT_ID` | Cryptomus merchant ID | Cryptomus Dashboard |
| `CRYPTOMUS_API_KEY` | Cryptomus API key | Cryptomus Dashboard |
| `PAYEER_MERCHANT_ID` | Payeer merchant ID | Payeer Dashboard |
| `PAYEER_SECRET_KEY` | Payeer signature secret | Payeer Dashboard |
| `PAYEER_ACCOUNT` | Payeer account number | Payeer Dashboard |

### SMTP Variables (for Admin OTP)

| Variable | Purpose | Default |
|----------|---------|---------|
| `SMTP_HOST` | SMTP server hostname | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP server port | `587` |
| `SMTP_USER` | SMTP username | - |
| `SMTP_PASS` | SMTP password/app password | - |

### Optional Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `APP_NAME` | Display name in UI | `BOTZZZ773` |
| `MIN_DEPOSIT_AMOUNT` | Minimum deposit in USD | `5` |
| `HELEKET_API_BASE` | Heleket API endpoint | `https://api.heleket.com` |
| `ADMIN_OTP_EMAIL` | OTP recipient email | Same as `ADMIN_EMAIL` |
| `G_ADMIN_EMAIL` | Legacy admin email | - |
| `DEFAULT_TARGET_MARKUP_PERCENT` | Target markup percentage | `22.5` |
| `DEFAULT_MIN_MARKUP_PERCENT` | Minimum markup percentage | `12` |
| `PRICING_RULE_CACHE_MS` | Pricing cache duration | `60000` |
| `PROVIDER_AUTOMATION_ORDER_LIMIT` | Max orders per sync | `75` |

## Scope Best Practices

### All Scopes
Use for non-sensitive configuration:
- `SITE_URL`
- `FRONTEND_URL`
- `ADMIN_EMAIL`
- `APP_NAME`
- `SMTP_HOST`, `SMTP_PORT`

### Builds, Functions, Runtime Only
Use for sensitive secrets:
- `JWT_SECRET`
- All API keys and merchant IDs
- `SUPABASE_SERVICE_ROLE_KEY`
- `SMTP_USER`, `SMTP_PASS`

To scope a variable:
```bash
netlify env:set MY_SECRET "value" --context=builds --context=functions
```

## Troubleshooting

### Variable Not Taking Effect

1. Check the variable is set:
   ```bash
   netlify env:get VARIABLE_NAME
   ```

2. Verify scope:
   ```bash
   netlify env:list --json | jq '.scopes'
   ```

3. Trigger new deployment:
   ```bash
   git commit --allow-empty -m "Trigger rebuild"
   git push origin master
   ```

### Missing Variables in Functions

Functions only see variables scoped to "Functions" or "All scopes". Use:
```bash
netlify env:set VAR "value"  # Sets for all scopes
```

### Different Values Per Environment

```bash
# Production
netlify env:set API_KEY "prod-key" --context=production

# Preview
netlify env:set API_KEY "test-key" --context=deploy-preview
```

## Security Recommendations

1. **Never commit** environment variables to Git
2. **Rotate secrets** regularly (especially API keys)
3. **Use separate keys** for production vs. testing
4. **Limit access** to Netlify dashboard
5. **Enable 2FA** on Netlify account
6. **Audit variables** periodically with `netlify env:list`

## Import/Export

### Export Current Configuration

```bash
netlify env:list --json > netlify-env-backup.json
```

### Bulk Import (from .env file)

```bash
netlify env:import netlify/env/production.env
```

## Next Steps

After configuring environment variables:

1. ✅ Verify all variables are set: `netlify env:list`
2. ✅ Trigger deployment: `git push origin master`
3. ✅ Test payment gateways in production
4. ✅ Verify admin OTP email delivery
5. ✅ Monitor Netlify function logs for errors

## Related Documentation

- [Cryptomus Setup](./CRYPTOMUS_SETUP.md)
- [Gmail OTP Setup](./GMAIL_OTP_SETUP.md)
- [Production Deployment](./PRODUCTION_DEPLOYMENT.md)
