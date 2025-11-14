# Netlify Environment Setup

Use the bundled `production.env` file to configure the live Netlify site in one pass.

## Importing Variables

```bash
# Authenticate and select the site first
netlify login
netlify link

# Import the required variables
env NETLIFY_SITE_ID=<your-site-id> netlify env:import netlify/env/production.env
```

Alternatively, run `netlify env:import netlify/env/production.env` inside the linked project root and select the site interactively.

## Variables Included

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project REST URL |
| `SUPABASE_ANON_KEY` | Client auth for Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for Netlify Functions |
| `JWT_SECRET` | Token signing secret |
| `PAYEER_MERCHANT_ID` | Merchant ID for Payeer gateway |
| `PAYEER_SECRET_KEY` | Payeer signature secret |
| `PAYEER_ACCOUNT` | Payeer account number |
| `SITE_URL` | Public site URL |
| `FRONTEND_URL` | Used for redirects/CORS |
| `ADMIN_EMAIL` | Admin contact email |
| `APP_NAME` | Display name used inside the UI |

## Reserved Variables

The file intentionally omits Netlify-reserved keys (`SITE_NAME`, `PORT`, `NODE_ENV`). Leave them unset to avoid deploy failures.
