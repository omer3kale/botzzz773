// Heleket Crypto Payment Integration
const { supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { buildGatewayOrderId } = require('./utils/payment-gateway-helpers');

const JWT_SECRET = process.env.JWT_SECRET;
const HELEKET_MERCHANT_ID = process.env.HELEKET_MERCHANT_ID;
const HELEKET_API_KEY = process.env.HELEKET_API_KEY;
const SITE_URL = process.env.SITE_URL || 'https://www.botzzz773.pro';
const MIN_AMOUNT = 1;

// SSRF protection: Only allow official Heleket API endpoint
const ALLOWED_HELEKET_ENDPOINTS = ['https://api.heleket.com'];
const HELEKET_API_BASE = (() => {
  const envBase = process.env.HELEKET_API_BASE;
  if (envBase && ALLOWED_HELEKET_ENDPOINTS.includes(envBase)) {
    return envBase;
  }
  return 'https://api.heleket.com';
})();

const HELEKET_SUCCESS_STATUSES = new Set(['paid', 'paid_over']);
const HELEKET_FAILURE_STATUSES = new Set(['fail', 'wrong_amount', 'cancel', 'system_fail', 'refund_fail']);

function respond(headers, statusCode, body) {
  return {
    statusCode,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

function serializePayload(payload = {}) {
  // Match PHP json_encode($data, JSON_UNESCAPED_UNICODE):
  // - Preserve key insertion order as constructed
  // - Keep null values
  // - UTF-8, no unicode escaping
  return JSON.stringify(payload);
}

function generateHeleketSignature(payload) {
  if (!HELEKET_API_KEY) {
    throw new Error('HELEKET_API_KEY is not configured');
  }
  // PHP ref: md5(base64_encode(json_encode($data, JSON_UNESCAPED_UNICODE)) . $apiPaymentKey)
  const jsonString = serializePayload(payload);
  const base64Payload = Buffer.from(jsonString, 'utf8').toString('base64');
  return crypto.createHash('md5').update(base64Payload + HELEKET_API_KEY, 'utf8').digest('hex');
}

function formatAmount(amount) {
  const value = Number(amount || 0);
  return value.toFixed(2);
}

function normalizeStatus(status) {
  return (status || '').toString().trim().toLowerCase();
}

async function creditUserBalance(payment, metadata = {}) {
  const { data: userData, error } = await supabaseAdmin
    .from('users')
    .select('balance')
    .eq('id', payment.user_id)
    .single();

  if (error || !userData) {
    console.error('[HELEKET] Failed to retrieve user balance');
    return false;
  }

  const currentBalance = parseFloat(userData.balance) || 0;
  const balanceNum = currentBalance + parseFloat(payment.amount);
  const newBalance = Number(balanceNum.toFixed(5));

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ balance: newBalance })
    .eq('id', payment.user_id);

  if (updateError) {
    console.error('[HELEKET] Failed to update balance');
    return false;
  }

  await supabaseAdmin
    .from('activity_logs')
    .insert({
      user_id: payment.user_id,
      action: 'payment_completed',
      details: {
        amount: payment.amount,
        method: 'heleket',
        transaction_id: payment.transaction_id,
        ...metadata
      }
    });

  return true;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return respond(headers, 200, '');
  }

  if (event.httpMethod !== 'POST') {
    return respond(headers, 405, { error: 'Method not allowed' });
  }

  const rawBody = event.body || '{}';
  let parsedBody = {};

  try {
    parsedBody = JSON.parse(rawBody);
  } catch (error) {
    console.warn('[HELEKET] Failed to parse request body');
    return respond(headers, 400, { error: 'Invalid request' });
  }

  const queryAction = event.queryStringParameters?.action;
  const action = queryAction || parsedBody.action;

  try {
    // Webhook detection: eğer action yoksa ama webhook fields varsa
    if (!action && (parsedBody.uuid || parsedBody.order_id || parsedBody.status || parsedBody.sign)) {
      console.log('[HELEKET] Detected as webhook - routing to handleWebhook');
      return await handleWebhook(parsedBody, headers, rawBody);
    }

    if (action === 'webhook') {
      return await handleWebhook(parsedBody, headers, rawBody);
    }

    switch (action) {
      case 'create-payment':
        return await handleCreatePayment(event, parsedBody, headers);
      case 'check-status':
        return await handleCheckStatus(parsedBody, headers);
      default:
        return respond(headers, 400, { error: 'Invalid action' });
    }
  } catch (error) {
    console.error('[HELEKET] Handler error:', error);
    return respond(headers, 500, { error: 'Internal server error' });
  }
};

async function handleCreatePayment(event, data, headers) {
  if (!HELEKET_MERCHANT_ID || !HELEKET_API_KEY) {
    console.error('[HELEKET] Missing merchant credentials');
    return respond(headers, 500, { error: 'Heleket credentials are not configured' });
  }

  const user = getUserFromToken(event.headers.authorization);
  if (!user) {
    return respond(headers, 401, { error: 'Unauthorized' });
  }

  const amount = Number(data.amount);
  if (!amount || amount < MIN_AMOUNT) {
    return respond(headers, 400, { error: `Minimum amount is $${MIN_AMOUNT.toFixed(2)}` });
  }

  const orderId = buildGatewayOrderId('HELEKT', user.userId);

  // Invoice payload - payment kaydı webhook'ta oluşturulacak
  const invoicePayload = {
    amount: formatAmount(amount),
    currency: 'USD',
    order_id: orderId,
    url_return: `https://www.botzzz773.pro/addfunds`,
    url_success: `https://www.botzzz773.pro/addfunds`,
    url_callback: `${SITE_URL}/.netlify/functions/heleket?action=webhook`,
    is_payment_multiple: false,
    lifetime: 3600
  };
  
  // Add optional fields only if they exist
  if (data.email || user.email) {
    invoicePayload.payer_email = data.email || user.email;
  }
  if (user.userId) {
    invoicePayload.additional_data = String(user.userId);
  }

  let heleketResponse;
  try {
    const signature = generateHeleketSignature(invoicePayload);
    
    heleketResponse = await fetch(`${HELEKET_API_BASE}/v1/payment`, {
      method: 'POST',
      headers: {
        'merchant': HELEKET_MERCHANT_ID,
        'sign': signature,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(invoicePayload)
    });
  } catch (apiError) {
    console.error('[HELEKET] API request failed');
    return respond(headers, 502, { error: 'Unable to reach Heleket API' });
  }

  const apiResult = await heleketResponse.json().catch(() => null);

  if (!heleketResponse.ok || !apiResult || apiResult.state !== 0) {
    console.error('[HELEKET] API error:', apiResult?.state, apiResult?.message);
    return respond(headers, 502, {
      error: 'Payment gateway error'
    });
  }

  const invoice = apiResult.result;

  return respond(headers, 200, {
    success: true,
    paymentUrl: invoice.url,
    orderId,
    uuid: invoice.uuid
  });
}

async function handleWebhook(body, headers, rawBody = '') {
  if (!HELEKET_API_KEY) {
    console.error('[HELEKET] Missing API key for webhook verification');
    return respond(headers, 500, { error: 'Webhook verification not configured' });
  }

  const payload = { ...body };
  let incomingSign = payload.sign;
  delete payload.sign;

  if (!incomingSign) {
    console.warn('[HELEKET] Webhook missing signature');
    return respond(headers, 400, { error: 'Missing signature' });
  }

  // Verify signature using raw body if available, otherwise compute from parsed payload
  let computedSign;
  if (rawBody) {
    // Use raw body for signature verification (preserves key order)
    const rawPayload = JSON.parse(rawBody);
    delete rawPayload.sign;
    let jsonString = JSON.stringify(rawPayload);
    // CRITICAL: Heleket documentation requires escaping forward slashes in JSON
    jsonString = jsonString.replace(/\//g, "\\/");
    const base64Payload = Buffer.from(jsonString, 'utf8').toString('base64');
    computedSign = crypto.createHash('md5').update(base64Payload + HELEKET_API_KEY, 'utf8').digest('hex');
  } else {
    // Fallback to parsed payload
    computedSign = generateHeleketSignature(payload);
  }

  if (
    computedSign.length !== incomingSign.length ||
    !crypto.timingSafeEqual(Buffer.from(computedSign), Buffer.from(incomingSign))
  ) {
    console.error('[HELEKET WEBHOOK] Signature mismatch');
    return respond(headers, 400, { error: 'Invalid signature' });
  }

  console.log('[HELEKET WEBHOOK] Signature verified successfully');

  const orderId = payload.order_id;
  if (!orderId) {
    return respond(headers, 400, { error: 'Missing order_id' });
  }

  const { data: payment } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('transaction_id', orderId)
    .single();

  const normalizedStatus = normalizeStatus(payload.status || payload.payment_status);

  // Eğer payment kaydı yoksa ve ödeme başarılıysa, kayıt oluştur
  if (!payment && HELEKET_SUCCESS_STATUSES.has(normalizedStatus)) {
    // User ID'yi order_id'den veya payload'dan al
    // Format: HELEKT-{timestamp}-{userId} (from buildGatewayOrderId)
    const parts = orderId.split('-');
    let userId = payload.additional_data || (parts.length >= 3 ? parts[2] : null);
    
    if (!userId) {
      console.error('[HELEKET] Cannot determine user_id from webhook. Order ID:', orderId, 'Parts:', parts);
      return respond(headers, 400, { error: 'Invalid order data' });
    }

    console.log('[HELEKET WEBHOOK] Creating new payment record. Order parts:', parts, 'User ID:', userId);

    // Payment kaydı oluştur (completed olarak)
    const { data: newPayment, error: insertError } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: userId,
        amount: parseFloat(payload.payment_amount_usd || payload.payment_amount || 0),
        method: 'heleket',
        status: 'completed',
        transaction_id: orderId,
        details: {
          gateway: 'heleket',
          heleket_uuid: payload.uuid,
          heleket_status: normalizedStatus,
          payment_amount: payload.payment_amount,
          payment_amount_usd: payload.payment_amount_usd,
          first_webhook: new Date().toISOString(),
          raw_webhook: body
        }
      })
      .select()
      .single();

    if (insertError) {
      console.error('[HELEKET] Failed to create payment record');
      return respond(headers, 500, { error: 'Database error' });
    }

    console.log('[HELEKET WEBHOOK] Payment insert result. Error: null, Payment:', newPayment);

    // Bakiye ekle
    const balanceUpdated = await creditUserBalance(newPayment, {
      uuid: payload.uuid,
      status: normalizedStatus,
      txid: payload.txid || null
    });

    if (balanceUpdated) {
      console.log('[HELEKET WEBHOOK] Balance updated');
    }

    console.log('[HELEKET WEBHOOK] Activity logged');

    return respond(headers, 200, { success: true });
  }

  if (!payment) {
    // Payment yok ve başarılı ödeme de değil → Sadece log
    console.warn('[HELEKET] Payment not found for webhook', orderId);
    return respond(headers, 404, { error: 'Payment not found' });
  }

  // Idempotency: Eğer ödeme zaten completed ise webhook'u işleme (duplicate protection)
  if (payment.status === 'completed') {
    return respond(headers, 200, { success: true });
  }
  const detailPatch = {
    ...(payment.details || {}),
    gateway: 'heleket',
    heleket_uuid: payload.uuid,
    heleket_status: normalizedStatus,
    payment_amount: payload.payment_amount,
    payment_amount_usd: payload.payment_amount_usd,
    last_webhook: new Date().toISOString(),
    raw_webhook: body
  };

  if (HELEKET_SUCCESS_STATUSES.has(normalizedStatus) && payment.status !== 'completed') {
    console.log('[HELEKET WEBHOOK] Payment successful, updating to completed. User ID:', userId);
    await supabaseAdmin
      .from('payments')
      .update({ status: 'completed', details: detailPatch })
      .eq('transaction_id', orderId);

    console.log('[HELEKET WEBHOOK] Crediting user balance. Amount:', payment.amount, 'User ID:', userId);
    await creditUserBalance(payment, {
      uuid: payload.uuid,
      status: normalizedStatus,
      txid: payload.txid || null
    });
    console.log('[HELEKET WEBHOOK] Balance credited successfully');
  } else if (HELEKET_FAILURE_STATUSES.has(normalizedStatus)) {
    await supabaseAdmin
      .from('payments')
      .update({ status: 'failed', details: detailPatch })
      .eq('transaction_id', orderId);
  } else {
    await supabaseAdmin
      .from('payments')
      .update({ details: detailPatch })
      .eq('transaction_id', orderId);
  }

  return respond(headers, 200, { success: true });
}

async function handleCheckStatus(data, headers) {
  if (!data.orderId) {
    return respond(headers, 400, { error: 'Order ID is required' });
  }

  const { data: payment } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('transaction_id', data.orderId)
    .single();

  if (!payment) {
    return respond(headers, 404, { error: 'Payment not found' });
  }

  return respond(headers, 200, {
    status: payment.status,
    amount: payment.amount,
    created: payment.created_at,
    details: payment.details || {}
  });
}
