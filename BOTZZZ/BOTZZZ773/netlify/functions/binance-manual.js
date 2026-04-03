const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('./utils/supabase');
const { buildGatewayOrderId } = require('./utils/payment-gateway-helpers');

const JWT_SECRET = process.env.JWT_SECRET;

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
    const { action, amount } = JSON.parse(event.body || '{}');

    if (action !== 'create-payment') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid action' })
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

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 1) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Minimum amount is $1' })
      };
    }

    const orderId = buildGatewayOrderId('BINANCE', user.userId);

    const { error } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: user.userId,
        amount: numericAmount,
        method: 'binance_manual',
        status: 'pending',
        transaction_id: orderId,
        memo: 'Manual Binance payment awaiting support confirmation'
      });

    if (error) {
      console.error('Create Binance manual payment error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create payment' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        orderId,
        recipientId: '432401535',
        asset: 'USDT',
        network: 'BSC (BEP-20)'
      })
    };
  } catch (error) {
    console.error('Binance manual API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
