// Cryptomus Crypto Payment Integration
const { supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const {
  buildGatewayOrderId,
  normalizeCryptoStatus,
  isFinalCryptoStatus
} = require('./utils/payment-gateway-helpers');

const JWT_SECRET = process.env.JWT_SECRET;
const CRYPTOMUS_MERCHANT_ID = process.env.CRYPTOMUS_MERCHANT_ID;
const CRYPTOMUS_API_KEY = process.env.CRYPTOMUS_API_KEY;
const SITE_URL = process.env.SITE_URL || 'https://www.botzzz773.pro';

// SSRF protection: Only allow official Cryptomus API endpoint
const ALLOWED_CRYPTOMUS_ENDPOINTS = ['https://api.cryptomus.com'];
const CRYPTOMUS_API_BASE = (() => {
  const envBase = process.env.CRYPTOMUS_API_BASE;
  if (envBase && ALLOWED_CRYPTOMUS_ENDPOINTS.includes(envBase)) {
    return envBase;
  }
  return 'https://api.cryptomus.com';
})();

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

function generateCryptomusSignature(data) {
  const jsonData = JSON.stringify(data);
  const base64Data = Buffer.from(jsonData).toString('base64');
  const sign = crypto
    .createHash('md5')
    .update(base64Data + CRYPTOMUS_API_KEY)
    .digest('hex');
  return sign;
}

function verifyCryptomusWebhook(data, receivedSign) {
  const jsonData = JSON.stringify(data);
  const base64Data = Buffer.from(jsonData).toString('base64');
  const expectedSign = crypto
    .createHash('md5')
    .update(base64Data + CRYPTOMUS_API_KEY)
    .digest('hex');
  return expectedSign === receivedSign;
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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action, ...data } = body;

    console.log('[CRYPTOMUS] Received request:', { action, bodyKeys: Object.keys(body) });

    // Webhook detection: eğer action yoksa ama webhook fields varsa
    // Cryptomus sends: uuid, order_id, status, sign (no explicit action field)
    if (!action && (body.uuid || body.order_id || body.status || body.sign)) {
      console.log('[CRYPTOMUS] Detected as webhook - routing to handleWebhook');
      return await handleWebhook(event, headers, event.body);
    }

    switch (action) {
      case 'create-payment':
        return await handleCreatePayment(event, data, headers);
      case 'webhook':
        return await handleWebhook(event, headers);
      case 'check-status':
        return await handleCheckStatus(data, headers);
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }
  } catch (error) {
    console.error('Cryptomus API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleCreatePayment(event, data, headers) {
  try {
    // Validate credentials first
    if (!CRYPTOMUS_MERCHANT_ID || !CRYPTOMUS_API_KEY) {
      console.error('[CRYPTOMUS] Missing credentials:', {
        hasMerchantId: !!CRYPTOMUS_MERCHANT_ID,
        hasApiKey: !!CRYPTOMUS_API_KEY
      });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Payment gateway not configured. Please contact support.' })
      };
    }

    const user = getUserFromToken(event.headers.authorization);
    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    const { amount } = data;

    if (!amount || amount < 1) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Minimum amount is $1' })
      };
    }

    // Create unique order ID with user UUID
    // Format: CRYPTO-userId-timestamp (to easily extract userId from webhook)
    const orderId = `CRYPTO-${user.userId}-${Date.now()}`;

    // Create Cryptomus invoice - payment kaydı webhook'ta oluşturulacak
    const invoiceData = {
      amount: amount.toString(),
      currency: 'USD',
      order_id: orderId,
      url_return: `https://www.botzzz773.pro/addfunds`,
      url_success: `https://www.botzzz773.pro/addfunds`,
      url_callback: `${SITE_URL}/.netlify/functions/cryptomus`,
      is_payment_multiple: false,
      lifetime: 3600, // 1 hour
      additional_data: user.userId  // Store user ID for webhook verification
    };

    const sign = generateCryptomusSignature(invoiceData);

    const cryptomusResponse = await fetch(`${CRYPTOMUS_API_BASE}/v1/payment`, {
      method: 'POST',
      headers: {
        'merchant': CRYPTOMUS_MERCHANT_ID,
        'sign': sign,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(invoiceData)
    });

    const cryptomusData = await cryptomusResponse.json();

    if (!cryptomusResponse.ok || cryptomusData.state !== 0) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: 'Payment gateway error'
        })
      };
    }

    // Create pending payment record in DB with Cryptomus UUID
    const cryptomusUuid = cryptomusData.result.uuid;
    console.log('[CRYPTOMUS] Creating pending payment record. UUID:', cryptomusUuid, 'User:', user.userId, 'Amount:', amount);
    
    const { data: createdPayment, error: dbError } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: user.userId,
        amount: parseFloat(amount),
        method: 'cryptomus',
        status: 'pending',
        transaction_id: cryptomusUuid,  // Use Cryptomus UUID as transaction_id
        gateway_response: {
          order_id: orderId,
          uuid: cryptomusUuid
        },
        details: {
          gateway: 'cryptomus',
          cryptomus_uuid: cryptomusUuid,
          our_order_id: orderId,
          created_at: new Date().toISOString()
        }
      });

    if (dbError) {
      console.error('[CRYPTOMUS] Failed to create payment record:', dbError);
      // Still return success to user - payment is pending
    } else {
      console.log('[CRYPTOMUS] Payment record created:', createdPayment?.id);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentUrl: cryptomusData.result.url,
        orderId,
        uuid: cryptomusUuid
      })
    };
  } catch (error) {
    console.error('Create payment error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleWebhook(event, headers, rawBody = '') {
  try {
    // Parse Cryptomus webhook data
    const body = JSON.parse(event.body || '{}');
    
    // Signature can be in headers or in body
    let receivedSign = event.headers.sign || event.headers.Sign || body.sign;

    if (!receivedSign) {
      console.error('[CRYPTOMUS WEBHOOK] Missing signature in webhook');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing signature' })
      };
    }

    // Verify webhook signature using raw body if available (preserves key order)
    let computedSign;
    if (rawBody) {
      const rawPayload = JSON.parse(rawBody);
      delete rawPayload.sign;
      let jsonString = JSON.stringify(rawPayload);
      // CRITICAL: Cryptomus documentation requires escaping forward slashes in JSON
      jsonString = jsonString.replace(/\//g, "\\/");
      const base64Payload = Buffer.from(jsonString, 'utf8').toString('base64');
      computedSign = crypto.createHash('md5').update(base64Payload + CRYPTOMUS_API_KEY, 'utf8').digest('hex');
    } else {
      // Fallback to parsed body
      const bodyForVerification = { ...body };
      delete bodyForVerification.sign;
      computedSign = verifyCryptomusWebhook(bodyForVerification, '___temp___');
    }

    if (
      computedSign.length !== receivedSign.length ||
      !crypto.timingSafeEqual(Buffer.from(computedSign), Buffer.from(receivedSign))
    ) {
      console.error('[CRYPTOMUS WEBHOOK] Signature mismatch');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }
    
    const { order_id, status, uuid, payment_amount, payment_amount_usd } = body;

    if (!uuid) {
      console.error('[CRYPTOMUS WEBHOOK] Missing uuid in webhook');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing uuid' })
      };
    }

    // Get payment record using Cryptomus UUID (not order_id, since Cryptomus returns different order_id)
    const { data: payment, error: selectError } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('transaction_id', uuid)
      .single();

    if (selectError && selectError.code !== 'PGRST116') {
      console.error('[CRYPTOMUS WEBHOOK] Database error looking up payment:', selectError);
    }

    const normalizedStatus = normalizeCryptoStatus(status);
    console.log('[CRYPTOMUS WEBHOOK] Status:', status, '→', normalizedStatus, '| Found:', !!payment);

    // Accept both 'paid' and 'paid_over' statuses
    const isPaid = normalizedStatus === 'paid' || normalizedStatus === 'paid_over';

    // If payment found and already completed, return success (idempotency)
    if (payment && payment.status === 'completed') {
      console.log('[CRYPTOMUS WEBHOOK] Payment already completed (idempotency)');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    // If payment found and pending, and webhook status is paid, update and credit balance
    if (payment && payment.status === 'pending' && isPaid) {
      console.log('[CRYPTOMUS WEBHOOK] Updating pending payment to completed');
      
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'completed',
          gateway_response: {
            ...payment.gateway_response,
            webhook_received: new Date().toISOString(),
            webhook_status: status
          }
        })
        .eq('id', payment.id);

      console.log('[CRYPTOMUS WEBHOOK] Payment updated to completed. Now crediting balance...');
      
      // Credit user balance
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('balance')
        .eq('id', payment.user_id)
        .single();

      if (userData) {
        const balanceNum = parseFloat(userData.balance) + parseFloat(payment.amount);
        const newBalance = Number(balanceNum.toFixed(5));
        console.log('[CRYPTOMUS WEBHOOK] Crediting balance. Old:', userData.balance, 'Add:', payment.amount, 'New:', newBalance);

        await supabaseAdmin
          .from('users')
          .update({ balance: newBalance })
          .eq('id', payment.user_id);

        console.log('[CRYPTOMUS WEBHOOK] Balance credited successfully');
        
        await supabaseAdmin
          .from('activity_logs')
          .insert({
            user_id: payment.user_id,
            action: 'payment_completed',
            details: {
              amount: payment.amount,
              method: 'cryptomus',
              transaction_id: payment.transaction_id,
              webhook_status: status
            }
          });

        console.log('[CRYPTOMUS WEBHOOK] Activity logged');
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    // If payment not found and webhook status is paid, create new payment (fallback)
    if (!payment && isPaid) {
      console.log('[CRYPTOMUS WEBHOOK] Payment not found, creating new record (fallback)');
      const userId = bodyForVerification.additional_data;
      
      if (!userId) {
        console.error('[CRYPTOMUS WEBHOOK] Cannot determine user_id from webhook');
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid webhook data' })
        };
      }

      const { data: newPayment, error: insertError } = await supabaseAdmin
        .from('payments')
        .insert({
          user_id: userId,
          amount: parseFloat(payment_amount_usd || payment_amount || 0),
          method: 'cryptomus',
          status: 'completed',
          transaction_id: uuid,
          details: {
            gateway: 'cryptomus',
            cryptomus_uuid: uuid,
            cryptomus_order_id: order_id,
            webhook_status: status,
            payment_amount_usd: payment_amount_usd,
            payment_amount: payment_amount,
            webhook_received: new Date().toISOString()
          }
        })
        .select()
        .single();

      if (insertError) {
        console.error('[CRYPTOMUS WEBHOOK] Failed to create payment record:', insertError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Database error' })
        };
      }

      console.log('[CRYPTOMUS WEBHOOK] Payment created. Now crediting balance...');
      
      // Credit balance
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('balance')
        .eq('id', newPayment.user_id)
        .single();

      if (userData) {
        const balanceNum = parseFloat(userData.balance) + parseFloat(newPayment.amount);
        const newBalance = Number(balanceNum.toFixed(5));
        console.log('[CRYPTOMUS WEBHOOK] Crediting balance. Old:', userData.balance, 'Add:', newPayment.amount, 'New:', newBalance);

        await supabaseAdmin
          .from('users')
          .update({ balance: newBalance })
          .eq('id', newPayment.user_id);

        console.log('[CRYPTOMUS WEBHOOK] Balance credited successfully');
        
        await supabaseAdmin
          .from('activity_logs')
          .insert({
            user_id: newPayment.user_id,
            action: 'payment_completed',
            details: {
              amount: newPayment.amount,
              method: 'cryptomus',
              transaction_id: uuid
            }
          });

        console.log('[CRYPTOMUS WEBHOOK] Activity logged');
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true })
      };
    }

    // Invalid state
    console.warn('[CRYPTOMUS WEBHOOK] Invalid webhook state:', { found: !!payment, status: payment?.status, webhook_status: normalizedStatus });
    return {
      statusCode: 200,  // Return 200 to acknowledge webhook
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('[CRYPTOMUS WEBHOOK] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleCheckStatus(data, headers) {
  try {
    const { orderId } = data;

    if (!orderId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order ID is required' })
      };
    }

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
        created: payment.created_at,
        details: payment.details
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
