const { supabaseAdmin } = require('./utils/supabase');
const { createLogger, serializeError } = require('./utils/logger');
const crypto = require('crypto');
const logger = createLogger('crypto-payments');

// Minimal Cryptomus callback handler
// Expects a payload indicating payment/invoice status and our internal order_id/transaction_id
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
    // Basic HMAC signature verification (adjust to Cryptomus spec)
    const sigHeader = event.headers['x-signature'] || event.headers['X-Signature'] || '';
    const secret = process.env.CRYPTOMUS_WEBHOOK_SECRET || '';
    if (!secret) {
      logger.warn('Missing CRYPTOMUS_WEBHOOK_SECRET');
    } else {
      const computed = crypto.createHmac('sha256', secret).update(event.body || '').digest('hex');
      if (!sigHeader || sigHeader !== computed) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
      }
    }
    // Common fields from Cryptomus (adjust based on actual payload)
    const status = (body.status || body.result || '').toLowerCase();
    const invoiceId = body.id || body.invoice_id || body.order_id || body.uuid || null;
    const amountStr = body.amount || (body.payment_amount && String(body.payment_amount)) || null;

    if (!invoiceId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing invoice/order id' }) };
    }

    // Find our payment by transaction_id or gateway order_id
    const { data: payments, error: findErr } = await supabaseAdmin
      .from('payments')
      .select('*')
      .in('transaction_id', [invoiceId])
      .limit(1);
    if (findErr) {
      logger.error('Find payment error', { error: serializeError(findErr), invoiceId });
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lookup failed' }) };
    }
    const payment = Array.isArray(payments) && payments[0];
    if (!payment) {
      // Fallback: try order_id stored in gateway_response
      const { data: byGateway, error: byGatewayErr } = await supabaseAdmin
        .from('payments')
        .select('*')
        .contains('gateway_response', { id: invoiceId })
        .limit(1);
      if (byGatewayErr) {
        logger.error('Find by gateway_response error', { error: serializeError(byGatewayErr), invoiceId });
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Payment not found' }) };
      }
      if (!byGateway || !byGateway[0]) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Payment not found' }) };
      }
    }

    const target = payment || (byGateway && byGateway[0]);
    if (!target) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Payment not found' }) };
    }
    if ((target.method || '').toLowerCase() !== 'cryptomus') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Wrong payment method for this callback' }) };
    }
    // Idempotency: if already completed, exit
    if ((target.status || '').toLowerCase() === 'completed') {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Already completed' }) };
    }

    // Only proceed on successful status
    const successStatuses = ['paid', 'completed', 'success'];
    if (!successStatuses.includes(status)) {
      // Optionally mark failed/cancelled
      if (['failed', 'error', 'cancelled'].includes(status)) {
        await supabaseAdmin.from('payments').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', target.id);
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, ignored: true }) };
    }

    // Parse amount (fallback to stored amount)
    const amount = amountStr != null ? parseFloat(String(amountStr)) : Number(target.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid amount' }) };
    }

    // Complete payment and credit user balance atomically (best-effort two-step)
    const now = new Date().toISOString();
    const { error: updErr } = await supabaseAdmin
      .from('payments')
      .update({ status: 'completed', updated_at: now })
      .eq('id', target.id);
    if (updErr) {
      logger.error('Update payment status error', { error: serializeError(updErr), id: target.id });
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Status update failed' }) };
    }

    // Fetch current balance, then set balance = balance + amount
    const { data: userRows, error: userErr } = await supabaseAdmin
      .from('users')
      .select('id,balance')
      .eq('id', target.user_id)
      .limit(1);
    if (userErr) {
      logger.error('Fetch user balance error', { error: serializeError(userErr), userId: target.user_id });
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, warning: 'Balance fetch failed' }) };
    }
    const userRow = Array.isArray(userRows) && userRows[0];
    const currentBalance = userRow && Number(userRow.balance) ? Number(userRow.balance) : 0;
    const { error: balErr } = await supabaseAdmin
      .from('users')
      .update({ balance: currentBalance + amount })
      .eq('id', target.user_id);
    if (balErr) {
      logger.error('Balance update error', { error: serializeError(balErr), userId: target.user_id });
      // Do not revert status; log and surface success with warning
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, warning: 'Balance update failed' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (e) {
    logger.error('Cryptomus callback error', { error: serializeError(e) });
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Callback processing failed' }) };
  }
};
