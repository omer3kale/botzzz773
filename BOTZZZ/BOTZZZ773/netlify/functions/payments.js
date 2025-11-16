// Payments API - Process Payments, Add Balance
const { supabase, supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const { getStripeClient, isStripeConfigured } = require('./utils/stripe-client');

const JWT_SECRET = process.env.JWT_SECRET;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Validate required environment variables
const requiredEnvVars = ['JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ Missing required environment variable: ${varName}`);
  }
});

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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Normalize authorization header casing
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const user = getUserFromToken(authHeader);
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ 
        error: 'Unauthorized - You must be signed in to add funds. Please sign in or create an account.' 
      })
    };
  }

  // Verify user has valid userId and email
  if (!user.userId || !user.email) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ 
        error: 'Access denied - Invalid user credentials. Please sign in again.' 
      })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { action } = body;

    // Log request (with PII redaction)
    console.log('Payment request:', {
      action,
      method: body.method,
      amount: body.amount,
      userId: body.userId ? body.userId.substring(0, 8) + '***' : undefined,
      httpMethod: event.httpMethod,
      timestamp: new Date().toISOString()
    });

    // Handle PUT requests
    if (event.httpMethod === 'PUT') {
      if (action === 'update-method') {
        if (user.role !== 'admin') {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Admin access required' })
          };
        }
        return await handleUpdatePaymentMethod(body, headers);
      }
    }

    switch (action) {
      case 'create-checkout':
        return await handleCreateCheckout(user, body, headers);
      case 'webhook':
        return await handleWebhook(event, headers);
      case 'history':
        return await handleGetHistory(user, headers);
      case 'export':
        // Admin-only action
        if (user.role !== 'admin') {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Admin access required' })
          };
        }
        return await handleExportPayments(body, headers);
      case 'admin-add-payment':
        // Admin-only action
        if (user.role !== 'admin') {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Admin access required' })
          };
        }
        return await handleAdminAddPayment(user, body, headers);
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
    }
  } catch (error) {
    console.error('Payments API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleCreateCheckout(user, data, headers) {
  try {
    const { amount, method } = data;

    if (!amount || amount < 1) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid amount' })
      };
    }

    if (method === 'stripe') {
      const stripe = getStripeClient();
      if (!stripe) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({
            error: 'Stripe is not configured. Please contact support.'
          })
        };
      }

      // Create Stripe checkout session
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: [
          {
            price_data: {
              currency: 'usd',
              product_data: {
                name: 'Account Balance',
                description: `Add $${amount} to your account`
              },
              unit_amount: Math.round(amount * 100) // Convert to cents
            },
            quantity: 1
          }
        ],
        mode: 'payment',
        success_url: `${process.env.SITE_URL}/dashboard?payment=success`,
        cancel_url: `${process.env.SITE_URL}/dashboard?payment=cancelled`,
        client_reference_id: user.userId,
        metadata: {
          userId: user.userId,
          amount: amount.toString()
        }
      });

      // Create payment record
      await supabaseAdmin
        .from('payments')
        .insert({
          user_id: user.userId,
          amount: amount,
          method: 'stripe',
          status: 'pending',
          transaction_id: session.id
        });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          checkoutUrl: session.url
        })
      };
    } else if (method === 'paypal') {
      // TODO: Implement PayPal checkout
      return {
        statusCode: 501,
        headers,
        body: JSON.stringify({ error: 'PayPal integration coming soon' })
      };
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid payment method' })
      };
    }
  } catch (error) {
    console.error('Create checkout error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create checkout session' })
    };
  }
}

async function handleWebhook(event, headers) {
  const stripe = getStripeClient();
  if (!stripe || !STRIPE_WEBHOOK_SECRET || !isStripeConfigured()) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Stripe webhook is not configured' })
    };
  }

  try {
    const sig = event.headers['stripe-signature'];
    let stripeEvent;

    try {
      stripeEvent = stripe.webhooks.constructEvent(
        event.body,
        sig,
        STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }

    const eventType = stripeEvent.type;
    const payload = stripeEvent.data.object;

    switch (eventType) {
      case 'checkout.session.completed':
        await finalizeCheckoutSession(payload);
        break;
      case 'payment_intent.succeeded':
        await finalizeStripePaymentIntent(payload, 'completed');
        break;
      case 'payment_intent.payment_failed':
        await finalizeStripePaymentIntent(payload, 'failed');
        break;
      case 'payment_intent.canceled':
        await finalizeStripePaymentIntent(payload, 'cancelled');
        break;
      default:
        break;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true })
    };
  } catch (error) {
    console.error('Webhook error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Webhook processing failed' })
    };
  }
}

async function handleGetHistory(user, headers) {
  try {
    let query = supabaseAdmin
      .from('payments')
      .select('*')
      .order('created_at', { ascending: false });

    // Non-admins can only see their own payments
    if (user.role !== 'admin') {
      query = query.eq('user_id', user.userId);
    }

    const { data: payments, error } = await query;

    if (error) {
      console.error('Get payment history error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch payment history' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ payments })
    };
  } catch (error) {
    console.error('Get payment history error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function finalizeCheckoutSession(session) {
  try {
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .update({
        status: 'completed',
        details: {
          session_id: session.id,
          payment_status: session.payment_status,
          payment_method_types: session.payment_method_types
        }
      })
      .eq('transaction_id', session.id)
      .select()
      .single();

    if (payment) {
      await creditUserBalance(payment, {
        provider: 'stripe-checkout',
        sessionId: session.id
      });
    }
  } catch (error) {
    console.error('Failed to finalize checkout session:', error);
  }
}

async function finalizeStripePaymentIntent(intent, status) {
  try {
    const paymentRecord = await findPaymentByIdentifiers(intent.id, intent.metadata?.orderId);
    if (!paymentRecord) {
      console.warn('Payment intent received without matching record', intent.id);
      return;
    }

    const details = {
      ...(paymentRecord.details || {}),
      payment_intent: {
        id: intent.id,
        status: intent.status,
        amount_received: intent.amount_received,
        currency: intent.currency
      }
    };

    if (status === 'completed') {
      if (paymentRecord.status === 'completed') {
        return;
      }

      await supabaseAdmin
        .from('payments')
        .update({ status: 'completed', details })
        .eq('id', paymentRecord.id);

      await creditUserBalance(paymentRecord, {
        provider: 'stripe-google-pay',
        intentId: intent.id
      });
    } else {
      await supabaseAdmin
        .from('payments')
        .update({ status, details })
        .eq('id', paymentRecord.id);
    }
  } catch (error) {
    console.error('Failed to finalize payment intent:', error);
  }
}

async function findPaymentByIdentifiers(primaryId, fallbackId) {
  const { data: payment } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('transaction_id', primaryId)
    .maybeSingle();

  if (payment) {
    return payment;
  }

  if (!fallbackId) {
    return null;
  }

  const { data: fallbackPayment } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('transaction_id', fallbackId)
    .maybeSingle();

  return fallbackPayment || null;
}

async function creditUserBalance(payment, activityDetails = {}) {
  const { data: userData } = await supabaseAdmin
    .from('users')
    .select('balance')
    .eq('id', payment.user_id)
    .single();

  if (!userData) {
    return;
  }

  const newBalance = (parseFloat(userData.balance || 0) + parseFloat(payment.amount)).toFixed(2);

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
        amount: payment.amount,
        method: payment.method,
        transaction_id: payment.transaction_id,
        ...activityDetails
      }
    });
}

async function handleAdminAddPayment(user, data, headers) {
  try {
    console.log('handleAdminAddPayment called with:', { user: user.email, data });
    
    const { userId, amount, method, transactionId, status, memo } = data;

    // Validate required fields
    if (!userId || !amount || !method || !status) {
      console.error('Missing required fields:', { userId: !!userId, amount: !!amount, method: !!method, status: !!status });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: userId, amount, method, status' })
      };
    }

    if (amount <= 0) {
      console.error('Invalid amount:', amount);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Amount must be greater than 0' })
      };
    }

    // Generate transaction ID if not provided
    const finalTransactionId = transactionId || `MANUAL-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log('Creating payment record...', { userId, amount, method, status, finalTransactionId });

    // Create payment record
    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .insert({
        user_id: userId,
        transaction_id: finalTransactionId,
        amount: parseFloat(amount),
        method: method,
        status: status,
        memo: memo || null,
        gateway_response: {
          manual: true,
          added_by: user.userId,
          added_by_email: user.email,
          timestamp: new Date().toISOString()
        }
      })
      .select()
      .single();

    if (paymentError) {
      console.error('Create payment error:', paymentError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: `Failed to create payment record: ${paymentError.message}` })
      };
    }

    console.log('Payment created successfully:', payment);

    // If status is completed, add balance to user
    if (status === 'completed') {
      console.log('Payment completed, updating user balance...');
      
      const { data: targetUser, error: userError } = await supabaseAdmin
        .from('users')
        .select('balance, username, email')
        .eq('id', userId)
        .single();

      if (userError) {
        console.error('Get user error:', userError);
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: `User not found: ${userError.message}` })
        };
      }

      console.log('Target user found:', { username: targetUser.username, currentBalance: targetUser.balance });

      const currentBalance = parseFloat(targetUser.balance) || 0;
      const newBalance = currentBalance + parseFloat(amount);

      console.log('Updating balance:', { currentBalance, amount: parseFloat(amount), newBalance });

      const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({ 
          balance: newBalance.toFixed(2),
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (updateError) {
        console.error('Update balance error:', updateError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: `Failed to update user balance: ${updateError.message}` })
        };
      }

      console.log('Balance updated successfully');

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          payment,
          message: `Payment added successfully. User ${targetUser.username} balance updated from $${currentBalance.toFixed(2)} to $${newBalance.toFixed(2)}`
        })
      };
    } else {
      // Payment created but not completed (pending/failed)
      console.log('Payment created with status:', status);
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({
          success: true,
          payment,
          message: `Payment record created with status: ${status}`
        })
      };
    }
  } catch (error) {
    console.error('Admin add payment error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: `Internal server error: ${error.message}` })
    };
  }
}

async function handleExportPayments(data, headers) {
  try {
    const { format, dateFrom, dateTo, status } = data;

    // Build query
    let query = supabaseAdmin
      .from('payments')
      .select('*, users(username, email)');

    if (dateFrom) {
      query = query.gte('created_at', dateFrom);
    }
    if (dateTo) {
      query = query.lte('created_at', dateTo);
    }
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: payments, error } = await query.order('created_at', { ascending: false });

    if (error) {
      console.error('Export payments error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch payments' })
      };
    }

    let content = '';
    let mimeType = '';
    let filename = '';

    if (format === 'csv') {
      // Generate CSV
      const csvRows = [
        ['ID', 'User', 'Email', 'Amount', 'Method', 'Status', 'Transaction ID', 'Date'].join(',')
      ];
      
      payments.forEach(payment => {
        csvRows.push([
          payment.id,
          payment.users?.username || 'Unknown',
          payment.users?.email || 'Unknown',
          payment.amount,
          payment.method,
          payment.status,
          payment.transaction_id || '',
          new Date(payment.created_at).toISOString()
        ].join(','));
      });

      content = csvRows.join('\n');
      mimeType = 'text/csv';
      filename = `payments-${Date.now()}.csv`;
    } else if (format === 'json') {
      content = JSON.stringify(payments, null, 2);
      mimeType = 'application/json';
      filename = `payments-${Date.now()}.json`;
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid export format' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        content,
        mimeType,
        filename
      })
    };
  } catch (error) {
    console.error('Export payments error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to export payments' })
    };
  }
}

async function handleUpdatePaymentMethod(data, headers) {
  try {
    const { paymentId, method } = data;

    if (!paymentId || !method) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Payment ID and method are required' })
      };
    }

    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .update({ method })
      .eq('id', paymentId)
      .select()
      .single();

    if (error) {
      console.error('Update payment method error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to update payment method' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        payment
      })
    };
  } catch (error) {
    console.error('Update payment method error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to update payment method' })
    };
  }
}
