#!/usr/bin/env node

// Quick test script to verify service categories functionality

const PROD_URL = 'https://botzzz773.pro';

// You need to get a valid admin token first
const TOKEN = process.env.ADMIN_TOKEN || '';

async function testCategoriesEndpoint() {
    console.log('🧪 Testing Service Categories Functionality\n');
    console.log('=' .repeat(60));
    
    if (!TOKEN) {
        console.log('\n⚠️  No ADMIN_TOKEN found in environment');
        console.log('To run automated tests, set ADMIN_TOKEN:');
        console.log('  export ADMIN_TOKEN="your-admin-jwt-token"');
        console.log('\nManual Testing Instructions:');
        console.log('1. Go to https://botzzz773.pro/admin/services.html');
        console.log('2. Open DevTools Console (F12)');
        console.log('3. Run these commands:\n');
        console.log('// Test 1: Fetch categories');
        console.log('fetch("/.netlify/functions/services?type=categories", {');
        console.log('  headers: { "Authorization": `Bearer ${localStorage.getItem("token")}` }');
        console.log('}).then(r => r.json()).then(console.log)\n');
        console.log('// Test 2: Create a test category');
        console.log('fetch("/.netlify/functions/services", {');
        console.log('  method: "POST",');
        console.log('  headers: {');
        console.log('    "Authorization": `Bearer ${localStorage.getItem("token")}`,');
        console.log('    "Content-Type": "application/json"');
        console.log('  },');
        console.log('  body: JSON.stringify({');
        console.log('    action: "create-category",');
        console.log('    name: "Test Category",');
        console.log('    description: "Test description",');
        console.log('    icon: "fas fa-test"');
        console.log('  })');
        console.log('}).then(r => r.json()).then(console.log)\n');
        return;
    }

    try {
        // Test 1: Fetch categories
        console.log('\n📋 Test 1: Fetching categories...');
        const response1 = await fetch(`${PROD_URL}/.netlify/functions/services?type=categories`, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data1 = await response1.json();
        console.log(`Status: ${response1.status}`);
        console.log('Response:', JSON.stringify(data1, null, 2));
        
        if (data1.success && data1.categories) {
            console.log(`✅ Found ${data1.categories.length} categories`);
            data1.categories.forEach(cat => {
                console.log(`   - ${cat.name} (${cat.slug}) - ${cat.icon}`);
            });
        } else {
            console.log('⚠️  No categories found or error occurred');
        }

        // Test 2: Create a test category
        console.log('\n📝 Test 2: Creating test category...');
        const response2 = await fetch(`${PROD_URL}/.netlify/functions/services`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'create-category',
                name: 'Test Category ' + Date.now(),
                description: 'Automated test category',
                icon: 'fas fa-flask'
            })
        });
        
        const data2 = await response2.json();
        console.log(`Status: ${response2.status}`);
        console.log('Response:', JSON.stringify(data2, null, 2));
        
        if (data2.success) {
            console.log('✅ Category created successfully');
        } else {
            console.log('❌ Failed to create category:', data2.error);
        }

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
    }
}

testCategoriesEndpoint();
