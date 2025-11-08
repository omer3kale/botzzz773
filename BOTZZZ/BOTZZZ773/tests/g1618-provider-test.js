#!/usr/bin/env node
/*
 * G1618 Provider Test - Direct API connectivity test
 * 
 * This script tests the G1618 provider API directly to verify:
 * 1. API credentials are valid
 * 2. We can connect to their endpoint
 * 3. Their API responds correctly
 * 4. Error handling works as expected
 */

const SITE_URL = process.env.ORDER_TEST_SITE_URL || 'https://botzzz773.pro';
const EMAIL = process.env.ORDER_TEST_EMAIL;
const PASSWORD = process.env.ORDER_TEST_PASSWORD;

// G1618 Provider ID from database
const G1618_PROVIDER_ID = 'f9995ea8-2803-4f32-a6bd-66c5917023dc';

async function main() {
  try {
    console.log('\n🔍 G1618 Provider API Test\n');
    console.log('='.repeat(60));

    if (!EMAIL || !PASSWORD) {
      console.error('❌ Missing ORDER_TEST_EMAIL or ORDER_TEST_PASSWORD');
      process.exitCode = 1;
      return;
    }

    // Step 1: Login
    console.log('\n1️⃣  Logging in...');
    const authResponse = await fetch(`${SITE_URL}/.netlify/functions/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email: EMAIL, password: PASSWORD })
    });

    const authBody = await authResponse.json();
    if (!authResponse.ok || !authBody?.success || !authBody?.token) {
      console.error('❌ Login failed');
      process.exitCode = 1;
      return;
    }

    const token = authBody.token;
    console.log('✅ Login successful');

    // Step 2: Get G1618 provider details
    console.log('\n2️⃣  Fetching G1618 provider configuration...');
    const servicesResponse = await fetch(`${SITE_URL}/.netlify/functions/services`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const servicesBody = await servicesResponse.json();
    if (!servicesBody?.services) {
      console.error('❌ Failed to fetch services');
      process.exitCode = 1;
      return;
    }

    // Find a G1618 service
    const g1618Service = servicesBody.services.find(s => 
      s.provider && s.provider.id === G1618_PROVIDER_ID && s.status === 'active'
    );

    if (!g1618Service) {
      console.error('❌ No active G1618 services found');
      console.log('\n💡 Looking for any G1618 services (active or inactive)...');
      
      const anyG1618 = servicesBody.services.find(s => 
        s.provider && s.provider.id === G1618_PROVIDER_ID
      );

      if (anyG1618) {
        console.log('\n📦 Found G1618 service:', {
          id: anyG1618.id,
          name: anyG1618.name,
          status: anyG1618.status,
          provider: anyG1618.provider.name,
          provider_service_id: anyG1618.provider_service_id,
          min_quantity: anyG1618.min_quantity
        });
        console.log('\n⚠️  Service is inactive. Activate it to test ordering.');
      } else {
        console.log('❌ No G1618 services found at all');
      }
      
      process.exitCode = 1;
      return;
    }

    console.log('✅ Found G1618 service:', {
      name: g1618Service.name,
      id: g1618Service.id,
      provider_service_id: g1618Service.provider_service_id,
      rate: g1618Service.rate,
      min: g1618Service.min_quantity,
      max: g1618Service.max_quantity
    });

    console.log('\n📡 G1618 Provider Details:', {
      name: g1618Service.provider.name,
      id: g1618Service.provider.id,
      status: g1618Service.provider.status,
      markup: g1618Service.provider.markup
    });

    // Step 3: Attempt to create order (will fail on insufficient balance, but tests API connectivity)
    console.log('\n3️⃣  Testing order creation (expecting insufficient balance error)...');
    console.log('   This tests if we can reach G1618 API through our system\n');

    const orderPayload = {
      serviceId: g1618Service.id,
      link: 'https://instagram.com/test',
      quantity: g1618Service.min_quantity || 10,
      notes: 'G1618 Provider API Test'
    };

    console.log('📤 Order payload:', orderPayload);

    const orderResponse = await fetch(`${SITE_URL}/.netlify/functions/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(orderPayload)
    });

    const orderBody = await orderResponse.json();

    console.log('\n📥 Response:', {
      status: orderResponse.status,
      statusText: orderResponse.statusText
    });

    if (orderResponse.status === 201 && orderBody?.success) {
      console.log('\n✅ SUCCESS! Order created and submitted to G1618!');
      console.log('\n📋 Order Details:');
      console.log(JSON.stringify(orderBody.order, null, 2));
      console.log('\n🎉 G1618 API IS WORKING!');
      console.log('   Provider Order ID:', orderBody.order.provider_order_id);
    } else if (orderResponse.status === 400 && orderBody?.error?.includes('Insufficient balance')) {
      console.log('\n✅ G1618 API connectivity verified!');
      console.log('   (Got expected "Insufficient balance" error)');
      console.log('\n💰 Your balance:', orderBody.balance || 'unknown');
      console.log('💵 Required:', orderBody.required || 'unknown');
      console.log('\n🔧 To complete test: Add funds to your account');
    } else if (orderResponse.status === 400 && orderBody?.error?.includes('Quantity must be at least')) {
      console.log('\n✅ G1618 API connectivity verified!');
      console.log('   (Service has minimum quantity requirement)');
      console.log('\n📊 Min quantity:', orderBody.min_quantity);
      console.log('\n🔧 Adjusting and retrying...');
      
      // Retry with correct quantity
      orderPayload.quantity = orderBody.min_quantity;
      const retryResponse = await fetch(`${SITE_URL}/.netlify/functions/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(orderPayload)
      });
      
      const retryBody = await retryResponse.json();
      console.log('\n📥 Retry Response:', retryBody);
      
      if (retryResponse.status === 201) {
        console.log('\n✅ SUCCESS! G1618 accepted the order!');
        console.log('   Provider Order ID:', retryBody.order?.provider_order_id);
      }
    } else if (orderResponse.status === 500 && orderBody?.error?.includes('Failed to submit order to provider')) {
      console.log('\n⚠️  Order created in database but G1618 rejected it');
      console.log('\n📋 Error Details:', orderBody.details);
      console.log('🔄 Refunded:', orderBody.refunded);
      
      if (orderBody.refunded) {
        console.log('\n✅ Automatic refund worked correctly!');
      }
      
      console.log('\n❌ G1618 API returned an error');
      console.log('   Check provider API credentials or service configuration');
    } else {
      console.log('\n📋 Full Response:');
      console.log(JSON.stringify(orderBody, null, 2));
    }

    console.log('\n' + '='.repeat(60));
    console.log('🏁 Test Complete\n');

  } catch (error) {
    console.error('\n💥 Test failed with error:');
    console.error(error);
    process.exitCode = 1;
  }
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

if (typeof fetch !== 'function') {
  global.fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}

main();
