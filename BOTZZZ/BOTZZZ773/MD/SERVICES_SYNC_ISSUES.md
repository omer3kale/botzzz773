# Service Data Discrepancy Report

_Date: 2025-11-07_

## Summary
Customer-facing order flows still surface legacy placeholder data instead of the live services that admins add through the dashboard. The investigation below maps the exact breakpoints preventing fresh Supabase records from reaching the UI.

## Findings

1. **Orders API payload mismatch**  
   - Files: `js/dashboard.js` (order submission), `js/order.js` (public order form).  
   - Details: Both front-end flows submit `service_id` to `/.netlify/functions/orders`, but the server expects a `serviceId` property. Because the API never receives `serviceId`, it returns `400` (`"Service ID, quantity, and link are required"`). For customers this looks like an inability to order newly created services.

2. **UUIDs converted to `NaN` before the request**  
   - File: `js/order.js`, `loadServices()` submission handler.  
   - Details: Service identifiers coming from Supabase are UUID strings. The order form forces `parseInt(serviceId)`, which collapses UUIDs to `NaN`. Even if the backend accepted `service_id`, the value would be invalid, so no new service can be referenced successfully.

3. **Display still falls back to mock defaults**  
   - Files: `js/order.js`, `js/dashboard.js`.  
   - Details: The option labels and validation logic read `service.min_order` / `service.max_order`, but Supabase supplies `min_quantity` / `max_quantity`. Because those fields are undefined, the UI always displays and enforces the hard-coded defaults (`Min: 10`, `Max: 10K`), which makes every live service look like placeholder data.

4. **API key management still failing upstream (blocking API-backed flows)**  
   - File: `netlify/functions/api-keys.js`.  
   - Details: `POST`/`GET` endpoints continue to return `500` from Supabase. This prevents customers from provisioning keys that might otherwise exercise the updated services catalog, and it complicates any automated testing around the dashboard services.

## Impact
- Customers cannot place orders against the services admins publish because the backend rejects every request at validation time.
- The UI’s forced fallback values reinforce the perception that the dropdown is still wired to mock data.
- API key failures block the API-based ordering alternative, leaving no working path to consume the newly added services.

## Next Steps
1. Align the front-end payload with the orders function (`serviceId` and raw UUID values).
2. Stop `parseInt`-ing service IDs and use the database fields (`min_quantity`, `max_quantity`) when rendering and validating.
3. Investigate the Supabase error returned by `api-keys` (likely constraint/column issue) so customers can create keys once services are visible.
