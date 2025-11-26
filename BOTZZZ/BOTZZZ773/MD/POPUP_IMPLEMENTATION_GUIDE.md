# Popup Enablement Guide

This note distills the W3Schools guidance on JavaScript popups (alert, confirm, prompt) and adapts it to our workspace so every "logic" page can be launched inside a popup window without breaking its existing functionality (e.g., Add Order). Use this as the implementation checklist before touching any page.

## 1. Core Popup Patterns (from W3Schools)

| Pattern  | API                         | Best Use Case                            |
|----------|----------------------------|------------------------------------------|
| Alert    | `window.alert(message)`    | Informational notices, validation errors |
| Confirm  | `window.confirm(message)`  | Yes/No gates before executing actions    |
| Prompt   | `window.prompt(question)`  | Lightweight input collection             |

> Tip: Use `\n` inside the strings if you need line breaks, per the W3Schools example `alert("Hello\nHow are you?")`.

These native dialogs are blocking (the page waits until the user responds). For page-level flows we need *window popups* so that a full HTML page can load and reuse its scripts.

## 2. Standard Popup Window Contract

All popup launches should follow the same helper so behavior is predictable:

```js
function openAppPopup(path, {
  name = 'botzzz-popup',
  width = 1100,
  height = 720,
  features = 'resizable=yes,scrollbars=yes',
  context = {}
} = {}) {
  const left = (window.screen.width - width) / 2;
  const top = (window.screen.height - height) / 2;
  const finalFeatures = `${features},width=${width},height=${height},left=${left},top=${top}`;

  const url = new URL(path, window.location.origin);
  url.searchParams.set('popup', '1');
  if (context.orderId) url.searchParams.set('orderId', context.orderId);

  const ref = window.open(url.toString(), name, finalFeatures);
  if (!ref) {
    alert('Please allow popups for BOTZZZ773 to open this window.');
  }
  return ref;
}
```

Usage example for the existing "Add Order" quick action:

```js
document.querySelector('[data-open-add-order]').addEventListener('click', () => {
  openAppPopup('/order.html', { name: 'botzzz-add-order' });
});
```

### Popup Page Bootstrapping

Inside every page that can run in popup mode:

```js
const urlParams = new URLSearchParams(window.location.search);
const isPopup = urlParams.get('popup') === '1';
if (isPopup) {
  document.body.classList.add('popup-mode');
  // Optional: hide global navbar/footer to maximize real estate
}
```

Add CSS for `.popup-mode` (e.g., hide nav, shrink padding), but **do not strip scripts**—existing JS must run unchanged so features like Add Order still work.

## 3. Page-by-Page Steps

| Area | File(s) | What to hook | Notes |
|------|---------|--------------|-------|
| Customer Add Order | `order.html`, `js/order.js` | CTA buttons (`[href="order.html"]`, dashboard quick actions) should call `openAppPopup('/order.html')`. Within `order.html`, gate nav/footer in `.popup-mode` and rely on the existing form logic. | Keep `localStorage` auth; same-origin popup shares it automatically. |
| Admin Orders (Add/Edit/Failed) | `admin/orders.html`, `js/admin-orders.js` | When admins click "Add Order", "Edit", "Resend" etc., open `/admin/order-form.html?orderId=...&popup=1`. Reuse the current modal logic inside that dedicated page so full validation runs. | Because the popup is same-origin, the existing fetch calls keep working with the admin JWT token. |
| Add Funds | `addfunds.html`, `js/addfunds.js` | Launch as popup from dashboard CTA or header item. Ensure payment providers still load by leaving the page scripts untouched. | Reuse `notifyOpener('ADD_FUNDS_ORDER_CREATED')` so balances refresh. |
| Tickets (customer & admin) | `tickets.html`, `admin/tickets.html`, `js/tickets.js`, `js/admin-tickets.js` | Reply/compose buttons should open the ticket thread in a popup so agents can multitask. Provide fallback to inline modal if `window.open` fails. | Parent listeners can auto-refresh inbox when `popup:ticket-*` fires. |
| Services/API Docs | `services.html`, `api.html`, `api-dashboard.html` | Use popup for "View API Key" or "Clone Service" workflows that need full layout. | Keep CryptoJS/provider syncs executing even when chrome hidden. |
| Contact & Support | `contact.html` | Optional popup for live chat embed; rely on alerts/confirm for micro-interactions. | Popup still posts `CONTACT_MESSAGE_SENT` so dashboard toasts fire. |
| Auth (Sign In/Up) | `signin.html`, `signup.html`, `js/auth-backend.js` | If launched from another page, open in popup to keep the main dashboard visible. After successful login or signup, emit a popup message (`USER_LOGGED_IN`/`USER_SIGNED_UP`) so the parent updates navigation, then close the window. | Popup can also close itself via Escape/close button once auth completes. |

## 4. Communication Between Popup and Parent

Use the `postMessage` API if the popup needs to inform the opener without closing:

```js
// inside popup
window.opener?.postMessage({ type: 'ORDER_CREATED', orderId }, window.location.origin);

// inside parent
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === 'ORDER_CREATED') {
    refreshOrdersAfterAdminChange();
  }
});
```

## 5. Progressive Enhancement & Accessibility

1. Always keep the existing inline flow as a fallback. If `window.open` returns `null`, trigger the current modal/dialog so the action is still possible.
2. Respect user focus: call `popupRef.focus()` after opening, and return focus to the triggering button if the popup closes itself (listen for the `message` event or `setInterval` polling on `popupRef.closed`).
3. For quick confirmations (delete, resend), keep using `confirm()` per W3Schools guidance instead of building new popups.

## 6. Parent Window Hooks (Required)

Every parent page now includes `js/main.js`, which installs the `PopupMessageHub`. It accepts all same-origin `postMessage` payloads and emits high-level custom events you can hook into (`window.addEventListener('popup:order-created', handler)` etc.). The hub also fires user-facing toasts so customers receive immediate feedback without checking the popup.

Supported payload types today:

| Type | Fired by | Parent Reaction |
|------|----------|-----------------|
| `CONTACT_MESSAGE_SENT` | `contact.html` | Green toast + `popup:contact-message-sent` event |
| `ORDER_CREATED` | `order.html`, `dashboard.html` | Toast, `popup:order-created` event (dashboard auto-refreshes orders when sourced externally) |
| `ADD_FUNDS_ORDER_CREATED` | `addfunds.html` | Toast, balance refresh + `loadPayments()` when dashboard is open |
| `TICKET_CREATED` / `TICKET_REPLIED` / `TICKET_CLOSED` | `tickets.html` | Toast + `popup:ticket-*` events for future automation |
| `API_KEY_CREATED` / `API_KEY_DELETED` | `api-dashboard.html` | Toast + `popup:api-key-*` events |
| `PROVIDER_ADDED` / `PROVIDER_DELETED` / `PROVIDER_SYNCED` | `api-dashboard.html` | Toast + `popup:provider-*` events |
| `USER_LOGGED_OUT` | `dashboard.html` popup logout | Clears tokens and updates nav everywhere |
| `USER_LOGGED_IN` | `signin.html`, Google Sign-In | Stores token, updates nav, fires `popup:user-logged-in` |
| `USER_SIGNED_UP` | `signup.html`, Google Sign-Up | Same as above plus `popup:user-signed-up` event |
| `AUTH_REQUIRED` | Any popup detecting missing auth | Shows error and redirects parent to `signin.html` |

If you add a new popup workflow, emit a specific `type` in the payload **and** register its parent-side behavior in `js/main.js` so all pages react consistently.

## 6. Testing Checklist

- [ ] Popup opens centered and resizable on desktop; inline fallback works on mobile.
- [ ] Page detects `popup=1`, hides redundant chrome, and all scripts continue to function (place test orders, add funds, reply to ticket).
- [ ] Cross-window communication (if any) refreshes the parent view.
- [ ] Browser blocks handled gracefully via alert.
- [ ] No console errors in either window.
- [ ] Run `npm run test:popup` against a local `npx netlify dev` server to validate popup + fallback flows.

Once this checklist passes for a page, mark it in the rollout tracker (see `MD/FOOTER_STANDARDIZATION_GUIDE.md` for format) so we know which flows now support popup mode.
