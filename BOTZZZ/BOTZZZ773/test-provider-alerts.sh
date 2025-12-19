#!/bin/bash
# Test Provider Low Balance Alert System

echo "=== Provider Balance Alert System - Testing Guide ==="

# 1. Set threshold to 1000 USD temporarily for testing
echo "1️⃣  Setting low threshold (1000 USD) in admin dashboard to trigger alerts"
echo "   - Go to Admin > Settings > Payment Settings"
echo "   - Set 'Minimum Balance Threshold' to 1000"
echo "   - Ensure 'Send Alert When Provider Balance Low' is checked"
echo "   - Click Save Changes"
echo ""

# 2. Manually trigger sync
echo "2️⃣  Triggering provider sync manually:"
echo "   curl https://<your-domain>/.netlify/functions/scheduled-provider-sync"
echo ""

# 3. Check logs
echo "3️⃣  Check function logs in Netlify:"
echo "   - Go to Netlify Dashboard > Functions"
echo "   - Look for 'scheduled-provider-sync' function"
echo "   - Filter logs for 'Low balance alert'"
echo ""

# 4. Verify database
echo "4️⃣  Check provider_balance_alerts table in Supabase:"
echo "   SELECT * FROM provider_balance_alerts ORDER BY created_at DESC LIMIT 10;"
echo ""

# 5. Check email
echo "5️⃣  Check SMTP logs:"
echo "   - Test email should be sent to admin email (from general settings)"
echo "   - Check mailbox or SMTP logs for 'Low Balance Alert' email"
echo ""

# 6. Verify 24h prevention
echo "6️⃣  Test 24-hour spam prevention:"
echo "   - Trigger sync again immediately (step 2)"
echo "   - Should NOT send duplicate email for same provider"
echo "   - Check logs: 'Alert already sent recently'"
echo ""

# 7. Reset threshold
echo "7️⃣  After testing, reset threshold back to 0.5 USD:"
echo "   - Go to Admin > Settings > Payment Settings"
echo "   - Set 'Minimum Balance Threshold' back to 0.5"
echo "   - Click Save Changes"
echo ""

echo "✅ Testing complete!"
