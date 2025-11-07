// Public API v2 Test Suite
// Test the external-facing API that uses API keys

const API_URL = process.env.API_URL || 'https://botzzz773.pro/.netlify/functions/v2';
let TEST_API_KEY = null;

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m'
};

function log(color, message) {
  console.log(color + message + colors.reset);
}

async function apiCall(data) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });
  
  const result = await response.json();
  return { status: response.status, data: result };
}

async function testNoApiKey() {
  log(colors.blue, '\n🧪 Test 1: Request without API key');
  const result = await apiCall({ action: 'services' });
  
  if (result.status === 401 && result.data.error) {
    log(colors.green, '✓ Correctly rejected request without API key');
    return true;
  }
  log(colors.red, '✗ Failed: Should reject requests without API key');
  return false;
}

async function testInvalidApiKey() {
  log(colors.blue, '\n🧪 Test 2: Request with invalid API key');
  const result = await apiCall({
    key: 'sk_invalid_key_12345',
    action: 'services'
  });
  
  if (result.status === 401 && result.data.error) {
    log(colors.green, '✓ Correctly rejected invalid API key');
    return true;
  }
  log(colors.red, '✗ Failed: Should reject invalid API key');
  return false;
}

async function testGetServices() {
  if (!TEST_API_KEY) {
    log(colors.yellow, '⚠ Skipping: No API key provided');
    return false;
  }
  
  log(colors.blue, '\n🧪 Test 3: Get services list');
  const result = await apiCall({
    key: TEST_API_KEY,
    action: 'services'
  });
  
  if (result.status === 200 && Array.isArray(result.data)) {
    log(colors.green, `✓ Retrieved ${result.data.length} services`);
    if (result.data.length > 0) {
      const service = result.data[0];
      log(colors.blue, `  Sample service: ${service.name} - $${service.rate}`);
    }
    return true;
  }
  log(colors.red, '✗ Failed: Should return services array');
  return false;
}

async function testGetBalance() {
  if (!TEST_API_KEY) {
    log(colors.yellow, '⚠ Skipping: No API key provided');
    return false;
  }
  
  log(colors.blue, '\n🧪 Test 4: Get account balance');
  const result = await apiCall({
    key: TEST_API_KEY,
    action: 'balance'
  });
  
  if (result.status === 200 && result.data.balance !== undefined) {
    log(colors.green, `✓ Balance: $${result.data.balance} ${result.data.currency}`);
    return true;
  }
  log(colors.red, '✗ Failed: Should return balance');
  return false;
}

async function testAddOrder() {
  if (!TEST_API_KEY) {
    log(colors.yellow, '⚠ Skipping: No API key provided');
    return false;
  }
  
  log(colors.blue, '\n🧪 Test 5: Create order (will fail if insufficient balance)');
  const result = await apiCall({
    key: TEST_API_KEY,
    action: 'add',
    service: 1,
    link: 'https://instagram.com/testuser',
    quantity: 100
  });
  
  if (result.status === 200 && result.data.order) {
    log(colors.green, `✓ Order created: #${result.data.order}`);
    return true;
  } else if (result.status === 400 && result.data.error.includes('balance')) {
    log(colors.yellow, '⚠ Order failed due to insufficient balance (expected)');
    return true;
  } else if (result.status === 404) {
    log(colors.yellow, '⚠ Service not found (add services first)');
    return true;
  }
  log(colors.red, `✗ Unexpected response: ${result.data.error}`);
  return false;
}

async function testInvalidAction() {
  if (!TEST_API_KEY) {
    log(colors.yellow, '⚠ Skipping: No API key provided');
    return false;
  }
  
  log(colors.blue, '\n🧪 Test 6: Invalid action');
  const result = await apiCall({
    key: TEST_API_KEY,
    action: 'invalid_action'
  });
  
  if (result.status === 400 && result.data.error) {
    log(colors.green, '✓ Correctly rejected invalid action');
    return true;
  }
  log(colors.red, '✗ Failed: Should reject invalid action');
  return false;
}

async function runTests() {
  log(colors.yellow, '\n╔════════════════════════════════════════╗');
  log(colors.yellow, '║   Public API v2 Test Suite            ║');
  log(colors.yellow, '╚════════════════════════════════════════╝');
  
  // Check for API key in environment
  TEST_API_KEY = process.env.TEST_API_KEY || process.argv[2];
  
  if (!TEST_API_KEY) {
    log(colors.yellow, '\n⚠️  No API key provided. Limited tests will run.');
    log(colors.yellow, '   To test with API key, run: node v2-api-test.js YOUR_API_KEY');
    log(colors.yellow, '   Or set TEST_API_KEY environment variable\n');
  } else {
    log(colors.green, `\n✓ Using API key: ${TEST_API_KEY.substring(0, 15)}...`);
  }
  
  const tests = [
    testNoApiKey,
    testInvalidApiKey,
    testGetServices,
    testGetBalance,
    testAddOrder,
    testInvalidAction
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test();
      if (result) passed++;
      else failed++;
    } catch (error) {
      failed++;
      log(colors.red, `✗ Test error: ${error.message}`);
    }
  }
  
  log(colors.yellow, '\n╔════════════════════════════════════════╗');
  log(colors.yellow, '║   Test Results                         ║');
  log(colors.yellow, '╚════════════════════════════════════════╝');
  log(colors.green, `✓ Passed: ${passed}/${passed + failed}`);
  if (failed > 0) {
    log(colors.red, `✗ Failed: ${failed}/${passed + failed}`);
  }
  
  log(colors.blue, '\n📖 Integration Guide:');
  log(colors.blue, '1. Generate API key from dashboard: https://botzzz773.pro/api-dashboard.html');
  log(colors.blue, '2. Use endpoint: https://botzzz773.pro/.netlify/functions/v2');
  log(colors.blue, '3. Send POST requests with { key, action, ...params }');
  log(colors.blue, '4. Supported actions: services, add, status, balance, refill\n');
  
  if (failed > 0) process.exit(1);
}

// Run if called directly
if (require.main === module) {
  runTests().catch(error => {
    log(colors.red, `Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { runTests };
