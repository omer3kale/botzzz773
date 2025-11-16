# Fetch Guard Coverage Tracker

This checklist enumerates every HTML page in the repo (excluding `node_modules`) and indicates whether the fetch guard script is currently wired. Use it to keep the reliability layer consistent as new shells are added.

| Page | Guard Script | Status |
| --- | --- | --- |
| `index.html` | `js/main.js` | ✅ Already included |
| `services.html` | `js/main.js` | ✅ |
| `api.html` | `js/main.js` | ✅ |
| `api-dashboard.html` | `js/main.js` | ✅ |
| `dashboard.html` | `js/main.js` | ✅ |
| `order.html` | `js/main.js` | ✅ |
| `addfunds.html` | `js/main.js` | ✅ |
| `tickets.html` | `js/main.js` | ✅ |
| `contact.html` | `js/main.js` | ✅ |
| `signin.html` | `js/main.js` | ✅ |
| `signup.html` | `js/main.js` | ✅ |
| `payment-success.html` | `js/main.js` | ✅ |
| `payment-failed.html` | `js/main.js` | ✅ |
| `security-migration.html` | `js/main.js` | ✅ |
| `test-services.html` | `js/main.js` | ✅ |
| `tests/order-page-test.html` | `../js/main.js` | ✅ |
| `tests/test-runner.html` | `../js/main.js` | ✅ |
| `tests/api-tests.html` | `../js/main.js` | ✅ |
| `admin/index.html` | `../js/admin-auth.js` | ✅ |
| `admin/services.html` | `../js/admin-auth.js` | ✅ |
| `admin/payments.html` | `../js/admin-auth.js` | ✅ |
| `admin/users.html` | `../js/admin-auth.js` | ✅ |
| `admin/tickets.html` | `../js/admin-auth.js` | ✅ |
| `admin/settings.html` | `../js/admin-auth.js` | ✅ |
| `admin/reports.html` | `../js/admin-auth.js` | ✅ |
| `admin/orders.html` | `../js/admin-auth.js` | ✅ |
| `tests/admin-features-test.html` | `../js/admin-auth.js` | ✅ |

_Update this table as new HTML entry points are created or wired._
