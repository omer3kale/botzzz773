<!-- .github/copilot-instructions.md - guidance for AI coding agents working on this repo -->
# Botzzz773 — AI Assistant Instructions

Purpose: give an AI coding agent the minimal, high-value information to be productive immediately in this repository.

- **Big picture**: This is a static site served via Netlify with UI under the repository root (HTML, CSS, `js/`). Backend logic runs as Netlify Functions in `netlify/functions` (serverless JavaScript) and the project uses Supabase as the primary database and external provider APIs for service syncing.

- **Where runtime code lives**:
  - Frontend: top-level HTML pages and `js/` (e.g. `index.html`, `order.html`, `admin/*.html`, `js/*.js`).
  - Serverless functions: `netlify/functions` (referenced by `/.netlify/functions/*`). Check `netlify.toml` for function config and scheduled functions.
  - DB migrations and SQL: `supabase/` and `MD/` (several SQL files and migration docs referenced in `DEPLOYMENT_SUCCESS.md`).

- **API contract & patterns (important, concrete)**:
  - Frontend communicates via a single origin API prefix: `/.netlify/functions/<name>` (see `js/api-client.js`). Example: `api.login()` posts to `/.netlify/functions/auth`.
  - Many POST endpoints use an `action` field to multiplex behavior (e.g. payments, providers). Look for `action` in netlify function handlers.
  - Several client calls intentionally include bodies on GET-like calls (the repo uses `fetch` calls with `method: 'GET'` and also JSON bodies in a few places). Treat handler implementations as authoritative — do not assume RESTful purity.
  - Auth: token stored in `localStorage.token` and user in `localStorage.user`. Frontend uses `Authorization: Bearer <token>` when present (see `js/api-client.js`, `js/auth-backend.js`).

- **Frontend conventions**:
  - `js/api-client.js` is the canonical place for API calls — update it when adding new endpoints or changing auth behavior.
  - UI pages often expect DOM ids and classes (e.g. `#orderForm`, `#signinForm`, `#paymentHistory`) — changes to markup require coordinated JS updates.
  - Local client-side state: `token`, `user`, `rememberMe` keys in `localStorage`.

- **Build / dev / deploy workflows (concrete commands)**:
  - Local dev using Netlify CLI: `npm run dev` (runs `netlify dev`).
  - Deploy to production: `npm run deploy` (runs `netlify deploy --prod`).
  - There is no static bundling step; `npm run build` is a no-op placeholder.
  - Tests: `npm test` and specific suites like `npm run test:api`, `npm run test:frontend`. Use `npm run test:watch` during iterative development.

- **Netlify specifics** (refer to `netlify.toml`):
  - `publish = "."` — site root is repository root.
  - Function bundler uses `esbuild`. `external_node_modules` lists dependencies packaged separately (`@supabase/supabase-js`, `stripe`, `axios`).
  - API routing: `/.netlify/functions/:splat` redirect is configured; update `netlify.toml` when adding new function names or scheduled functions.
  - Scheduled functions declared in `netlify.toml` (e.g. `sync-order-status`, `sync-service-catalog`, `scheduled-provider-sync`) — check cron schedules there.

- **Data flows & integration points**:
  - Supabase is the authoritative datastore. Look under `supabase/` and SQL docs in `MD/` for schema and migration examples.
  - Provider sync: scheduled functions fetch external provider catalogs (g1618.com and others) and write to Supabase.
  - Payments: Stripe and Payeer integrations are present; handlers live under payments-related functions and frontend code (`js/payment-backend.js`).

- **Project-specific quirks & gotchas**:
  - GET requests sometimes carry JSON bodies in client code; Netlify function handlers may read body regardless of HTTP verb — inspect the function code, not the client, to know required parameters.
  - API multiplexing by `action` means adding a new behavior often requires touching both the handler and the frontend `action` payload.
  - `netlify.toml` uses `external_node_modules` — when editing functions that import those deps, ensure dev environment (local `npm install`) matches the listed modules.

- **Files to read first when onboarding**:
  - `js/api-client.js` — canonical API patterns and auth handling.
  - `netlify.toml` — function routes, scheduled jobs, and headers.
  - `package.json` — dev scripts and dependencies.
  - `DEPLOYMENT_SUCCESS.md`, `PRODUCTION_DEPLOYMENT.md`, `MD/` — deployment notes and DB migration guidance.
  - `admin/*.html` and `js/admin-*.js` — examples of admin flows and provider-specific UI.

- **When making changes**:
  - Update `js/api-client.js` first if adding or changing endpoints.
  - If you add a new Netlify function, add/confirm entries in `netlify.toml` and ensure `external_node_modules` includes any large dependencies.
  - Run `npm run dev` locally and exercise both UI and function endpoints. Use Netlify's function logs for debugging.

If anything is unclear or you want this to include code pointers for a particular task (add endpoint, change auth, extend scheduled sync), tell me which area and I will expand or iterate.
