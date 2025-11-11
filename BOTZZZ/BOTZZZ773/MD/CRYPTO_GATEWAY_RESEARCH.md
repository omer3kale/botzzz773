# Crypto Payment Gateway Research

## Summary
- **Recommendation:** Integrate with NOWPayments for initial crypto payment support.
- **Reasoning:** Publicly available REST API, supports customers in Turkey, ready-made invoice flow, HMAC-secured IPN, and minimal onboarding effort compared with regional exchanges that require additional compliance steps.
- **Fallback Options:** Binance Pay (requires business account approval and regional availability confirmation), BTCTurk PRO Merchant (Turkey-first but lacks English docs and invoicing SDKs).

## Evaluation Notes

### NOWPayments
- Supports >200 cryptocurrencies, including USDT (TRC20 / ERC20), BTC, ETH. Fiat settlement optional.
- API documentation is open: https://documenter.getpostman.com/view/7907941/S1a32n38
- Quick start involves generating an API key, setting an IPN secret, and calling `POST /invoice`.
- Compatible with Turkey-based merchants; pricing transparent (0.5% fee, no setup costs).
- Provides hosted invoices (no PCI concerns) and email notifications.

### Binance Pay
- Requires corporate Binance account; onboarding can take several weeks.
- API docs demand signed payloads and IP whitelisting. Turkey support depends on compliance approval.
- Strong brand recognition but higher integration friction.

### BTCTurk PRO Merchant
- Localized solution, but documentation inconsistent and mostly Turkish.
- Requires on-prem integrations; no drop-in invoice experience.
- Better for custom POS rather than quick online payments.

## Implementation Direction
1. **Invoice-based crypto checkout via NOWPayments.**
   - Create Netlify function to generate invoices (`POST /invoice`).
   - Store payment metadata in `payments` table with method `crypto-nowpayments`.
   - Expose invoice link + pay address on the client, show QR code fallback.
2. **IPN webhook.**
   - Handle NOWPayments notifications (`status`: `finished`, `expired`, etc.).
   - Verify `x-nowpayments-sig` header using `NOWPAYMENTS_IPN_SECRET`.
   - Update user balance + activity log mirroring Payeer flow.
3. **Client updates.**
   - Let users choose between Payeer and Crypto on `addfunds.html`.
   - When crypto selected, call new Netlify function and surface invoice instructions.
   - Poll for payment completion (optional for later).

## Required Environment Variables
| Variable | Purpose |
| --- | --- |
| `NOWPAYMENTS_API_KEY` | Server-side API key for invoice creation. |
| `NOWPAYMENTS_IPN_SECRET` | Shared secret for validating IPN signatures. |
| `NOWPAYMENTS_IPN_URL` (optional) | Override default webhook URL if not using `SITE_URL`. |
| `NOWPAYMENTS_DEFAULT_PAY_CURRENCY` (optional) | Force a specific payout currency such as `usdttrc20`. |

## Next Steps
- [ ] Obtain NOWPayments merchant account + API credentials.
- [ ] Populate new environment variables in Netlify / local `.env`.
- [ ] Finalize Netlify function & deploy.
- [ ] QA hosted invoice flow (happy path + expired + underpaid scenarios).
- [ ] Extend dashboard to show crypto payment history (future task).
