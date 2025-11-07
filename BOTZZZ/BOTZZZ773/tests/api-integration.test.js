/**
 * API Integration Tests - Customer API Workflow
 * Tests the complete flow: Generate API Key -> List Services -> Place Order -> Check Status
 * Run: node tests/api-integration.test.js
 */

const https = require('https');

// Configuration
const BASE_URL = process.env.TEST_URL || 'https://botzzz773.pro';
const API_ENDPOINT = `${BASE_URL}/.netlify/functions/v2`;
const AUTH_ENDPOINT = `${BASE_URL}/.netlify/functions/auth`;
const API_KEYS_ENDPOINT = `${BASE_URL}/.netlify/functions/api-keys`;

// Test credentials (you should create a test user)
const TEST_USER = {
    email: process.env.TEST_EMAIL || 'test@botzzz773.com',
    password: process.env.TEST_PASSWORD || 'Test123!'
};

// Test statistics
let stats = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0
};

// Test context
let testContext = {
    userToken: null,
    apiKey: null,
    serviceId: null,
    orderId: null
};

// Color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

/**
 * Make HTTP request
 */
function makeRequest(url, options = {}, data = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const requestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        };

        const req = https.request(requestOptions, (res) => {
            let body = '';
            res.on('data', (chunk) => body += chunk);
            res.on('end', () => {
                try {
                    const response = {
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: body ? JSON.parse(body) : null
                    };
                    resolve(response);
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        body: body
                    });
                }
            });
        });

        req.on('error', reject);

        if (data) {
            req.write(typeof data === 'string' ? data : JSON.stringify(data));
        }

        req.end();
    });
}

/**
 * Test assertion helper
 */
function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

/**
 * Test runner
 */
async function test(name, fn) {
    stats.total++;
    process.stdout.write(`${colors.cyan}▶${colors.reset} ${name}... `);
    
    try {
        await fn();
        stats.passed++;
        console.log(`${colors.green}✓ PASS${colors.reset}`);
        return true;
    } catch (error) {
        stats.failed++;
        console.log(`${colors.red}✗ FAIL${colors.reset}`);
        console.log(`  ${colors.red}Error: ${error.message}${colors.reset}`);
        if (error.stack) {
            console.log(`  ${colors.reset}${error.stack.split('\n').slice(1, 3).join('\n')}${colors.reset}`);
        }
        return false;
    }
}

/**
 * Test Suite: Authentication
 */
async function testAuthentication() {
    console.log(`\n${colors.bright}${colors.blue}━━━ Authentication Tests ━━━${colors.reset}\n`);

    await test('User login with valid credentials', async () => {
        const response = await makeRequest(AUTH_ENDPOINT, {
            method: 'POST'
        }, {
            action: 'login',
            email: TEST_USER.email,
            password: TEST_USER.password
        });

        assert(response.statusCode === 200, `Expected 200, got ${response.statusCode}`);
        assert(response.body.success === true, 'Login should succeed');
        assert(response.body.token, 'Should return token');
        assert(response.body.user, 'Should return user object');

        testContext.userToken = response.body.token;
        testContext.userId = response.body.user.id;
    });

    await test('Login with invalid credentials should fail', async () => {
        const response = await makeRequest(AUTH_ENDPOINT, {
            method: 'POST'
        }, {
            action: 'login',
            email: TEST_USER.email,
            password: 'WrongPassword123!'
        });

        assert(response.statusCode === 401, `Expected 401, got ${response.statusCode}`);
        assert(response.body.success === false, 'Login should fail');
    });
}

/**
 * Test Suite: API Key Management
 */
async function testApiKeyManagement() {
    console.log(`\n${colors.bright}${colors.blue}━━━ API Key Management Tests ━━━${colors.reset}\n`);

    await test('Generate new API key', async () => {
        const response = await makeRequest(API_KEYS_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${testContext.userToken}`
            }
        }, {
            name: 'Test API Key',
            permissions: ['read', 'write']
        });

        assert(response.statusCode === 200 || response.statusCode === 201, `Expected 200/201, got ${response.statusCode}`);
        assert(response.body.success === true, 'API key generation should succeed');
        assert(response.body.key, 'Should return API key');
        assert(response.body.key.startsWith('sk_'), 'API key should start with sk_');

        testContext.apiKey = response.body.key;
    });

    await test('List user API keys', async () => {
        const response = await makeRequest(API_KEYS_ENDPOINT, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${testContext.userToken}`
            }
        });

        assert(response.statusCode === 200, `Expected 200, got ${response.statusCode}`);
        assert(Array.isArray(response.body.keys), 'Should return array of keys');
        assert(response.body.keys.length > 0, 'Should have at least one API key');
    });

    await test('Generate API key without authentication should fail', async () => {
        const response = await makeRequest(API_KEYS_ENDPOINT, {
            method: 'POST'
        }, {
            name: 'Unauthorized Key'
        });

        assert(response.statusCode === 401, `Expected 401, got ${response.statusCode}`);
    });
}

/**
 * Test Suite: V2 API - Services
 */
async function testV2ApiServices() {
    console.log(`\n${colors.bright}${colors.blue}━━━ V2 API - Services Tests ━━━${colors.reset}\n`);

    await test('Get services list with valid API key', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            key: testContext.apiKey,
            action: 'services'
        });

        assert(response.statusCode === 200, `Expected 200, got ${response.statusCode}`);
        assert(Array.isArray(response.body), 'Should return array of services');
        
        if (response.body.length > 0) {
            const service = response.body[0];
            assert(service.service, 'Service should have service ID');
            assert(service.name, 'Service should have name');
            assert(service.rate, 'Service should have rate');
            assert(service.min, 'Service should have min quantity');
            assert(service.max, 'Service should have max quantity');
            
            testContext.serviceId = service.service;
        }
    });

    await test('Get services without API key should fail', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            action: 'services'
        });

        assert(response.statusCode === 401, `Expected 401, got ${response.statusCode}`);
        assert(response.body.error, 'Should return error message');
    });

    await test('Get services with invalid API key should fail', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            key: 'sk_invalid_key_123456789',
            action: 'services'
        });

        assert(response.statusCode === 401, `Expected 401, got ${response.statusCode}`);
    });
}

/**
 * Test Suite: V2 API - Balance
 */
async function testV2ApiBalance() {
    console.log(`\n${colors.bright}${colors.blue}━━━ V2 API - Balance Tests ━━━${colors.reset}\n`);

    await test('Get account balance with valid API key', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            key: testContext.apiKey,
            action: 'balance'
        });

        assert(response.statusCode === 200, `Expected 200, got ${response.statusCode}`);
        assert(response.body.balance !== undefined, 'Should return balance');
        assert(response.body.currency, 'Should return currency');
        assert(typeof response.body.balance === 'string' || typeof response.body.balance === 'number', 'Balance should be number or string');
    });

    await test('Get balance without API key should fail', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            action: 'balance'
        });

        assert(response.statusCode === 401, `Expected 401, got ${response.statusCode}`);
    });
}

/**
 * Test Suite: V2 API - Orders
 */
async function testV2ApiOrders() {
    console.log(`\n${colors.bright}${colors.blue}━━━ V2 API - Order Placement Tests ━━━${colors.reset}\n`);

    await test('Place order with valid data', async () => {
        if (!testContext.serviceId) {
            console.log(`  ${colors.yellow}⚠ Skipped: No service available${colors.reset}`);
            stats.skipped++;
            stats.total--;
            return;
        }

        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            key: testContext.apiKey,
            action: 'add',
            service: testContext.serviceId,
            link: 'https://tiktok.com/@testuser',
            quantity: '100'
        });

        // Could be 200 (success) or 400 (insufficient balance)
        assert(response.statusCode === 200 || response.statusCode === 400, `Expected 200 or 400, got ${response.statusCode}`);
        
        if (response.statusCode === 200) {
            assert(response.body.order, 'Should return order ID');
            testContext.orderId = response.body.order;
        } else {
            console.log(`  ${colors.yellow}Note: Order failed (likely insufficient balance)${colors.reset}`);
        }
    });

    await test('Place order without API key should fail', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            action: 'add',
            service: testContext.serviceId || '1',
            link: 'https://tiktok.com/@testuser',
            quantity: '100'
        });

        assert(response.statusCode === 401, `Expected 401, got ${response.statusCode}`);
    });

    await test('Place order with missing parameters should fail', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            key: testContext.apiKey,
            action: 'add',
            service: testContext.serviceId || '1'
            // Missing link and quantity
        });

        assert(response.statusCode === 400, `Expected 400, got ${response.statusCode}`);
        assert(response.body.error, 'Should return error message');
    });

    await test('Place order with invalid quantity should fail', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            key: testContext.apiKey,
            action: 'add',
            service: testContext.serviceId || '1',
            link: 'https://tiktok.com/@testuser',
            quantity: 'invalid'
        });

        assert(response.statusCode === 400, `Expected 400, got ${response.statusCode}`);
    });
}

/**
 * Test Suite: V2 API - Order Status
 */
async function testV2ApiOrderStatus() {
    console.log(`\n${colors.bright}${colors.blue}━━━ V2 API - Order Status Tests ━━━${colors.reset}\n`);

    await test('Get order status with valid order ID', async () => {
        if (!testContext.orderId) {
            console.log(`  ${colors.yellow}⚠ Skipped: No order ID available${colors.reset}`);
            stats.skipped++;
            stats.total--;
            return;
        }

        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            key: testContext.apiKey,
            action: 'status',
            order: testContext.orderId
        });

        assert(response.statusCode === 200, `Expected 200, got ${response.statusCode}`);
        assert(response.body.status, 'Should return order status');
        assert(response.body.charge, 'Should return charge amount');
    });

    await test('Get status without API key should fail', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            action: 'status',
            order: testContext.orderId || '12345'
        });

        assert(response.statusCode === 401, `Expected 401, got ${response.statusCode}`);
    });

    await test('Get status with invalid order ID should fail', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            key: testContext.apiKey,
            action: 'status',
            order: 'INVALID_ORDER_ID'
        });

        assert(response.statusCode === 404, `Expected 404, got ${response.statusCode}`);
    });
}

/**
 * Test Suite: Error Handling
 */
async function testErrorHandling() {
    console.log(`\n${colors.bright}${colors.blue}━━━ Error Handling Tests ━━━${colors.reset}\n`);

    await test('Invalid action should return error', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            key: testContext.apiKey,
            action: 'invalid_action'
        });

        assert(response.statusCode === 400, `Expected 400, got ${response.statusCode}`);
        assert(response.body.error, 'Should return error message');
    });

    await test('Missing action should return error', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, {
            key: testContext.apiKey
        });

        assert(response.statusCode === 400, `Expected 400, got ${response.statusCode}`);
    });

    await test('Malformed JSON should return error', async () => {
        const response = await makeRequest(API_ENDPOINT, {
            method: 'POST'
        }, '{invalid json}');

        assert(response.statusCode === 400 || response.statusCode === 500, `Expected 400 or 500, got ${response.statusCode}`);
    });
}

/**
 * Print test summary
 */
function printSummary() {
    console.log(`\n${colors.bright}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
    console.log(`${colors.bright}Test Summary${colors.reset}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Total:   ${stats.total}`);
    console.log(`${colors.green}Passed:  ${stats.passed}${colors.reset}`);
    console.log(`${colors.red}Failed:  ${stats.failed}${colors.reset}`);
    console.log(`${colors.yellow}Skipped: ${stats.skipped}${colors.reset}`);
    
    const successRate = stats.total > 0 ? ((stats.passed / stats.total) * 100).toFixed(1) : 0;
    console.log(`\nSuccess Rate: ${successRate}%`);
    
    if (stats.failed === 0) {
        console.log(`\n${colors.green}${colors.bright}✓ All tests passed!${colors.reset}`);
    } else {
        console.log(`\n${colors.red}${colors.bright}✗ Some tests failed${colors.reset}`);
    }
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
}

/**
 * Main test runner
 */
async function runTests() {
    console.log(`\n${colors.bright}${colors.cyan}╔════════════════════════════════════════╗${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}║   API Integration Test Suite          ║${colors.reset}`);
    console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════╝${colors.reset}`);
    console.log(`\nTesting: ${colors.yellow}${BASE_URL}${colors.reset}`);

    try {
        await testAuthentication();
        await testApiKeyManagement();
        await testV2ApiServices();
        await testV2ApiBalance();
        await testV2ApiOrders();
        await testV2ApiOrderStatus();
        await testErrorHandling();
    } catch (error) {
        console.error(`\n${colors.red}Fatal error during test execution:${colors.reset}`, error);
    }

    printSummary();
    process.exit(stats.failed > 0 ? 1 : 0);
}

// Run tests
runTests();
