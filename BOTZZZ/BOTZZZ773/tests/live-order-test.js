#!/usr/bin/env node
/*
 * Live order creation smoke-test.
 *
 * Usage:
 *   ORDER_TEST_EMAIL="botzzz773@gmail.com" \
 *   ORDER_TEST_PASSWORD="Mariogomez33*" \
 *   node tests/live-order-test.js
 *
 * Optional environment variables:
 *   ORDER_TEST_SERVICE_ID   - explicit UUID of the service to order
 *   ORDER_TEST_QUANTITY     - quantity to use (default: service min or 10)
 *   ORDER_TEST_LINK         - link/URL to supply (default: https://example.com)
 *   ORDER_TEST_SITE_URL     - base site URL (default: https://botzzz773.pro)
 *   ORDER_TEST_DRY_RUN      - set to "1" to skip the create-order POST and only
 *                              print the request payload.
 */

const SITE_URL = process.env.ORDER_TEST_SITE_URL || 'https://botzzz773.pro';
const EMAIL = process.env.ORDER_TEST_EMAIL;
const PASSWORD = process.env.ORDER_TEST_PASSWORD;
const EXPLICIT_SERVICE_ID = process.env.ORDER_TEST_SERVICE_ID;
const EXPLICIT_QUANTITY = process.env.ORDER_TEST_QUANTITY ? Number(process.env.ORDER_TEST_QUANTITY) : null;
const ORDER_LINK = process.env.ORDER_TEST_LINK || 'https://example.com';
const DRY_RUN = process.env.ORDER_TEST_DRY_RUN === '1';

async function main() {
  try {
    if (!EMAIL || !PASSWORD) {
      console.error('Missing ORDER_TEST_EMAIL or ORDER_TEST_PASSWORD environment variables.');
      process.exitCode = 1;
      return;
    }

    console.log(`\n🔐 Logging in to ${SITE_URL} as ${EMAIL}...`);
    const authResponse = await fetch(`${SITE_URL}/.netlify/functions/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'login', email: EMAIL, password: PASSWORD })
    });

    const authBody = await safeJson(authResponse);
    logHttpResult('Auth', authResponse, authBody);

    if (!authResponse.ok || !authBody?.success || !authBody?.token) {
      console.error('\n❌ Login failed; aborting test.');
      process.exitCode = 1;
      return;
    }

    const token = authBody.token;
    console.log('\n✅ Login successful.');

    let service = null;
    if (EXPLICIT_SERVICE_ID) {
      console.log(`\n📦 Using provided service ID: ${EXPLICIT_SERVICE_ID}`);
      service = await fetchServiceById(token, EXPLICIT_SERVICE_ID);
      if (!service) {
        console.error('❌ Could not find service with the provided ID.');
        process.exitCode = 1;
        return;
      }
    } else {
      service = await fetchFirstActiveService(token);
      if (!service) {
        console.error('❌ No active services available to test.');
        process.exitCode = 1;
        return;
      }
      console.log(`\n📦 Selected service: ${service.name} (ID: ${service.id})`);
    }

    const quantity = determineQuantity(service, EXPLICIT_QUANTITY);
    if (quantity === null) {
      console.error('❌ Unable to determine a valid quantity for the selected service.');
      process.exitCode = 1;
      return;
    }

    const orderPayload = {
      serviceId: service.id,
      link: ORDER_LINK,
      quantity,
      notes: `Automated live-order smoke test @ ${new Date().toISOString()}`
    };

    console.log('\n🧾 Order payload ready:');
    console.log(JSON.stringify(orderPayload, null, 2));

    if (DRY_RUN) {
      console.log('\n🚫 DRY_RUN set – skipping live order creation.');
      return;
    }

    console.log('\n🚀 Placing order via /.netlify/functions/orders ...');
    const orderResponse = await fetch(`${SITE_URL}/.netlify/functions/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(orderPayload)
    });

    const orderBody = await safeJson(orderResponse);
    logHttpResult('Create Order', orderResponse, orderBody);

    if (orderResponse.status === 201 && orderBody?.success && orderBody?.order) {
      console.log('\n✅ Order created successfully! Key details:');
      const {
        id,
        order_number: orderNumber,
        provider_order_id: providerOrderId,
        charge,
        status
      } = orderBody.order;
      console.log(JSON.stringify({ id, orderNumber, providerOrderId, charge, status }, null, 2));
      console.log('\nFull order payload from API:');
      console.log(JSON.stringify(orderBody.order, null, 2));
    } else {
      console.error('\n❌ Order creation did not succeed. Inspect the response above.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('\n💥 Unexpected error during live order test:');
    console.error(error);
    process.exitCode = 1;
  }
}

async function fetchServiceById(token, serviceId) {
  const services = await fetchServices(token);
  return services.find((svc) => String(svc.id) === String(serviceId));
}

async function fetchFirstActiveService(token) {
  const services = await fetchServices(token);
  return services.find((svc) => svc.status === 'active');
}

async function fetchServices(token) {
  console.log('\n📡 Fetching services list...');
  const response = await fetch(`${SITE_URL}/.netlify/functions/services`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : undefined
    }
  });
  const body = await safeJson(response);
  logHttpResult('Services', response, body);

  if (!response.ok || !Array.isArray(body?.services)) {
    throw new Error('Failed to load services from the API.');
  }

  return body.services;
}

function determineQuantity(service, overrideQuantity) {
  if (!service) return null;
  if (overrideQuantity && Number.isFinite(overrideQuantity)) {
    return enforceServiceBounds(service, Number(overrideQuantity));
  }

  const min = Number(service.min_quantity ?? service.min_order ?? 10);
  const bounded = enforceServiceBounds(service, Number.isFinite(min) && min > 0 ? min : 10);
  return bounded;
}

function enforceServiceBounds(service, requested) {
  const min = Number(service.min_quantity ?? service.min_order ?? 1);
  const max = Number(service.max_quantity ?? service.max_order ?? Number.MAX_SAFE_INTEGER);

  let quantity = requested;

  if (Number.isFinite(min) && quantity < min) {
    console.log(`⚠️  Adjusting quantity up to service minimum (${min}).`);
    quantity = min;
  }

  if (Number.isFinite(max) && quantity > max) {
    console.log(`⚠️  Adjusting quantity down to service maximum (${max}).`);
    quantity = max;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  return quantity;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    console.warn('⚠️  Response body was not valid JSON.');
    return null;
  }
}

function logHttpResult(label, response, body) {
  console.log(`\n--- ${label} Response ---`);
  console.log(`Status: ${response.status}`);
  console.log('Headers:', Object.fromEntries(response.headers.entries()));
  if (body !== null) {
    if (label === 'Services' && Array.isArray(body?.services)) {
      const preview = body.services.slice(0, 5);
      console.log(`Body: { services: [first ${preview.length} of ${body.services.length}] }`);
      console.log(JSON.stringify(preview, null, 2));
    } else {
      console.log('Body:', JSON.stringify(body, null, 2));
    }
  }
  console.log('------------------------');
}

if (typeof fetch !== 'function') {
  // Lazy-load node-fetch for older Node runtimes.
  global.fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));
}

main();
