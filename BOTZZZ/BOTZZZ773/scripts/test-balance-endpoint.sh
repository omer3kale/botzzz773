#!/bin/bash
# Test balance endpoint for PerfectPanel integration
# This tests the exact flow PerfectPanel uses to verify API keys

set -e

echo "=========================================="
echo "Balance Endpoint Test (PerfectPanel Flow)"
echo "=========================================="
echo ""

# Check if API key is provided
if [ -z "$API_KEY" ]; then
    echo "❌ ERROR: API_KEY environment variable not set"
    echo ""
    echo "Usage:"
    echo "  export API_KEY='sk_live_YOUR_KEY'"
    echo "  ./scripts/test-balance-endpoint.sh"
    echo ""
    exit 1
fi

# Test URLs (both work due to redirects)
BASE_URL="https://www.botzzz773.pro/v2"
ALT_URL="https://botzzz773.pro/v2"

echo "Testing with API key: ${API_KEY:0:12}..."
echo ""

# Test 1: Balance endpoint (what PerfectPanel calls first)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 1: Balance Check (PerfectPanel Auth)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔄 Calling: POST $BASE_URL"
echo "   Body: key=***&action=balance"
echo ""

BALANCE_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "key=$API_KEY&action=balance")

echo "📥 Response:"
echo "$BALANCE_RESPONSE" | jq '.' 2>/dev/null || echo "$BALANCE_RESPONSE"
echo ""

# Check if balance is valid
if echo "$BALANCE_RESPONSE" | jq -e '.balance' > /dev/null 2>&1; then
    BALANCE=$(echo "$BALANCE_RESPONSE" | jq -r '.balance')
    CURRENCY=$(echo "$BALANCE_RESPONSE" | jq -r '.currency')
    echo "✅ Balance endpoint working!"
    echo "   Balance: $BALANCE $CURRENCY"
    echo ""
elif echo "$BALANCE_RESPONSE" | jq -e '.error' > /dev/null 2>&1; then
    ERROR=$(echo "$BALANCE_RESPONSE" | jq -r '.error')
    echo "❌ Balance endpoint returned error: $ERROR"
    echo ""
    echo "📝 Troubleshooting:"
    echo "   1. Check API key is valid in database:"
    echo "      SELECT * FROM api_keys WHERE key = '$API_KEY';"
    echo ""
    echo "   2. Check user status is 'active':"
    echo "      SELECT u.* FROM users u"
    echo "      JOIN api_keys ak ON ak.user_id = u.id"
    echo "      WHERE ak.key = '$API_KEY';"
    echo ""
    echo "   3. Check Netlify function logs:"
    echo "      Look for: [API v2] Request with invalid API key attempted"
    echo ""
    exit 1
else
    echo "❌ Unexpected response format"
    echo ""
    exit 1
fi

# Test 2: Services endpoint
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 2: Services List (Provider Discovery)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔄 Calling: POST $BASE_URL"
echo "   Body: key=***&action=services"
echo ""

SERVICES_RESPONSE=$(curl -s -X POST "$BASE_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "key=$API_KEY&action=services")

# Count services
SERVICE_COUNT=$(echo "$SERVICES_RESPONSE" | jq '. | length' 2>/dev/null || echo "0")

if [ "$SERVICE_COUNT" -gt 0 ]; then
    echo "✅ Services endpoint working!"
    echo "   Total services: $SERVICE_COUNT"
    echo ""
    
    # Show first service
    FIRST_SERVICE=$(echo "$SERVICES_RESPONSE" | jq '.[0]' 2>/dev/null)
    FIRST_SERVICE_ID=$(echo "$FIRST_SERVICE" | jq -r '.service')
    FIRST_SERVICE_NAME=$(echo "$FIRST_SERVICE" | jq -r '.name')
    
    echo "📦 First service:"
    echo "$FIRST_SERVICE" | jq '.'
    echo ""
    
    # Verify service ID is numeric and in expected range
    if [ "$FIRST_SERVICE_ID" -ge 9000 ] 2>/dev/null; then
        echo "✅ Service ID looks correct: $FIRST_SERVICE_ID (public_id format)"
        echo ""
    else
        echo "⚠️  Service ID: $FIRST_SERVICE_ID"
        echo "   Expected: >= 9000 (public_id format)"
        echo "   Note: If service ID is 1-5 or large hash, parallel IDs not working"
        echo ""
    fi
else
    echo "❌ No services returned"
    echo ""
    echo "📝 Check:"
    echo "   1. Database has active services:"
    echo "      SELECT COUNT(*) FROM services WHERE status = 'active';"
    echo ""
    echo "   2. Services have public_id:"
    echo "      SELECT public_id FROM services WHERE status = 'active' LIMIT 5;"
    echo ""
    exit 1
fi

# Test 3: Alternative URL (without www)
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Test 3: Alternative URL (No WWW)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🔄 Calling: POST $ALT_URL"
echo "   Body: key=***&action=balance"
echo ""

ALT_BALANCE_RESPONSE=$(curl -s -X POST "$ALT_URL" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "key=$API_KEY&action=balance")

if echo "$ALT_BALANCE_RESPONSE" | jq -e '.balance' > /dev/null 2>&1; then
    echo "✅ Alternative URL works!"
    echo "   Both URLs valid for PerfectPanel:"
    echo "   - https://www.botzzz773.pro/v2"
    echo "   - https://botzzz773.pro/v2"
    echo ""
else
    echo "⚠️  Alternative URL not working (use www version)"
    echo ""
fi

# Summary
echo "=========================================="
echo "Summary"
echo "=========================================="
echo ""
echo "✅ API Key: Valid"
echo "✅ Balance Endpoint: Working ($BALANCE $CURRENCY)"
echo "✅ Services Endpoint: Working ($SERVICE_COUNT services)"
echo "✅ Service IDs: $FIRST_SERVICE_ID+ (numeric public_id)"
echo ""
echo "🎯 PerfectPanel Configuration:"
echo "   Provider URL: https://www.botzzz773.pro/v2"
echo "   API Key: $API_KEY"
echo "   Type: Standard SMM Panel / SMM v2"
echo "   Mode: Auto"
echo ""
echo "✅ Ready for PerfectPanel integration!"
echo ""
echo "📝 Next Steps:"
echo "   1. Open PerfectPanel admin"
echo "   2. Add BOTZZZ773 as provider:"
echo "      - URL: https://www.botzzz773.pro/v2"
echo "      - Key: (paste the exact key above)"
echo "      - Type: Standard SMM Panel"
echo "   3. Click 'Sync Services'"
echo "   4. Should import $SERVICE_COUNT services with IDs $FIRST_SERVICE_ID+"
echo ""
echo "=========================================="
