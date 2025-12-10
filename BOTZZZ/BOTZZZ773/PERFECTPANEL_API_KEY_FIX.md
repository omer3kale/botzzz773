# 🔑 PerfectPanel API Key Integration Guide

**Issue:** "Invalid API key" in PerfectPanel when adding BOTZZZ773 provider

**Root Cause:** PerfectPanel calls `action=balance` to verify API keys, and any error causes "Invalid API key" message.

---

## ✅ Solution Checklist

### 1️⃣ Get Valid API Key

Your API key MUST:
- Start with `sk_` (e.g., `sk_live_abc123...`)
- Be generated from your **API Dashboard** at https://botzzz773.pro/api-dashboard.html
- Be associated with an **active** user account
- Have status = `active` in database

**Check in database:**
```sql
SELECT 
  ak.key,
  ak.status as key_status,
  u.email,
  u.status as user_status,
  u.balance
FROM api_keys ak
JOIN users u ON ak.user_id = u.id
WHERE ak.key = 'YOUR_KEY_HERE';
```

✅ Should return: `key_status=active`, `user_status=active`

---

### 2️⃣ Test Balance Endpoint Locally

**Use the automated test script:**
```bash
cd /Users/omer3kale/botzzz773/BOTZZZ/BOTZZZ773

export API_KEY="sk_live_YOUR_ACTUAL_KEY"
./scripts/test-balance-endpoint.sh
```

**Or test manually:**
```bash
curl -X POST https://www.botzzz773.pro/v2 \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "key=YOUR_KEY&action=balance"
```

**✅ Expected response:**
```json
{
  "balance": "123.45",
  "currency": "USD"
}
```

**❌ If you get:**
```json
{
  "error": "Invalid API key"
}
```

**Then check:**
1. Key exists in `api_keys` table
2. Key starts with `sk_`
3. User account is active
4. No typos (spaces, quotes, truncation)

---

### 3️⃣ Verify Services Return Numeric IDs

```bash
curl -X POST https://www.botzzz773.pro/v2 \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "key=YOUR_KEY&action=services" | jq '.[0]'
```

**✅ Expected response:**
```json
{
  "service": 9070,     // ← Should be 9000+, not 1-5, not large hash
  "name": "Service Name",
  "rate": "0.50",
  "min": "10",
  "max": "10000",
  "category": "Instagram",
  "type": "Default"
}
```

If `service` is **not** 9000+, parallel IDs migration didn't work.

---

### 4️⃣ Configure PerfectPanel

**Provider Settings:**

| Field | Value |
|-------|-------|
| **Provider URL** | `https://www.botzzz773.pro/v2` |
| **API Key** | `sk_live_YOUR_ACTUAL_KEY` (no spaces) |
| **API Type** | Standard SMM Panel / SMM v2 |
| **Mode** | Auto |

**⚠️ Common Mistakes:**

❌ `https://botzzz773.pro/api/v2` (wrong path)  
❌ `https://botzzz773.pro/v2/` (trailing slash breaks some panels)  
❌ `http://botzzz773.pro/v2` (not HTTPS)  
✅ `https://www.botzzz773.pro/v2` (correct)

---

## 🔍 Debugging Steps

### Step 1: Check Netlify Function Logs

```bash
# Real-time logs (if you have Netlify CLI)
netlify functions:log v2 --tail

# Or check in Netlify dashboard:
# https://app.netlify.com/sites/YOUR_SITE/functions/v2
```

**Look for:**
```
[API v2] Request attempted without API key
[API v2] Request with invalid API key attempted
[API v2] Balance request: user=..., balance=...
```

### Step 2: Verify API Key in Database

```sql
-- Check if key exists
SELECT 
  id, 
  key, 
  user_id, 
  status, 
  created_at,
  last_used
FROM api_keys 
WHERE key = 'YOUR_KEY_HERE';

-- Check associated user
SELECT 
  u.id,
  u.email,
  u.status,
  u.role,
  u.balance
FROM users u
JOIN api_keys ak ON ak.user_id = u.id
WHERE ak.key = 'YOUR_KEY_HERE';
```

### Step 3: Test Each Endpoint

**Balance:**
```bash
curl -X POST https://www.botzzz773.pro/v2 \
  -d "key=YOUR_KEY&action=balance"
# Expected: {"balance":"X.XX","currency":"USD"}
```

**Services:**
```bash
curl -X POST https://www.botzzz773.pro/v2 \
  -d "key=YOUR_KEY&action=services" | jq 'length'
# Expected: 153 (or your service count)
```

**Order Creation:**
```bash
curl -X POST https://www.botzzz773.pro/v2 \
  -d "key=YOUR_KEY" \
  -d "action=add" \
  -d "service=9070" \
  -d "link=https://instagram.com/test_$(date +%s)" \
  -d "quantity=10"
# Expected: {"order":1065}
```

---

## 🚨 Common Error Messages

### "Invalid API key" in PerfectPanel

**Cause:** Balance endpoint returned `{"error":"Invalid API key"}`

**Fix:**
1. Copy exact key from your API dashboard
2. Test with `curl` (see Step 2️⃣ above)
3. Check logs for "invalid API key attempted"
4. Verify key in database

### "Service not found" when placing order

**Cause:** Service ID mismatch (v2 expects numeric, got UUID)

**Fix:**
1. Check services endpoint returns numeric IDs (9070+)
2. If not, re-run migration: `supabase/migrations/RUN_THIS_MIGRATION.sql`
3. Verify: `SELECT public_id FROM services WHERE status='active' LIMIT 5;`

### Empty services list `[]`

**Cause:** No active services or auth failed silently

**Fix:**
1. Check: `SELECT COUNT(*) FROM services WHERE status='active';`
2. Test with valid key (not `key=test`)
3. Services list works without key but returns empty for invalid key

---

## 📋 Quick Reference

**Test Script:**
```bash
export API_KEY="sk_live_YOUR_KEY"
./scripts/test-balance-endpoint.sh
```

**Expected Output:**
```
✅ API Key: Valid
✅ Balance Endpoint: Working (123.45 USD)
✅ Services Endpoint: Working (153 services)
✅ Service IDs: 9070+ (numeric public_id)
```

**PerfectPanel Config:**
- URL: `https://www.botzzz773.pro/v2`
- Key: Your actual `sk_live_` key
- Type: Standard SMM Panel

**Database Queries:**
```sql
-- Valid API keys
SELECT key FROM api_keys WHERE status='active' LIMIT 5;

-- Service IDs
SELECT public_id, name FROM services WHERE status='active' LIMIT 5;

-- Order IDs
SELECT public_order_id, status FROM orders ORDER BY created_at DESC LIMIT 5;
```

---

## 🎯 Success Criteria

✅ `curl ... action=balance` returns valid balance  
✅ `curl ... action=services` returns array with numeric IDs 9070+  
✅ PerfectPanel shows no "Invalid API key" error  
✅ PerfectPanel successfully syncs 153 services  
✅ Can place test order from PerfectPanel  

---

**Last Updated:** December 10, 2025  
**Related Files:**
- `netlify/functions/v2.js` - API handler with parallel IDs
- `supabase/migrations/RUN_THIS_MIGRATION.sql` - Database setup
- `scripts/test-balance-endpoint.sh` - Automated testing
