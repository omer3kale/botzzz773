# Botzzz773 AI Coding Agent Instructions

## Overview
SMM (Social Media Marketing) services reseller platform. Static site UI (HTML/CSS/JS) + serverless backend (Netlify Functions) + Supabase PostgreSQL. Stripe/Payeer/Cryptomus payments. Multi-provider service catalog (g1618, PerfectPanel, etc.) with scheduled sync.

## Architecture & Code Organization

**Frontend & Functions:**
- `index.html`, `order.html`, `admin/*.html`, `services.html`, etc. — User-facing pages
- `js/*.js` — Client-side logic, page initialization, API calls, DOM management
- `js/api-client.js` — Canonical API client; use for ALL fetch operations to functions
- `js/admin-auth.js` — Admin session protection; injected into all admin pages first
- `netlify/functions/*.js` — Serverless handlers; reached via `/.netlify/functions/<name>`

**Database & Config:**
- `supabase/` — Migrations, config.toml, .env setup
- `netlify.toml` — Function routes, redirects, external modules, scheduled jobs
- `package.json` — npm scripts for dev, deploy, test
- `MD/` — Documentation on architecture, migrations, deployment

## API Patterns & Request/Response Flow

**Single Entry Point Pattern:**
- Frontend posts to `/.netlify/functions/<function-name>` (e.g., `auth`, `orders`, `services`, `payments`)
- All requests use `Authorization: Bearer <token>` header when user is logged in
- Token stored in `localStorage.token`; user profile in `localStorage.user`

**Action-Multiplexing:**
- Many handlers use `action` field in request body to route behavior:
  ```js
  // Client side (js/api-client.js)
  this.request('/.netlify/functions/auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'login', email, password })
  });
  
  // Server side (netlify/functions/auth.js) — pseudo
  if (body.action === 'login') { ... }
  else if (body.action === 'signup') { ... }
  ```
- See `netlify/functions/tickets.js`, `payments.js`, `providers.js` for action patterns

**JWT & Auth:**
- All handlers call `getUserFromToken(authHeader)` to extract & verify JWT
- `JWT_SECRET` from env must match across all functions
- Admin checks: `user.role === 'admin'` in function logic

**Function Utility Modules:**
- `netlify/functions/utils/supabase.js` — Exports `supabase` (with RLS) and `supabaseAdmin` (bypasses RLS)
- `netlify/functions/utils/rate-limit.js` — Rate limiting middleware
- `netlify/functions/utils/logger.js` — Structured logging with error serialization
- Use `supabaseAdmin` for internal operations; `supabase` for user-facing queries

## Data Model & Naming Conventions

**Order ID Duality:**
- `orders.id` → Internal UUID (Supabase)
- `orders.order_number` → Human-readable sequential ID (display to user)
- `orders.public_order_id` → External provider ID (sent to SMM panels)
- When creating order, function auto-generates `public_order_id` starting from 1000

**Service IDs:**
- `services.id` → Internal UUID
- `services.public_id` → Numeric ID (7000+) used in external APIs and provider sync
- Services linked to providers via provider-specific identifiers (e.g., g1618 service codes)

**Field Normalization:**
- `calculateProviderRate()` — Derives provider cost from markup or direct rate
- `normalizeOrderDisplayValue()` — Coerces values to safe display strings
- `normalizeCurrency()` — Standardizes currency codes (USD default)
- `toNumberOrNull()` — Safe number parsing in data flows

## Frontend Conventions

**localStorage Keys:**
- `token` — JWT string
- `user` — JSON string with `{ id, email, role, ... }`
- `rememberMe` — Boolean for login persistence

**DOM Selectors & Page Expectations:**
- Pages expect specific element IDs (e.g., `#orderForm`, `#signinForm`, `#paymentHistory`)
- Changes to HTML markup MUST be reflected in corresponding `js/*.js` file
- Admin pages inject `js/admin-auth.js` **first** to block unauthorized access before other scripts load

**CSS:**
- `css/admin-styles.css` — Shared admin UI
- `css/style.css` — Global styles
- Mobile-first responsive; tests include viewport checks (see `tests/admin-orders-viewport-check.js`)

## Workflows & Commands

**Local Development:**
```bash
npm run dev           # Starts Netlify CLI on port 8888, watches functions
npm run test          # Run all tests (integration + frontend)
npm run test:api      # API-only tests
npm run test:watch    # Nodemon watching for TDD
npm run coverage      # Coverage report
```

**Deployment:**
```bash
npm run deploy        # netlify deploy --prod (pushes to production)
# OR: git push → auto-deploys if Netlify is linked
```

**Database Migrations:**
- Manual SQL edits in Supabase dashboard SQL Editor, OR
- Write migration file in `supabase/migrations/`, then `supabase db push`
- Key migrations: `public_order_id` generation, `public_id` for services (see `MIGRATION_QUICK_START.md`)

## Key Integration Points

**Provider Sync (Scheduled):**
- `netlify/functions/scheduled-provider-sync.js` — Runs on cron (check `netlify.toml`)
- Fetches service catalogs from external APIs (g1618, PerfectPanel, etc.)
- Writes/updates services table with provider identifiers and pricing
- Uses `axios` for external HTTP; `supabaseAdmin` for DB

**Order Processing & Status:**
- `netlify/functions/orders.js` — Create, get, update, cancel orders
- On creation: calculates provider cost, sends to provider API, stores result
- `netlify/functions/sync-order-status.js` — Periodic polling of provider status
- On status change: updates order record, triggers refunds or retries

**Payments:**
- `netlify/functions/payments.js` — Stripe/Payeer/Cryptomus payment actions
- `js/payment-backend.js` — Frontend forms and payment state management
- Webhook handlers for async payment confirmations
- Stores transaction logs in `transactions` table

**Admin Dashboard:**
- `admin/index.html`, `admin/services.html`, `admin/orders.html`, etc.
- `js/admin-*.js` files (e.g., `admin-services.js`, `admin-orders.js`)
- All admin pages load `js/supabase-client.js` for real-time data via Supabase listeners
- Drag-and-drop for service ordering: `js/admin-services-dnd.js`

## Testing Patterns

**Test Suites:**
- `tests/api-tests.js` — Direct function handler tests
- `tests/frontend-tests.js` — Browser API simulation
- `tests/integration-tests.js` — End-to-end (requires running server)
- `tests/admin-orders-viewport-check.js` — Viewport size regression
- `tests/*-popup-regression.js` — Modal/dialog behavior across pages

**Test Helpers:**
- `tests/run-all-tests.js` — Sequential runner
- `tests/run-with-server.js` — Starts `netlify dev`, then runs integration tests

## Project-Specific Quirks

1. **No build step** — `npm run build` is a no-op. Site serves directly from repo root.
2. **Netlify Function bundler** — Uses esbuild. Large deps listed in `external_node_modules` are bundled separately.
3. **GET + JSON body** — Some handlers accept JSON body on GET (non-standard but intentional). Check function implementation, not HTTP spec.
4. **RLS + Service Role** — Supabase uses Row Level Security. Sensitive ops use `supabaseAdmin`; public queries use standard `supabase` client.
5. **Mobile UI** — Heavy mobile usage; test on small viewports. See `tests/admin-orders-viewport-check.js` for pattern.
6. **Error Serialization** — Functions use `serializeError()` to log objects safely (avoid circular references).

## First Tasks & Files to Read

1. `js/api-client.js` — Understand API call patterns
2. `netlify.toml` — Function routing & scheduled job config
3. `netlify/functions/auth.js` — How JWT auth is verified
4. `netlify/functions/orders.js` — Largest function; shows action multiplex, provider integration
5. `MD/MIGRATION_QUICK_START.md` — Running DB migrations
6. `tests/api-tests.js` — How to test a function

## When Adding Features

**New endpoint?**
1. Create handler in `netlify/functions/<name>.js` (or add action to existing)
2. Add route to `netlify.toml` if needed (e.g., `[[redirects]]` for aliases)
3. Add client method to `js/api-client.js`
4. Write test in `tests/<name>.test.js`
5. `npm run dev`, test locally, then `npm run deploy`

**New database table?**
1. Write migration SQL in `supabase/migrations/20YYYYMMDDhhmmss_<name>.sql`
2. Test locally: `supabase db push`
3. Add RLS policies if needed (check `SMM_PANEL_SOLUTIONS.md`)
4. Reference in handler with `supabaseAdmin.from('<table>')`

**New admin page?**
1. Create `admin/<name>.html` (copy from `admin/services.html` template)
2. Inject `js/admin-auth.js` **first**, then `js/supabase-client.js`
3. Create `js/admin-<name>.js` to manage state & events
4. Add to admin navigation (if shared)
5. Test with `npm run test:admin-<name>` (create test if needed)
