Changelog: Provider Response Normalization

Date: 2025-11-18

Summary:
- Fixed incorrect handling of provider responses in `netlify/functions/orders.js`.

Files changed:
- `netlify/functions/orders.js`

What I changed:
- Added `unwrapProviderPayload(payload)` to prefer nested payloads commonly used by providers (`data`, `result`, `response`).
- Added `resolveProviderOrderIdFromResponse(resp)` to extract provider order IDs from a wide variety of keys (`order`, `order_id`, `id`, `orderid`, `provider_order_id`, `providerOrderId`, `external_order_id`, `reference`, etc.) and to normalize candidate values.
- Updated `submitOrderToProvider` to use the resolver to obtain the provider order id from many shapes instead of assuming `response.data.order`.
- Updated `fetchProviderOrderStatus` to return the unwrapped payload so downstream logic can find status fields regardless of nesting.

Why this fixes the issue:
- Many provider APIs return the order id under different keys or wrapped inside nested objects. The previous code assumed a single shape and would fail to detect valid IDs. The new helpers normalize across the common variants, preventing false "no order id" errors and ensuring status sync works when providers use different response formats.

Recommended next steps:
1. Run existing integration or unit tests that exercise order submission and status sync.
2. If you have real provider response examples that previously failed, add them as test vectors and verify normalization.
3. Commit and push the changes.

Suggested git commands to commit this change locally:

```powershell
cd "c:\Users\emert\repo\botzzz773\BOTZZZ\BOTZZZ773"
git add netlify/functions/orders.js MD/PROVIDER_RESPONSE_NORMALIZATION.md
git commit -m "fix(orders): normalize provider responses and extract order ids from nested payloads"
git push origin master
```

Notes:
- No behavior changes were made to the public API returned by the function; only internal normalization logic was added.
- If you prefer a different changelog location or entry format, I can move or extend this note.
