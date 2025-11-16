// Payeer Payment Integration
const { supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const {
  buildGatewayOrderId,
  generatePayeerSignature,
  verifyPayeerWebhookSignature
} = require('./utils/payment-gateway-helpers');

const JWT_SECRET = process.env.JWT_SECRET;
const PAYEER_MERCHANT_ID = process.env.PAYEER_MERCHANT_ID;
const PAYEER_SECRET_KEY = process.env.PAYEER_SECRET_KEY;
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
    console.error('Payeer API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleCreatePayment(event, data, headers) {
  try {
    const user = getUserFromToken(event.headers.authorization);
    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    const { amount } = data;

    if (!amount || amount < 5) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Minimum amount is $5' })
      };
    }

  // Create unique order ID
  const orderId = buildGatewayOrderId('PYEER', user.userId);

    // Create payment record
    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: user.userId,
        amount: amount,
        method: 'payeer',
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

    // Generate Payeer payment URL
  const paymentUrl = generatePayeerUrl(orderId, amount, user.email);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentUrl,
        orderId
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

function generatePayeerUrl(orderId, amount, userEmail) {
  const description = `Balance top-up for ${userEmail}`;
  const params = {
    m_shop: PAYEER_MERCHANT_ID,
    m_orderid: orderId,
    m_amount: amount.toFixed(2),
    m_curr: 'USD',
    m_desc: Buffer.from(description).toString('base64'),
    m_sign: '',
    success_url: `${SITE_URL}/payment-success.html`,
    fail_url: `${SITE_URL}/payment-failed.html`,
    status_url: `${SITE_URL}/api/payeer?action=webhook`
  };

  params.m_sign = generatePayeerSignature(
    {
      shopId: PAYEER_MERCHANT_ID,
      orderId,
      amount,
      currency: 'USD',
      description
    },
    PAYEER_SECRET_KEY
  );

  const queryString = Object.keys(params)
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');

  return `https://payeer.com/merchant/?${queryString}`;
}

async function handleWebhook(event, headers) {
  try {
    // Parse Payeer webhook data
    const params = new URLSearchParams(event.body);
    const data = {
      m_operation_id: params.get('m_operation_id'),
      m_operation_ps: params.get('m_operation_ps'),
      m_operation_date: params.get('m_operation_date'),
      m_operation_pay_date: params.get('m_operation_pay_date'),
      m_shop: params.get('m_shop'),
      m_orderid: params.get('m_orderid'),
      m_amount: params.get('m_amount'),
      m_curr: params.get('m_curr'),
      m_desc: params.get('m_desc'),
      m_status: params.get('m_status'),
      m_sign: params.get('m_sign')
    };

    if (!verifyPayeerWebhookSignature(data, PAYEER_SECRET_KEY)) {
      console.error('Invalid Payeer signature');
      return {
        statusCode: 400,
        headers,
        body: 'Invalid signature'
      };
    }

    // Check if payment was successful
    if (data.m_status === 'success') {
      // Get payment record
      const { data: payment } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('transaction_id', data.m_orderid)
        .single();

      if (payment && payment.status === 'pending') {
        // Update payment status
        await supabaseAdmin
          .from('payments')
          .update({ 
            status: 'completed',
            details: {
              operation_id: data.m_operation_id,
              payment_system: data.m_operation_ps,
              payment_date: data.m_operation_pay_date
            }
          })
          .eq('transaction_id', data.m_orderid);

        // Add balance to user
        const { data: userData } = await supabaseAdmin
          .from('users')
          .select('balance')
          .eq('id', payment.user_id)
          .single();

        if (userData) {
          await supabaseAdmin
            .from('users')
            .update({ 
              balance: (parseFloat(userData.balance) + parseFloat(payment.amount)).toFixed(2)
            })
            .eq('id', payment.user_id);

          // Log activity
          await supabaseAdmin
            .from('activity_logs')
            .insert({
              user_id: payment.user_id,
              action: 'payment_completed',
              details: {
                amount: payment.amount,
                method: 'payeer',
                transaction_id: data.m_orderid,
                operation_id: data.m_operation_id
              }
            });
        }
      }
    }

    // Payeer expects this exact response
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: data.m_orderid + '|success'
    };
  } catch (error) {
    console.error('Webhook error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: 'error'
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
        created: payment.created_at
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
