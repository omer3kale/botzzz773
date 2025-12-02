const crypto = require('crypto');
const { supabaseAdmin } = require('./utils/supabase');

const SITE_URL = process.env.SITE_URL;
const CRYPTOMUS_API_KEY = process.env.CRYPTOMUS_API_KEY;
const CRYPTOMUS_MERCHANT_ID = process.env.CRYPTOMUS_MERCHANT_ID;
// Webhook verification settings (configurable via env)
const CRYPTOMUS_WEBHOOK_SECRET = process.env.CRYPTOMUS_WEBHOOK_SECRET || process.env.CRYPTOMUS_API_KEY;
// Cryptomus uses header `sign` and base64 HMAC-SHA256 by default
const CRYPTOMUS_SIGNATURE_HEADER = process.env.CRYPTOMUS_SIGNATURE_HEADER || 'sign';
const CRYPTOMUS_SIGNATURE_ALGORITHM = (process.env.CRYPTOMUS_SIGNATURE_ALGORITHM || 'sha256').toLowerCase();

function safeHeaderLookup(headers, name) {
  if (!headers) return null;
  const lower = Object.keys(headers).reduce((acc, k) => {
    acc[k.toLowerCase()] = headers[k];
    return acc;
  }, {});
  return lower[name.toLowerCase()] || null;
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

  // We expect Cryptomus to POST JSON webhook payloads
  try {
    const rawBody = event.body || '';

    // Optional: verify signature if Cryptomus is configured to send one
    const signatureHeader = safeHeaderLookup(event.headers, CRYPTOMUS_SIGNATURE_HEADER);
    const userIdHeader = safeHeaderLookup(event.headers, 'userId') || safeHeaderLookup(event.headers, 'userid') || safeHeaderLookup(event.headers, 'x-userid');

    // If merchant id is configured, require userId to match
    if (CRYPTOMUS_MERCHANT_ID && userIdHeader) {
      if (String(userIdHeader).trim() !== String(CRYPTOMUS_MERCHANT_ID).trim()) {
        console.warn('Cryptomus webhook userId mismatch', { received: userIdHeader, expected: CRYPTOMUS_MERCHANT_ID });
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid userId' }) };
      }
    }

    if (signatureHeader) {
      if (!CRYPTOMUS_WEBHOOK_SECRET) {
        console.error('Cryptomus webhook signature present but no webhook secret configured');
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Webhook verification misconfigured' }) };
      }

      const rawSig = String(signatureHeader).trim();
      // strip optional 'sha256=' prefix if present
      const cleanedSig = rawSig.replace(/^\w+=/i, '');

      let expectedBase64;
      try {
        expectedBase64 = crypto.createHmac(CRYPTOMUS_SIGNATURE_ALGORITHM, CRYPTOMUS_WEBHOOK_SECRET).update(rawBody).digest('base64');
      } catch (err) {
        console.error('Invalid signature algorithm configured for Cryptomus webhook:', CRYPTOMUS_SIGNATURE_ALGORITHM, err);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Webhook verification misconfigured' }) };
      }

      const toBuffer = (s) => {
        try { return Buffer.from(String(s)); } catch (e) { return null; }
      };

      const sigBuf = toBuffer(cleanedSig);
      const b64Buf = toBuffer(expectedBase64);

      const verified = sigBuf && b64Buf && sigBuf.length === b64Buf.length && (() => { try { return crypto.timingSafeEqual(sigBuf, b64Buf); } catch (e) { return false; } })();

      if (!verified) {
        console.warn('Cryptomus webhook signature mismatch (base64 expected)');
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
      }
    }

    const body = (() => {
      try { return JSON.parse(rawBody); } catch (e) { return null; }
    })();

    if (!body) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON payload' }) };
    }

    // Try multiple locations for invoice id / status (vendor differences)
    const invoiceId = body.id || body.invoice_id || (body.invoice && (body.invoice.id || body.invoice.invoice_id)) || (body.data && body.data.id) || (body.payload && body.payload.id);
    const statusRaw = body.status || (body.invoice && body.invoice.status) || (body.data && body.data.status) || (body.event && body.event.status) || null;
    const status = (statusRaw || '').toString().trim().toLowerCase();

    if (!invoiceId) {
      console.warn('Cryptomus webhook missing invoice id', body);
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing invoice id' }) };
    }

    // Map cryptomus statuses to internal statuses
    let mappedStatus = 'pending';
    if (['paid', 'success', 'confirmed', 'finished', 'completed'].includes(status)) mappedStatus = 'completed';
    if (['expired', 'cancelled', 'canceled', 'failed', 'error'].includes(status)) mappedStatus = 'failed';

    // Find payment record
    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('transaction_id', invoiceId)
      .maybeSingle();

    if (!payment) {
      // Try fallback by checking metadata or order_id stored in gateway_response
      const { data: alt } = await supabaseAdmin
        .from('payments')
        .select('*')
        .filter('gateway_response->>order_id', 'eq', invoiceId)
        .maybeSingle();

      if (!alt) {
        console.warn('No matching payment found for Cryptomus invoice', invoiceId);
        return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
      }
      payment = alt; // eslint-disable-line no-param-reassign
    }

    // If already final, skip
    const alreadyFinal = ['completed', 'failed', 'refunded', 'expired'].includes((payment.status || '').toLowerCase());
    if (alreadyFinal && payment.status === mappedStatus) {
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    // Update payment record
    const update = {
      status: mappedStatus,
      details: {
        ...(payment.details || {}),
        cryptomus: body
      },
      updated_at: new Date().toISOString()
    };

    await supabaseAdmin
      .from('payments')
      .update(update)
      .eq('id', payment.id);

    // If moved to completed and previous wasn't completed -> credit user
    if (mappedStatus === 'completed' && (payment.status || '').toLowerCase() !== 'completed') {
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('balance')
        .eq('id', payment.user_id)
        .single();

      if (userData) {
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
              method: 'cryptomus',
              transaction_id: invoiceId
            }
          });
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
  } catch (error) {
    console.error('Cryptomus webhook error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
