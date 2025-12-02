// Heleket Crypto Payment Integration
const { supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { buildGatewayOrderId } = require('./utils/payment-gateway-helpers');

const JWT_SECRET = process.env.JWT_SECRET;
const HELEKET_MERCHANT_ID = process.env.HELEKET_MERCHANT_ID;
const HELEKET_API_KEY = process.env.HELEKET_API_KEY;
const HELEKET_API_BASE = process.env.HELEKET_API_BASE || 'https://api.heleket.com';
const SITE_URL = process.env.SITE_URL || 'https://www.botzzz773.pro';
const MIN_AMOUNT = Number(process.env.MIN_DEPOSIT_AMOUNT || 5);

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
  const jsonString = JSON.stringify(payload || {});
  return jsonString.replace(/\//g, '\\/');
}

function generateHeleketSignature(payload) {
  if (!HELEKET_API_KEY) {
    throw new Error('HELEKET_API_KEY is not configured');
  }
  const base64Payload = Buffer.from(serializePayload(payload)).toString('base64');
  return crypto.createHash('md5').update(base64Payload + HELEKET_API_KEY).digest('hex');
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
    console.error('[HELEKET] Failed to retrieve user balance', error);
    return false;
  }

  const currentBalance = parseFloat(userData.balance) || 0;
  const newBalance = (currentBalance + parseFloat(payment.amount)).toFixed(2);

  const { error: updateError } = await supabaseAdmin
    .from('users')
    .update({ balance: newBalance })
    .eq('id', payment.user_id);

  if (updateError) {
    console.error('[HELEKET] Failed to update balance', updateError);
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
    console.warn('[HELEKET] Failed to parse request body', error);
    return respond(headers, 400, { error: 'Invalid JSON payload' });
  }

  const queryAction = event.queryStringParameters?.action;
  const action = queryAction || parsedBody.action;

  try {
    if (action === 'webhook') {
      return await handleWebhook(parsedBody, headers);
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

  const { error: insertError } = await supabaseAdmin
    .from('payments')
    .insert({
      user_id: user.userId,
      amount: amount,
      method: 'heleket',
      status: 'pending',
      transaction_id: orderId,
      details: {
        gateway: 'heleket',
        status: 'created'
      }
    });

  if (insertError) {
    console.error('[HELEKET] Failed to insert payment', insertError);
    return respond(headers, 500, { error: 'Failed to create payment record' });
  }

  const invoicePayload = {
    amount: formatAmount(amount),
    currency: 'USD',
    order_id: orderId,
    url_return: `${SITE_URL}/addfunds.html`,
    url_success: `${SITE_URL}/payment-success.html`,
    url_callback: `${SITE_URL}/.netlify/functions/heleket?action=webhook`,
    is_payment_multiple: false,
    lifetime: 3600,
    payer_email: data.email || user.email || null,
    additional_data: JSON.stringify({ userId: user.userId }).slice(0, 255)
  };

  let heleketResponse;
  try {
    heleketResponse = await fetch(`${HELEKET_API_BASE}/v1/payment`, {
      method: 'POST',
      headers: {
        'merchant': HELEKET_MERCHANT_ID,
        'sign': generateHeleketSignature(invoicePayload),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(invoicePayload)
    });
  } catch (apiError) {
    console.error('[HELEKET] API request failed', apiError);
    await supabaseAdmin.from('payments').delete().eq('transaction_id', orderId);
    return respond(headers, 502, { error: 'Unable to reach Heleket API' });
  }

  const apiResult = await heleketResponse.json().catch(() => null);

  if (!heleketResponse.ok || !apiResult || apiResult.state !== 0) {
    console.error('[HELEKET] API error response', apiResult);
    await supabaseAdmin.from('payments').delete().eq('transaction_id', orderId);
    return respond(headers, 502, {
      error: apiResult?.message || 'Failed to create Heleket invoice'
    });
  }

  const invoice = apiResult.result;

  await supabaseAdmin
    .from('payments')
    .update({
      details: {
        gateway: 'heleket',
        heleket_uuid: invoice.uuid,
        heleket_status: invoice.status || invoice.payment_status,
        payment_url: invoice.url,
        last_invoice_sync: new Date().toISOString()
      }
    })
    .eq('transaction_id', orderId);

  return respond(headers, 200, {
    success: true,
    paymentUrl: invoice.url,
    orderId,
    uuid: invoice.uuid
  });
}

async function handleWebhook(body, headers) {
  if (!HELEKET_API_KEY) {
    console.error('[HELEKET] Missing API key for webhook verification');
    return respond(headers, 500, { error: 'Webhook verification not configured' });
  }

  const payload = { ...body };
  const incomingSign = payload.sign;
  delete payload.sign;

  if (!incomingSign) {
    console.warn('[HELEKET] Webhook missing signature');
    return respond(headers, 400, { error: 'Missing signature' });
  }

  const computedSign = generateHeleketSignature(payload);
  if (
    computedSign.length !== incomingSign.length ||
    !crypto.timingSafeEqual(Buffer.from(computedSign), Buffer.from(incomingSign))
  ) {
    console.warn('[HELEKET] Webhook signature mismatch');
    return respond(headers, 400, { error: 'Invalid signature' });
  }

  const orderId = payload.order_id;
  if (!orderId) {
    return respond(headers, 400, { error: 'Missing order_id' });
  }

  const { data: payment } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('transaction_id', orderId)
    .single();

  if (!payment) {
    console.warn('[HELEKET] Payment not found for webhook', orderId);
    return respond(headers, 404, { error: 'Payment not found' });
  }

  const normalizedStatus = normalizeStatus(payload.status || payload.payment_status);
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
    await supabaseAdmin
      .from('payments')
      .update({ status: 'completed', details: detailPatch })
      .eq('transaction_id', orderId);

    await creditUserBalance(payment, {
      uuid: payload.uuid,
      status: normalizedStatus,
      txid: payload.txid || null
    });
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
