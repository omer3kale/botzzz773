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
const SITE_URL = process.env.SITE_URL;

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
    const { action, ...data } = JSON.parse(event.body || '{}');

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

    // Create unique order ID
    const orderId = buildGatewayOrderId('CRYPTO', user.userId);

    // Create payment record
    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: user.userId,
        amount: amount,
        method: 'cryptomus',
        status: 'pending',
        transaction_id: orderId
      })
      .select()
      .single();

    if (error) {
      console.error('Create payment error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create payment' })
      };
    }

    // Create Cryptomus invoice
    const invoiceData = {
      amount: amount.toString(),
      currency: 'USD',
      order_id: orderId,
      url_return: `${SITE_URL}/payment-success.html`,
      url_callback: `${SITE_URL}/.netlify/functions/cryptomus`,
      is_payment_multiple: false,
      lifetime: 3600 // 1 hour
    };

    const sign = generateCryptomusSignature(invoiceData);

    console.log('[CRYPTOMUS] Creating invoice:', {
      orderId,
      amount,
      merchantIdLength: CRYPTOMUS_MERCHANT_ID.length,
      signatureLength: sign.length
    });

    const cryptomusResponse = await fetch('https://api.cryptomus.com/v1/payment', {
      method: 'POST',
      headers: {
        'merchant': CRYPTOMUS_MERCHANT_ID,
        'sign': sign,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(invoiceData)
    });

    const cryptomusData = await cryptomusResponse.json();

    console.log('[CRYPTOMUS] API response:', {
      status: cryptomusResponse.status,
      state: cryptomusData.state,
      message: cryptomusData.message
    });

    if (!cryptomusResponse.ok || cryptomusData.state !== 0) {
      console.error('Cryptomus API error:', cryptomusData);

      // Delete the pending payment record
      await supabaseAdmin
        .from('payments')
        .delete()
        .eq('transaction_id', orderId);

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          error: cryptomusData.message || 'Failed to create Cryptomus invoice'
        })
      };
    }

    // Update payment with Cryptomus UUID
    await supabaseAdmin
      .from('payments')
      .update({
        details: {
          cryptomus_uuid: cryptomusData.result.uuid,
          payment_url: cryptomusData.result.url
        }
      })
      .eq('transaction_id', orderId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentUrl: cryptomusData.result.url,
        orderId,
        uuid: cryptomusData.result.uuid
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

async function handleWebhook(event, headers) {
  try {
    // Parse Cryptomus webhook data
    const body = JSON.parse(event.body || '{}');
    const receivedSign = event.headers.sign || event.headers.Sign;

    if (!receivedSign) {
      console.error('Missing signature in webhook');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing signature' })
      };
    }

    // Verify webhook signature
    if (!verifyCryptomusWebhook(body, receivedSign)) {
      console.error('Invalid Cryptomus signature');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }

    const { order_id, status, uuid, payment_amount, payment_amount_usd } = body;

    // Get payment record
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('transaction_id', order_id)
      .single();

    if (!payment) {
      console.error('Payment not found:', order_id);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Payment not found' })
      };
    }

    // Update payment details
    await supabaseAdmin
      .from('payments')
      .update({
        details: {
          ...payment.details,
          cryptomus_uuid: uuid,
          status: status,
          payment_amount: payment_amount,
          payment_amount_usd: payment_amount_usd,
          last_webhook: new Date().toISOString()
        }
      })
      .eq('transaction_id', order_id);

    // Check if payment is confirmed/paid
    const normalizedStatus = normalizeCryptoStatus(status);

    if ((normalizedStatus === 'paid' || normalizedStatus === 'paid_over') && payment.status === 'pending') {
      // Update payment status to completed
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'completed'
        })
        .eq('transaction_id', order_id);

      // Add balance to user
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('balance')
        .eq('id', payment.user_id)
        .single();

      if (userData) {
        const balanceNum = parseFloat(userData.balance) + parseFloat(payment.amount);
        const newBalance = Number(balanceNum.toFixed(5));

        await supabaseAdmin
          .from('users')
          .update({ balance: newBalance })
          .eq('id', payment.user_id);

        // Log activity
        await supabaseAdmin
          .from('activity_logs')
          .insert({
            user_id: payment.user_id,
            action: 'payment_completed',
            details: {
              amount: payment.amount,
              method: 'cryptomus',
              transaction_id: order_id,
              uuid: uuid,
              status: status
            }
          });

        console.log(`Payment completed for user ${payment.user_id}: $${payment.amount}`);
      }
    } else if (normalizedStatus === 'cancel' || normalizedStatus === 'fail' || normalizedStatus === 'wrong_amount') {
      // Update payment status to failed
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'failed'
        })
        .eq('transaction_id', order_id);

      console.log(`Payment failed for order ${order_id}: ${status}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('Webhook error:', error);
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
