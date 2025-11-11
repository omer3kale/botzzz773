# 🚨 Netlify Environment Variable Issues Report

**Date:** November 2, 2025  
**Site:** https://darling-profiterole-752433.netlify.app

---

## ❌ RESERVED VARIABLE CONFLICTS

These variables are **RESERVED by Netlify** and will cause errors:

### 1. `SITE_NAME` ⚠️ RESERVED
**Status:** ❌ Cannot use  
**Problem:** Netlify reserves this variable  
**Used in:** 
- Not actually used in any backend code
- Was planned for display purposes only

**Solution:** 
```bash
# REMOVE from Netlify environment variables:
❌ SITE_NAME=SMM Reseller Panel

# Use this alternative instead:
✅ APP_NAME=SMM Reseller Panel
```

**Code changes needed:** None (variable not used in backend)

---

### 2. `PORT` ⚠️ RESERVED
**Status:** ❌ Cannot use  
**Problem:** Netlify controls the port for functions  
**Used in:** 
- Not used in any backend code
- Only used locally in development

**Solution:** 
```bash
# DO NOT ADD to Netlify:
❌ PORT=8888

# This is only for local development (.env file)
```

**Code changes needed:** None (not needed in production)

---

### 3. `NODE_ENV` ⚠️ MANAGED BY NETLIFY
**Status:** ⚠️ Automatically set  
**Problem:** Netlify automatically sets this to `production`  
**Used in:** Not used in backend code

**Solution:** 
```bash
# DO NOT ADD manually - Netlify sets this automatically:
⚠️ NODE_ENV=production (auto-managed)
```

**Code changes needed:** None

---

## ✅ SAFE VARIABLES TO ADD

These variables are **SAFE** and must be added to Netlify:

### Required Database Variables
```bash
SUPABASE_URL=https://qmnbwpmnidguccsiwoow.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtbmJ3cG1uaWRndWNjc2l3b293Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwNDk0MjgsImV4cCI6MjA3NzYyNTQyOH0.wVj6pxggBwhpdih0G0RmV2YQfA2n4s4N31_m73l1mc4
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtbmJ3cG1uaWRndWNjc2l3b293Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjA0OTQyOCwiZXhwIjoyMDc3NjI1NDI4fQ.KW4QgrAME5vEnwxXMKYpffiEbKQRzKuFgNiC_Rq50I0
```

### Required Security Variables
```bash
JWT_SECRET=dvSFnsIPha/fXJ7ylFmmlseKb/hYH6l0JruGAit3P/lbjUA+zJBA300AzqzhZozWQYXcJHzJnV0gIA30CA2B4g==
```

### Required Payment Variables
```bash
PAYEER_MERCHANT_ID=google
PAYEER_SECRET_KEY=kVReJIVjnHcXBZVg
PAYEER_ACCOUNT=P1135223884
```

### Required Site Configuration
```bash
SITE_URL=https://darling-profiterole-752433.netlify.app
FRONTEND_URL=https://darling-profiterole-752433.netlify.app
ADMIN_EMAIL=admin@yoursite.com
```

### Optional (Recommended Replacement)
```bash
APP_NAME=SMM Reseller Panel
```

---

## 🚫 VARIABLES TO SKIP

Do **NOT** add these to Netlify (not needed or disabled):

```bash
# Payment gateways (disabled - using Payeer only):
❌ STRIPE_SECRET_KEY
❌ STRIPE_PUBLISHABLE_KEY
❌ STRIPE_WEBHOOK_SECRET
❌ PAYPAL_CLIENT_ID
❌ PAYPAL_CLIENT_SECRET
❌ PAYPAL_MODE

# Email service (not configured):
❌ SENDGRID_API_KEY
❌ FROM_EMAIL

# Local development only:
❌ PORT=8888
❌ NODE_ENV (auto-managed by Netlify)

# Reserved by Netlify:
❌ SITE_NAME
```

---

## 📋 FINAL CHECKLIST FOR NETLIFY

**Add these 9 variables only:**

- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `JWT_SECRET`
- [ ] `PAYEER_MERCHANT_ID`
- [ ] `PAYEER_SECRET_KEY`
- [ ] `PAYEER_ACCOUNT`
- [ ] `SITE_URL`
- [ ] `FRONTEND_URL`
- [ ] `ADMIN_EMAIL`
- [ ] `APP_NAME` (optional - for future use)

**Total: 10 variables** (11 with optional APP_NAME)

---

## 🔍 VARIABLES USAGE IN CODE

| Variable | Used In | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | `utils/supabase.js` | Database connection |
| `SUPABASE_ANON_KEY` | `utils/supabase.js` | Public database access |
| `SUPABASE_SERVICE_ROLE_KEY` | `utils/supabase.js` | Admin database access |
| `JWT_SECRET` | All functions | Token signing/verification |
| `PAYEER_MERCHANT_ID` | `payeer.js` | Payment merchant ID |
| `PAYEER_SECRET_KEY` | `payeer.js` | Payment signature verification |
| `PAYEER_ACCOUNT` | Not in code | Your Payeer account number |
| `SITE_URL` | `payeer.js`, `payments.js` | Return URLs, webhooks |
| `FRONTEND_URL` | Not in code | CORS configuration (future) |
| `ADMIN_EMAIL` | `contact.js` (commented) | Email notifications (future) |
| ~~`SITE_NAME`~~ | None | ❌ NOT USED - Can skip |
| ~~`PORT`~~ | None | ❌ Local dev only |
| ~~`NODE_ENV`~~ | None | ⚠️ Auto-managed by Netlify |

---

## ⚡ QUICK FIX SUMMARY

**Instead of adding 12 variables, add only 10:**

1. Remove `SITE_NAME` from your list (reserved by Netlify)
2. Skip `PORT` (local development only)
3. Skip `NODE_ENV` (Netlify manages this)
4. Add the remaining 9 required variables
5. Optionally add `APP_NAME` as replacement for `SITE_NAME`

**After adding these, Netlify will auto-redeploy and signup will work!** 🚀

---

## 🐛 DEBUGGING

If signup still fails after adding variables:

1. Check Netlify function logs: https://app.netlify.com/projects/darling-profiterole-752433/logs/functions
2. Verify all 10 variables are set correctly
3. Wait 1-2 minutes for auto-redeploy after adding variables
4. Test signup again

**Common errors:**
- `supabase is not defined` = Missing SUPABASE_* variables
- `jwt must be provided` = Missing JWT_SECRET
- `Invalid signature` = Wrong PAYEER_SECRET_KEY
