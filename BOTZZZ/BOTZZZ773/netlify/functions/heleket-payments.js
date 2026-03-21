const { supabaseAdmin } = require('./utils/supabase');
const { createLogger, serializeError } = require('./utils/logger');
const crypto = require('crypto');
const logger = createLogger('heleket-payments');

// Minimal Heleket callback handler
// Expects a payload indicating transaction status and our internal order_id/transaction_id
module.exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    // Basic HMAC signature verification (adjust to Heleket spec)
    const sigHeader = event.headers['x-signature'] || event.headers['X-Signature'] || '';
    const secret = process.env.HELEKET_WEBHOOK_SECRET || '';
    if (!secret) {
      logger.warn('Missing HELEKET_WEBHOOK_SECRET');
    } else {
      const computed = crypto.createHmac('sha256', secret).update(event.body || '').digest('hex');
      if (!sigHeader || sigHeader !== computed) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
      }
    }
    const status = (body.status || body.result || '').toLowerCase();
    const orderId = body.order_id || body.id || body.transaction_id || null;
    const amountStr = body.amount || body.total || null;

    if (!orderId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing order/transaction id' }) };
    }

    const { data: payments, error: findErr } = await supabaseAdmin
      .from('payments')
      .select('*')
      .in('transaction_id', [orderId])
      .limit(1);
    if (findErr) {
      logger.error('Find payment error', { error: serializeError(findErr), orderId });
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lookup failed' }) };
    }
    const payment = Array.isArray(payments) && payments[0];
    if (!payment) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Payment not found' }) };
    }

    if ((payment.method || '').toLowerCase() !== 'heleket') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Wrong payment method for this callback' }) };
    }

    if ((payment.status || '').toLowerCase() === 'completed') {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Already completed' }) };
    }

    const successStatuses = ['paid', 'completed', 'success'];
    if (!successStatuses.includes(status)) {
      if (['failed', 'error', 'cancelled'].includes(status)) {
        await supabaseAdmin.from('payments').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', payment.id);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ignored: true }) };
    }

    const amount = amountStr != null ? parseFloat(String(amountStr)) : Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid amount' }) };
    }

    const now = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from('payments')
      .update({ status: 'completed', updated_at: now })
      .eq('id', payment.id);
    if (updErr) {
      logger.error('Update payment status error', { error: serializeError(updErr), id: payment.id });
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Status update failed' }) };
    }

    // Credit user balance atomically via RPC
    const { error: balErr } = await supabaseAdmin
      .rpc('refund_balance', {
        p_user_id: payment.user_id,
        p_amount: amount
      });
    if (balErr) {
      logger.error('Balance update error', { error: serializeError(balErr), userId: payment.user_id });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, warning: 'Balance update failed' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (e) {
    logger.error('Heleket callback error', { error: serializeError(e) });
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Callback processing failed' }) };
  }
};
