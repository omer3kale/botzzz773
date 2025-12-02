// Payments API - Process Payments, Add Balance
const { supabase, supabaseAdmin } = require('./utils/supabase');
const { withRateLimit } = require('./utils/rate-limit');
const jwt = require('jsonwebtoken');
const { getStripeClient, isStripeConfigured } = require('./utils/stripe-client');
const { createLogger, serializeError } = require('./utils/logger');
const axios = require('axios');
const { buildGatewayOrderId, formatUsd } = require('./utils/payment-gateway-helpers');

const CRYPTOMUS_API_KEY = process.env.CRYPTOMUS_API_KEY;
const CRYPTOMUS_MERCHANT_ID = process.env.CRYPTOMUS_MERCHANT_ID;

const JWT_SECRET = process.env.JWT_SECRET;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const logger = createLogger('payments');

function logPaymentError(message, error, meta) {
  logger.error(message, { error: serializeError(error), ...meta });
}

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

const baseHandler = async (event) => {
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
    logger.info('Payment request received', {
      action,
      method: body.method,
      amount: body.amount,
      userId: user.userId,
      httpMethod: event.httpMethod
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
      case 'admin-edit-payment':
        // Admin-only action
        if (user.role !== 'admin') {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Admin access required' })
          };
        }
        return await handleAdminEditPayment(user, body, headers);
      case 'admin-delete-payment':
        // Admin-only action
        if (user.role !== 'admin') {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Admin access required' })
          };
        }
        return await handleAdminDeletePayment(user, body, headers);
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

const PAYMENTS_RATE_LIMIT = {
  route: 'payments',
  limit: 90,
  windowSeconds: 60,
  identifierExtractor: (event) => {
    const headers = event?.headers || {};
    const authHeader = headers.authorization || headers.Authorization;
    const user = getUserFromToken(authHeader);
    return user?.userId ? `user:${user.userId}` : null;
  }
};

exports.handler = withRateLimit(PAYMENTS_RATE_LIMIT, baseHandler);

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
    } else if (method === 'cryptomus') {
      // Cryptomus invoice-based checkout
      if (!CRYPTOMUS_API_KEY || !CRYPTOMUS_MERCHANT_ID) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Cryptomus is not configured. Please set CRYPTOMUS_API_KEY and CRYPTOMUS_MERCHANT_ID.' })
        };
      }

      // Build an internal order id to reference before we get an external invoice id
      const orderId = buildGatewayOrderId('CRYPT', user.userId);

      // Create pending payment record
      const { data: payment, error: createError } = await supabaseAdmin
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

      if (createError) {
        console.error('Create cryptomus payment record error:', createError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to create payment record' })
        };
      }

      try {
        const payload = {
          amount: formatUsd(amount),
          currency: 'USD',
          order_id: orderId,
          description: `Account top-up for ${user.email}`,
          callback_url: `${process.env.SITE_URL}/.netlify/functions/crypto-payments`,
          success_url: `${process.env.SITE_URL}/payment-success.html`,
          cancel_url: `${process.env.SITE_URL}/payment-failed.html`
        };

        const response = await axios.post('https://api.cryptomus.com/v1/invoices', payload, {
          auth: {
            username: CRYPTOMUS_MERCHANT_ID,
            password: CRYPTOMUS_API_KEY
          },
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });

        const respData = response.data || {};
        // Try to read invoice id/url from common locations
        const invoiceId = respData.id || (respData.data && respData.data.id) || respData.invoice_id || null;
        const invoiceUrl = respData.url || respData.checkout_url || (respData.data && (respData.data.url || respData.data.checkout_url)) || null;

        // Update our payment record with the real invoice id and gateway response
        await supabaseAdmin
          .from('payments')
          .update({
            transaction_id: invoiceId || orderId,
            gateway_response: respData,
            updated_at: new Date().toISOString()
          })
          .eq('id', payment.id);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, checkoutUrl: invoiceUrl, orderId: invoiceId || orderId })
        };
      } catch (err) {
        console.error('Cryptomus API error:', err && err.response ? err.response.data || err.response.statusText : err.message || err);
        return {
          statusCode: 502,
          headers,
          body: JSON.stringify({ error: 'Failed to create Cryptomus invoice' })
        };
      }
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
      .neq('method', 'refund')  // Exclude refunds - they're shown in refunds section
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
    if (!userId || amount === undefined || amount === null || !method || !status) {
      console.error('Missing required fields:', { userId: !!userId, amount: amount, method: !!method, status: !!status });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields: userId, amount, method, status' })
      };
    }

    // Amount can be negative (for balance adjustments/deductions)
    if (amount === 0) {
      console.error('Invalid amount:', amount);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Amount cannot be zero' })
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

async function handleAdminEditPayment(user, data, headers) {
  try {
    console.log('handleAdminEditPayment called with:', { user: user.email, data });
    
    const { paymentId, amount, method, status, memo } = data;

    // Validate required fields
    if (!paymentId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required field: paymentId' })
      };
    }

    // Get current payment to find user and old amount
    const { data: existingPayment, error: fetchError } = await supabaseAdmin
      .from('payments')
      .select('*, users(id, balance, username, email)')
      .eq('id', paymentId)
      .single();

    if (fetchError || !existingPayment) {
      console.error('Payment not found:', fetchError);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Payment not found' })
      };
    }

    const targetUser = existingPayment.users;
    const oldAmount = parseFloat(existingPayment.amount) || 0;
    const newAmount = amount !== undefined ? parseFloat(amount) : oldAmount;
    const oldStatus = existingPayment.status;
    const newStatus = status || oldStatus;

    // Calculate balance adjustment
    let balanceAdjustment = 0;
    const wasCompleted = oldStatus === 'completed';
    const isNowCompleted = newStatus === 'completed';

    if (wasCompleted && isNowCompleted) {
      // Both completed - adjust by difference
      balanceAdjustment = newAmount - oldAmount;
    } else if (!wasCompleted && isNowCompleted) {
      // Wasn't completed, now is - add full new amount
      balanceAdjustment = newAmount;
    } else if (wasCompleted && !isNowCompleted) {
      // Was completed, now isn't - remove old amount
      balanceAdjustment = -oldAmount;
    }
    // If neither was nor is completed, no balance adjustment needed

    // Update payment record
    const updateData = {
      updated_at: new Date().toISOString()
    };
    if (amount !== undefined) updateData.amount = newAmount;
    if (method) updateData.method = method;
    if (status) updateData.status = status;
    if (memo !== undefined) updateData.memo = memo || null;

    // Add edit history to gateway_response
    const gatewayResponse = existingPayment.gateway_response || {};
    gatewayResponse.edit_history = gatewayResponse.edit_history || [];
    gatewayResponse.edit_history.push({
      edited_by: user.userId,
      edited_by_email: user.email,
      timestamp: new Date().toISOString(),
      changes: { oldAmount, newAmount, oldStatus, newStatus }
    });
    updateData.gateway_response = gatewayResponse;

    const { data: updatedPayment, error: updateError } = await supabaseAdmin
      .from('payments')
      .update(updateData)
      .eq('id', paymentId)
      .select()
      .single();

    if (updateError) {
      console.error('Update payment error:', updateError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: `Failed to update payment: ${updateError.message}` })
      };
    }

    // Update user balance if needed
    if (balanceAdjustment !== 0 && targetUser) {
      const currentBalance = parseFloat(targetUser.balance) || 0;
      const finalBalance = currentBalance + balanceAdjustment;

      const { error: balanceError } = await supabaseAdmin
        .from('users')
        .update({ 
          balance: finalBalance.toFixed(2),
          updated_at: new Date().toISOString()
        })
        .eq('id', targetUser.id);

      if (balanceError) {
        console.error('Update balance error:', balanceError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: `Payment updated but balance update failed: ${balanceError.message}` })
        };
      }

      console.log('Balance adjusted:', { currentBalance, balanceAdjustment, finalBalance });
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          payment: updatedPayment,
          message: `Payment updated. User ${targetUser.username} balance adjusted by $${balanceAdjustment.toFixed(2)} (now $${finalBalance.toFixed(2)})`
        })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        payment: updatedPayment,
        message: 'Payment updated successfully'
      })
    };
  } catch (error) {
    console.error('Admin edit payment error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: `Internal server error: ${error.message}` })
    };
  }
}

async function handleAdminDeletePayment(user, data, headers) {
  try {
    console.log('handleAdminDeletePayment called with:', { user: user.email, data });
    
    const { paymentId } = data;

    if (!paymentId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required field: paymentId' })
      };
    }

    // Get payment to check if exists
    const { data: existingPayment, error: fetchError } = await supabaseAdmin
      .from('payments')
      .select('id, amount, status, user_id')
      .eq('id', paymentId)
      .single();

    if (fetchError || !existingPayment) {
      console.error('Payment not found:', fetchError);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Payment not found' })
      };
    }

    // Delete the payment (note: this does NOT adjust balance - admin should use edit to adjust first if needed)
    const { error: deleteError } = await supabaseAdmin
      .from('payments')
      .delete()
      .eq('id', paymentId);

    if (deleteError) {
      console.error('Delete payment error:', deleteError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: `Failed to delete payment: ${deleteError.message}` })
      };
    }

    console.log('Payment deleted:', paymentId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Payment #${paymentId} deleted successfully. Note: User balance was not adjusted.`
      })
    };
  } catch (error) {
    console.error('Admin delete payment error:', error);
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
