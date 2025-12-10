#!/bin/bash
# V2 API Integration Test Script
# Tests PerfectPanel-compatible service and order flow

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_URL="${API_URL:-https://botzzz773.pro/v2}"
API_KEY="${API_KEY:-}"

# Check API key
if [ -z "$API_KEY" ]; then
  echo -e "${RED}Error: API_KEY environment variable not set${NC}"
  echo "Usage: API_KEY=sk_live_xxx ./test-v2-integration.sh"
  exit 1
fi

echo "=========================================="
echo "V2 API Integration Test"
echo "=========================================="
echo "API URL: $API_URL"
echo "API Key: ${API_KEY:0:15}..."
echo ""

# Test 1: Services List
echo -e "${YELLOW}Test 1: Fetching services list${NC}"
SERVICES_RESPONSE=$(curl -s -X POST "$API_URL" \
  -d "key=$API_KEY" \
  -d "action=services")

echo "Response:"
echo "$SERVICES_RESPONSE" | jq '.[0:3]' 2>/dev/null || echo "$SERVICES_RESPONSE"

# Check if response contains public_id
if echo "$SERVICES_RESPONSE" | grep -q '"service":[0-9]'; then
  echo -e "${GREEN}✓ Services contain numeric IDs${NC}"
  
  # Extract first service ID
  FIRST_SERVICE_ID=$(echo "$SERVICES_RESPONSE" | jq -r '.[0].service' 2>/dev/null || echo "")
  
  if [ -n "$FIRST_SERVICE_ID" ] && [ "$FIRST_SERVICE_ID" != "null" ]; then
    echo -e "${GREEN}✓ First service ID: $FIRST_SERVICE_ID${NC}"
    
    # Check if it's a reasonable public_id (>= 7000 based on PUBLIC_ID_BASE)
    if [ "$FIRST_SERVICE_ID" -ge 7000 ] 2>/dev/null; then
      echo -e "${GREEN}✓ Service ID looks like public_id (>= 7000)${NC}"
    else
      echo -e "${YELLOW}⚠ Service ID is $FIRST_SERVICE_ID (expected >= 7000 for public_id)${NC}"
      echo -e "${YELLOW}  This might be an index or hash - check migration status${NC}"
    fi
  else
    echo -e "${RED}✗ Could not extract service ID${NC}"
    FIRST_SERVICE_ID=""
  fi
else
  echo -e "${RED}✗ Services response doesn't contain numeric IDs${NC}"
  echo "Full response: $SERVICES_RESPONSE"
  exit 1
fi

echo ""

# Test 2: Place Test Order (only if we have a valid service ID)
if [ -n "$FIRST_SERVICE_ID" ]; then
  echo -e "${YELLOW}Test 2: Placing test order${NC}"
  
  # Use a test link
  TEST_LINK="https://instagram.com/botzzz773_test_$(date +%s)"
  
  ORDER_RESPONSE=$(curl -s -X POST "$API_URL" \
    -d "key=$API_KEY" \
    -d "action=add" \
    -d "service=$FIRST_SERVICE_ID" \
    -d "link=$TEST_LINK" \
    -d "quantity=10")
  
  echo "Response:"
  echo "$ORDER_RESPONSE" | jq '.' 2>/dev/null || echo "$ORDER_RESPONSE"
  
  # Check for order ID in response
  if echo "$ORDER_RESPONSE" | grep -q '"order":[0-9]'; then
    ORDER_ID=$(echo "$ORDER_RESPONSE" | jq -r '.order' 2>/dev/null || echo "")
    
    if [ -n "$ORDER_ID" ] && [ "$ORDER_ID" != "null" ]; then
      echo -e "${GREEN}✓ Order created successfully${NC}"
      echo -e "${GREEN}✓ Order ID: $ORDER_ID${NC}"
      
      # Check if it's a numeric ID (not UUID)
      if echo "$ORDER_ID" | grep -qE '^[0-9]+$'; then
        echo -e "${GREEN}✓ Order ID is numeric (public_order_id)${NC}"
        
        # Test 3: Check Order Status
        echo ""
        echo -e "${YELLOW}Test 3: Checking order status${NC}"
        
        STATUS_RESPONSE=$(curl -s -X POST "$API_URL" \
          -d "key=$API_KEY" \
          -d "action=status" \
          -d "order=$ORDER_ID")
        
        echo "Response:"
        echo "$STATUS_RESPONSE" | jq '.' 2>/dev/null || echo "$STATUS_RESPONSE"
        
        if echo "$STATUS_RESPONSE" | grep -q '"status"'; then
          STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status' 2>/dev/null || echo "")
          CHARGE=$(echo "$STATUS_RESPONSE" | jq -r '.charge' 2>/dev/null || echo "")
          
          echo -e "${GREEN}✓ Status check successful${NC}"
          echo -e "${GREEN}  Status: $STATUS${NC}"
          echo -e "${GREEN}  Charge: $CHARGE${NC}"
        else
          echo -e "${RED}✗ Status check failed${NC}"
          echo "Full response: $STATUS_RESPONSE"
        fi
        
      else
        echo -e "${YELLOW}⚠ Order ID looks like UUID (expected numeric public_order_id)${NC}"
        echo -e "${YELLOW}  Check if migrations were applied and v2.js changes deployed${NC}"
      fi
    else
      echo -e "${RED}✗ Could not extract order ID${NC}"
    fi
  else
    # Check for error message
    if echo "$ORDER_RESPONSE" | grep -q '"error"'; then
      ERROR=$(echo "$ORDER_RESPONSE" | jq -r '.error' 2>/dev/null || echo "Unknown error")
      echo -e "${RED}✗ Order creation failed: $ERROR${NC}"
      
      case "$ERROR" in
        "Service not found")
          echo -e "${YELLOW}Troubleshooting:${NC}"
          echo "  1. Check if service has public_id assigned:"
          echo "     SELECT id, public_id, name, status FROM services WHERE public_id = $FIRST_SERVICE_ID;"
          echo "  2. Run migration: 20241210000002_verify_services_public_id.sql"
          ;;
        "Insufficient funds")
          echo -e "${YELLOW}Troubleshooting:${NC}"
          echo "  1. Add funds to your account"
          echo "  2. Check balance: curl -X POST $API_URL -d 'key=$API_KEY' -d 'action=balance'"
          ;;
        "Failed to create order")
          echo -e "${YELLOW}Troubleshooting:${NC}"
          echo "  1. Check Netlify function logs for detailed error"
          echo "  2. Verify public_order_id trigger exists:"
          echo "     SELECT trigger_name FROM information_schema.triggers WHERE event_object_table = 'orders';"
          echo "  3. Run migration: 20241210000001_add_public_order_id.sql"
          ;;
      esac
    else
      echo -e "${RED}✗ Order creation failed with unexpected response${NC}"
      echo "Full response: $ORDER_RESPONSE"
    fi
  fi
fi

echo ""
echo "=========================================="
echo "Integration Test Complete"
echo "=========================================="

# Summary
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "1. Review the responses above"
echo "2. If service IDs are < 7000 or look like hashes, migrations may not be applied"
echo "3. If order IDs are UUIDs, v2.js changes may not be deployed"
echo "4. Check Netlify function logs for detailed debug output"
echo "5. Verify database state:"
echo "   - SELECT COUNT(*), MIN(public_id), MAX(public_id) FROM services WHERE status = 'active';"
echo "   - SELECT COUNT(*) FROM orders WHERE public_order_id IS NOT NULL;"
echo ""
echo "For PerfectPanel integration:"
echo "  - Service IDs should be >= 7000 (matching services.public_id)"
echo "  - Order IDs should be numeric (matching orders.public_order_id)"
echo "  - Status checks should work with numeric order IDs"
