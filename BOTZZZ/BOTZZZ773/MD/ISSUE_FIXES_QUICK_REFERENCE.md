# Issue Fixes Quick Reference

## 1. Customer Dashboard Payments Tab ✅ COMPLETED
**Status**: Completed
**Files modified**:
- `dashboard.html` - ✅ Added payments sidebar link and payments view with table structure
- `css/dashboard-styles.css` - ✅ Added comprehensive payments view styling matching theme
- `js/dashboard.js` - ✅ Added loadPayments(), showPaymentsView(), displayPayments() functions
- `netlify/functions/payments.js` - ✅ Already supports customer scope with user_id filtering

**Implementation**: ✅ Added "Payments" link in sidebar, created payments view with table showing ID, Date, Method, Amount, Status columns. Includes loading states, empty states, error handling, and responsive design.

## 2. Decimal Precision for Sub-Cent Rates
**Status**: Not Started  
**Files to check**:
- `js/dashboard.js` - `formatCurrencyDisplay()` function (line 206)
- `js/services.js` - Price display logic
- `js/order.js` - Charge calculation
- `netlify/functions/orders.js` - Server-side calculation

**Fix**: Update `formatCurrencyDisplay()` to use dynamic decimal places based on amount magnitude. For amounts < $0.01, show 4-6 decimals. For amounts >= $1, show 2 decimals.

## 3. OTP Policy Migration Error (42710) ✅ COMPLETED
**Status**: Completed
**File**: `supabase/migrations/20251119_create_admin_otp.sql` - ✅ FIXED
**Error**: ✅ RESOLVED - `policy "No public access to OTP codes" already exists`

**Fix**: ✅ Made policy creation idempotent by adding `DROP POLICY IF EXISTS` before `CREATE POLICY`.

```sql
-- Replace line 20-22 with:
DROP POLICY IF EXISTS "No public access to OTP codes" ON public.admin_otp_codes;
CREATE POLICY "No public access to OTP codes" ON public.admin_otp_codes
    FOR ALL
    USING (false);
```

## 4. Remove Customer Services Limit (7-item cap)
**Status**: Not Started
**Files to check**:
- `js/dashboard.js` - Service loading and display logic
- `js/services.js` - Service filtering/limiting
- `netlify/functions/services.js` - API response limiting

**Investigation needed**: Find where 7-service limit is enforced in customer views.

## 5. Admin Service Categories Missing
**Status**: Not Started
**Files to check**:
- `admin/services.html` - Add service form
- `js/admin-services.js` - Category dropdown/creation
- `netlify/functions/services.js` - Category handling in create/update

**Fix**: Add category field to admin service creation form with dropdown of existing categories plus "Add new" option.

## 6. Tricky Test Cases Implementation
**Status**: Documented
**File**: `MD/ADMIN_FEATURES_TEST_REPORT.md` - Updated with detailed test cases
**Coverage**: 10 test scenarios including domain redirects, viewport checks, rate precision, payment flows, auth guards, heartbeat, PWA, category filters, provider recovery.