# PerfectPanel Integration - Deployment Checklist

## 📋 Pre-Deployment Verification

### 1. Database Migrations Ready
- [ ] `supabase/migrations/20241210000001_add_public_order_id.sql` exists
- [ ] `supabase/migrations/20241210000002_verify_services_public_id.sql` exists
- [ ] `supabase/migrations/20241210000003_rollback_public_order_id.sql` exists (rollback only)

### 2. Code Changes Ready
- [ ] `/netlify/functions/v2.js` updated with public_id/public_order_id logic
- [ ] No syntax errors (`get_errors` passed)
- [ ] All handlers updated:
  - [ ] `handleServices` - uses public_id in response
  - [ ] `handleAddOrder` - lookups by public_id, returns public_order_id
  - [ ] `handleOrderStatus` - queries by public_order_id
  - [ ] `handleRefill` - queries by public_order_id
- [ ] Comprehensive logging added

### 3. Testing Script Ready
- [ ] `scripts/test-v2-integration.sh` is executable
- [ ] Script tests: services, add, status flow

---

## 🚀 Deployment Steps

### Step 1: Apply Database Migrations (Staging First)

**Run in Supabase SQL Editor (Staging):**

```sql
-- Migration 1: Verify services have public_id
-- Copy/paste contents of: supabase/migrations/20241210000002_verify_services_public_id.sql
-- Click "Run"

-- Wait for completion, then verify:
SELECT 
  COUNT(*) as total_active,
  COUNT(public_id) as with_public_id,
  COUNT(*) - COUNT(public_id) as missing,
  MIN(public_id) as min_id,
  MAX(public_id) as max_id
FROM services
WHERE status = 'active';

-- Expected: missing = 0, min_id >= 7000
```

```sql
-- Migration 2: Add public_order_id to orders
-- Copy/paste contents of: supabase/migrations/20241210000001_add_public_order_id.sql
-- Click "Run"

-- Wait for completion, then verify:
SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_name = 'trg_generate_public_order_id';
-- Expected: 1

SELECT COUNT(*) as total, COUNT(public_order_id) as with_public_id
FROM orders;
-- Expected: total = with_public_id
```

**Checkpoint:** Database migrations successful in staging ✓

---

### Step 2: Deploy Backend Code (Staging)

If using git-based deployment:

```bash
cd /Users/omer3kale/botzzz773/BOTZZZ/BOTZZZ773

# Commit changes
git add netlify/functions/v2.js
git add supabase/migrations/*.sql
git add MD/V2_PARALLEL_IDS_INTEGRATION.md
git add scripts/test-v2-integration.sh

git commit -m "feat: integrate public_id/public_order_id for PerfectPanel compatibility

- Update v2 services handler to use services.public_id
- Update v2 add handler to lookup by public_id and return public_order_id
- Update v2 status/refill handlers to query by public_order_id
- Add comprehensive logging for debugging
- Include Supabase migrations for public_id/public_order_id
- Add integration test script"

# Push to staging branch
git push origin staging
```

Or if deploying via Netlify CLI:

```bash
netlify deploy --prod=false
```

**Checkpoint:** Code deployed to staging ✓

---

### Step 3: Test in Staging

```bash
# Set staging API credentials
export API_URL="https://staging--botzzz773.netlify.app/v2"
export API_KEY="sk_test_YOUR_STAGING_KEY"

# Run integration test
./scripts/test-v2-integration.sh
```

**Expected Output:**
```
✓ Services contain numeric IDs
✓ First service ID: 7097
✓ Service ID looks like public_id (>= 7000)
✓ Order created successfully
✓ Order ID: 1234
✓ Order ID is numeric (public_order_id)
✓ Status check successful
  Status: Pending
  Charge: 0.50
```

**Manual Tests:**

1. **Services Sync:**
```bash
curl -X POST "$API_URL" \
  -d "key=$API_KEY" \
  -d "action=services" | jq '.[0:3]'
```
Expected: `[{"service": 7097, ...}, {"service": 7100, ...}]`

2. **Place Order:**
```bash
curl -X POST "$API_URL" \
  -d "key=$API_KEY" \
  -d "action=add" \
  -d "service=7097" \
  -d "link=https://instagram.com/test" \
  -d "quantity=10"
```
Expected: `{"order": 1234}`

3. **Check Status:**
```bash
curl -X POST "$API_URL" \
  -d "key=$API_KEY" \
  -d "action=status" \
  -d "order=1234"
```
Expected: `{"status": "Pending", "charge": "...", ...}`

**Check Logs:**
```bash
netlify functions:log v2 --tail
```

Look for:
```
[API v2] Exporting service: internal_id=<uuid>, public_id=7097, name=...
[API v2] Looking up service by public_id=7097
[API v2] Found service: internal_id=<uuid>, public_id=7097, name=...
[API v2] Order created: internal_id=<uuid>, public_order_id=1234, charge=...
[API v2] Status lookup by public_order_id=1234
[API v2] Order found: internal_id=<uuid>, public_order_id=1234, status=...
```

**Checkpoint:** All staging tests pass ✓

---

### Step 4: Deploy to Production

**4.1 Backup Production Database:**

In Supabase Dashboard:
1. Go to Settings → Database
2. Click "Create Backup" or note last automatic backup time
3. Confirm backup exists before proceeding

**4.2 Apply Migrations (Production):**

Run same SQL migrations as staging:
```sql
-- 1. Verify services public_id (20241210000002_verify_services_public_id.sql)
-- 2. Add public_order_id (20241210000001_add_public_order_id.sql)
-- 3. Verify both (queries from migration files)
```

**4.3 Deploy Code (Production):**

```bash
# Push to main/master branch
git checkout master
git merge staging
git push origin master

# Or deploy via Netlify
netlify deploy --prod
```

**4.4 Test Production:**

```bash
export API_URL="https://botzzz773.pro/v2"
export API_KEY="sk_live_YOUR_PRODUCTION_KEY"

./scripts/test-v2-integration.sh
```

**Checkpoint:** Production deployment successful ✓

---

### Step 5: Monitor Production

**For the first 30 minutes after deployment:**

1. **Watch Netlify Logs:**
```bash
netlify functions:log v2 --tail
```

2. **Check Supabase Logs:**
- Go to Supabase Dashboard → Logs
- Filter by table: `orders`, `services`
- Look for errors or constraint violations

3. **Monitor Error Rate:**
- Check for increase in error responses
- Look for `"error":"Failed to create order"` or `"error":"Service not found"`

4. **Test Key Scenarios:**
- Place 2-3 real orders
- Check status of existing orders
- Verify admin panel still works
- Confirm dashboard displays correctly

**Common Issues & Fixes:**

| Issue | Cause | Fix |
|-------|-------|-----|
| `Service not found` | Service missing public_id | Re-run migration 2 |
| `Failed to create order` | Trigger not working | Check trigger exists, re-run migration 1 |
| Orders return UUID | v2.js changes not deployed | Re-deploy code |
| Services show index (1,2,3) | Migration not applied | Apply migration 2 |
| Constraint violation on insert | Duplicate public_order_id | Check trigger logic, may need rollback |

---

## 🎯 PerfectPanel Integration Test

Once production is stable, test with PerfectPanel:

### 1. Add BOTZZZ773 as Provider in PerfectPanel

**Settings:**
- Provider Name: `BOTZZZ773`
- API URL: `https://botzzz773.pro/v2`
- API Key: `sk_live_YOUR_PRODUCTION_KEY`
- API Type: `Standard SMM Panel v2`

### 2. Sync Services

Click "Sync Services" in PerfectPanel → Should import services with correct IDs (7097, 7100, etc.)

**Verify in PerfectPanel:**
- Service names match BOTZZZ773 services
- Prices display correctly
- Min/max quantities correct

### 3. Place Test Order from PerfectPanel

1. Create test customer account
2. Add balance
3. Place order for Instagram Followers (or any service)
4. Note the order ID shown in PerfectPanel

### 4. Verify Order in BOTZZZ773

```bash
# Check order was created
curl -X POST "https://botzzz773.pro/v2" \
  -d "key=$API_KEY" \
  -d "action=status" \
  -d "order=<ORDER_ID_FROM_PERFECTPANEL>"
```

**Expected:** Order status returns successfully

**Check Database:**
```sql
SELECT public_order_id, service_id, status, charge, link
FROM orders
WHERE public_order_id = <ORDER_ID_FROM_PERFECTPANEL>;
```

### 5. Monitor Order Status Sync

PerfectPanel should periodically check order status and update its records:
- Pending → Processing → Completed
- Check that status updates propagate to PerfectPanel

**Checkpoint:** PerfectPanel integration working ✓

---

## 🔄 Rollback Procedure (If Needed)

**Only use if critical issues arise:**

### 1. Revert Code:

```bash
git revert HEAD
git push origin master
# Wait for Netlify to deploy
```

### 2. Rollback Database:

```sql
-- Run in Supabase SQL Editor:
-- Copy/paste contents of: supabase/migrations/20241210000003_rollback_public_order_id.sql
-- This removes public_order_id column and trigger

-- Then restore from backup if needed:
-- Settings → Database → Backups → Restore
```

### 3. Verify Rollback:

```bash
# Test old API still works
curl -X POST "https://botzzz773.pro/v2" \
  -d "key=$API_KEY" \
  -d "action=services" | jq '.[0]'

# Should return services (may be with hash IDs again)
```

---

## ✅ Post-Deployment Checklist

- [ ] All staging tests passed
- [ ] Production migrations applied successfully
- [ ] Production code deployed
- [ ] Integration test script passes in production
- [ ] Sample orders placed successfully
- [ ] Status checks work with numeric order IDs
- [ ] Admin panel functionality intact
- [ ] Dashboard displays orders correctly
- [ ] No errors in logs for 30 minutes
- [ ] PerfectPanel sync successful (if ready)
- [ ] PerfectPanel orders work end-to-end
- [ ] Documentation updated

---

## 📊 Success Metrics

After 24 hours:

- ✅ Zero `"error":"Service not found"` in v2 logs
- ✅ Zero `"error":"Failed to create order"` in v2 logs
- ✅ All orders have `public_order_id` populated
- ✅ Status checks return valid responses
- ✅ PerfectPanel orders complete successfully
- ✅ No increase in overall error rate
- ✅ Admin panel/dashboard working normally

---

## 📝 Notes

- **Timeline:** Migrations + deployment = ~15-30 minutes
- **Downtime:** None expected (additive changes only)
- **Risk Level:** Low (parallel IDs strategy, no breaking changes)
- **Rollback Window:** 24 hours (can rollback anytime if needed)

---

**Deployment Date:** ________________  
**Deployed By:** ________________  
**Staging Test Result:** ☐ Pass ☐ Fail  
**Production Test Result:** ☐ Pass ☐ Fail  
**PerfectPanel Integration:** ☐ Pass ☐ Fail ☐ Not Tested Yet  

---

**For Questions/Issues:**
- Check logs: `netlify functions:log v2`
- Check Supabase logs in dashboard
- Review `/MD/V2_PARALLEL_IDS_INTEGRATION.md`
- Run test script: `./scripts/test-v2-integration.sh`
