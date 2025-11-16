# Customer Portal Updates (November 4, 2025)

## Loading UX Refresh

- `order.html` and `services.html` now show network pills and contextual state cards that reflect **loading**, **retrying**, **empty**, and **ready** transitions driven by the fetch guard events.
- The dropdown controllers disable actions while data is pending, surface a retry path, and keep the customer aware of slow Netlify responses instead of looking frozen.
- Supporting styles were added to `css/style.css` so the new components inherit the neon dashboard palette without introducing layout shifts.

## Supabase Curated Sync

- `supabase/customer_portal_curated_assign.sql` now works for **any provider**—drop one or more entries into the JSON configuration array at the top (provider identifier or service ref, name, API URL, API key, optional limit/markup/currency) and run the whole script in one go.
- Each execution clears stale flags, upserts curated assignments for the selected provider (auto-generating a provider UUID if none exists), and guarantees the frontend dropdown references match real Supabase rows after deploys with zero mock data.
- If you only know a `provider_service_id` or `provider_order_id`, drop it into the `provider_service_ref` field; the script resolves the owning provider automatically before curating slots.

## Validation

- `npm run test:frontend` → `node tests/frontend-tests.js`
- Result: **PASS** (latest run after the UX and SQL additions)
