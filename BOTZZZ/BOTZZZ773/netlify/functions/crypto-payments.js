// Crypto Payment Integration via NOWPayments
const { supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const SITE_URL = process.env.SITE_URL || 'https://example.com';
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET || '';
const NOWPAYMENTS_API_BASE = process.env.NOWPAYMENTS_API_BASE || 'https://api.nowpayments.io/v1';
const NOWPAYMENTS_IPN_URL = process.env.NOWPAYMENTS_IPN_URL || `${SITE_URL}/api/crypto-payments?action=webhook`;
const NOWPAYMENTS_DEFAULT_PAY_CURRENCY = process.env.NOWPAYMENTS_DEFAULT_PAY_CURRENCY || 'usdttrc20';
const CRYPTO_MIN_AMOUNT = Number(process.env.CRYPTO_MIN_AMOUNT_USD || 5);

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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod === 'GET' && event.queryStringParameters?.action === 'health') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        service: 'crypto-payments',
        configured: Boolean(NOWPAYMENTS_API_KEY),
        defaultCurrency: NOWPAYMENTS_DEFAULT_PAY_CURRENCY
      })
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { action, ...payload } = JSON.parse(event.body || '{}');

    switch (action) {
      case 'create-invoice':
        return await handleCreateInvoice(event, payload, headers);
      case 'webhook':
        return await handleWebhook(event, headers);
      case 'check-status':
        return await handleCheckStatus(payload, headers);
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }
  } catch (error) {
    console.error('Crypto payments error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleCreateInvoice(event, data, headers) {
  const user = getUserFromToken(event.headers.authorization);
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  const { amount, payCurrency } = data;

  if (!amount || Number(amount) < CRYPTO_MIN_AMOUNT) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: `Minimum amount is $${CRYPTO_MIN_AMOUNT}` })
    };
  }

  if (!NOWPAYMENTS_API_KEY) {
    console.warn('NOWPayments API key missing. Configure NOWPAYMENTS_API_KEY.');
    return {
      statusCode: 503,
      headers,
      body: JSON.stringify({ error: 'Crypto gateway is not configured yet. Please try later.' })
    };
  }

  try {
    const orderId = `CRYPTO-${Date.now()}-${user.userId}`;
    const currency = payCurrency || NOWPAYMENTS_DEFAULT_PAY_CURRENCY;

    const invoicePayload = {
      price_amount: Number(amount),
      price_currency: 'usd',
      pay_currency: currency,
      order_id: orderId,
      order_description: `BOTZZZ773 balance top-up for ${user.email}`,
      ipn_callback_url: NOWPAYMENTS_IPN_URL,
      success_url: `${SITE_URL}/payment-success.html`,
      cancel_url: `${SITE_URL}/payment-failed.html`
    };

    const response = await axios.post(
      `${NOWPAYMENTS_API_BASE}/invoice`,
      invoicePayload,
      {
        headers: {
          'x-api-key': NOWPAYMENTS_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const invoice = response.data;

    await supabaseAdmin
      .from('payments')
      .insert({
        user_id: user.userId,
        amount: Number(amount),
        method: 'crypto-nowpayments',
        status: 'pending',
        transaction_id: orderId,
        details: {
          invoice_id: invoice.id,
          pay_address: invoice.pay_address,
          pay_currency: invoice.pay_currency,
          price_amount: invoice.price_amount,
          invoice_url: invoice.invoice_url
        }
      });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        orderId,
        invoiceId: invoice.id,
        invoiceUrl: invoice.invoice_url,
        payAddress: invoice.pay_address,
        payAmount: invoice.pay_amount,
        payCurrency: invoice.pay_currency
      })
    };
  } catch (error) {
    console.error('NOWPayments invoice error:', error.response?.data || error.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: 'Failed to generate crypto invoice' })
    };
  }
}

async function handleWebhook(event, headers) {
  const signatureHeader = event.headers['x-nowpayments-sig'] || event.headers['X-Nowpayments-Sig'];
  const rawBody = event.body || '';

  if (NOWPAYMENTS_IPN_SECRET) {
    const expectedSignature = crypto
      .createHmac('sha512', NOWPAYMENTS_IPN_SECRET)
      .update(rawBody)
      .digest('hex');

    if (!signatureHeader || signatureHeader !== expectedSignature) {
      console.error('Invalid NOWPayments signature');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch (parseError) {
    console.error('Invalid webhook payload', parseError);
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid payload' })
    };
  }

  const orderId = payload.order_id;
  const paymentStatus = payload.payment_status;

  if (!orderId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Missing order_id' })
    };
  }

  try {
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('transaction_id', orderId)
      .single();

    if (!payment) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Payment not found' })
      };
    }

    const statusLower = (paymentStatus || '').toLowerCase();

    if (['finished', 'confirmed'].includes(statusLower)) {
      await finalizePayment(payment, payload, 'completed');
    } else if (['partially_paid', 'waiting', 'confirming'].includes(statusLower)) {
      await updatePaymentStatus(payment, statusLower, payload);
    } else if (['expired', 'failed', 'refunded'].includes(statusLower)) {
      await updatePaymentStatus(payment, statusLower, payload);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('Crypto webhook error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function finalizePayment(payment, payload, status) {
  const amountToCredit = Number(payment.amount);

  await supabaseAdmin
    .from('payments')
    .update({
      status,
      details: {
        ...(payment.details || {}),
        ipn: payload,
        completed_at: new Date().toISOString()
      }
    })
    .eq('id', payment.id);

  const { data: userRecord } = await supabaseAdmin
    .from('users')
    .select('balance')
    .eq('id', payment.user_id)
    .single();

  if (userRecord) {
    const newBalance = (parseFloat(userRecord.balance || 0) + amountToCredit).toFixed(2);
    await supabaseAdmin
      .from('users')
      .update({ balance: newBalance })
      .eq('id', payment.user_id);

    await supabaseAdmin
      .from('activity_logs')
      .insert({
        user_id: payment.user_id,
        action: 'payment_completed',
        details: {
          method: 'crypto-nowpayments',
          transaction_id: payment.transaction_id,
          amount: amountToCredit,
          payload
        }
      });
  }
}

async function updatePaymentStatus(payment, status, payload) {
  await supabaseAdmin
    .from('payments')
    .update({
      status,
      details: {
        ...(payment.details || {}),
        ipn: payload,
        updated_at: new Date().toISOString()
      }
    })
    .eq('id', payment.id);
}

async function handleCheckStatus(data, headers) {
  const { orderId } = data;

  if (!orderId) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Order ID is required' })
    };
  }

  try {
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('transaction_id', orderId)
      .single();

    if (!payment) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Payment not found' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: payment.status,
        amount: payment.amount,
        details: payment.details || {}
      })
    };
  } catch (error) {
    console.error('Check status error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
