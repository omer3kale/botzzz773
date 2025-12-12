const { supabaseAdmin } = require('./utils/supabase');
const querystring = require('querystring');
const axios = require('axios');
const crypto = require('crypto');

// --- 0. SECURITY SETTINGS ---
// Rate Limit: A user can make a max of 200 requests per minute.
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 Minute
const RATE_LIMIT_MAX = 200; 

function checkRateLimit(userId) {
  const now = Date.now();
  const userStats = rateLimitMap.get(userId) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  
  if (now > userStats.resetAt) {
    userStats.count = 0;
    userStats.resetAt = now + RATE_LIMIT_WINDOW;
  }
  
  userStats.count++;
  rateLimitMap.set(userId, userStats);
  return userStats.count <= RATE_LIMIT_MAX;
}

// Helper: Hash the API Key using SHA256 before DB lookup
function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// --- 1. AUDIT LOGGING ---
async function auditLog(userId, eventType, details, severity = 'info') {
  // Silently catch logging errors so the main system doesn't crash
  supabaseAdmin.from('audit_log').insert([{
      user_id: userId || null, 
      event_type: eventType, 
      details: JSON.stringify(details), 
      severity: severity, 
      created_at: new Date().toISOString()
    }]).then(() => {}).catch(() => {});
}

// --- 2. AUTHENTICATION ---
async function getUserFromApiKey(apiKeyRaw) {
  if (!apiKeyRaw) return null;
  try {
    const apiKey = apiKeyRaw.trim();
    const hashedKey = hashApiKey(apiKey);

    // Lookup hashed key in DB
    const { data: keyData, error: kErr } = await supabaseAdmin
        .from('api_keys')
        .select('id, user_id, status')
        .eq('key_hash', hashedKey)
        .single();

    if (kErr || !keyData || keyData.status !== 'active') return null;

    // Lookup user
    const { data: userData, error: uErr } = await supabaseAdmin
        .from('users')
        .select('id, email, balance, status')
        .eq('id', keyData.user_id)
        .eq('status', 'active')
        .single();

    if (uErr || !userData) return null;

    // Async update last_used timestamp (Continue without waiting)
    supabaseAdmin.from('api_keys').update({ last_used: new Date().toISOString() }).eq('id', keyData.id).then(() => {});
    return userData;
  } catch (error) { return null; }
}

// --- 3. FETCH SERVICES ---
async function getServices() {
  const { data: services, error } = await supabaseAdmin.from('services').select('*').eq('status', 'active').order('category', { ascending: true });
  if (error || !services) return [];
  
  return services.map(s => {
    try {
      // Use public_id for external exposure
      let exposedId = s.public_id ? s.public_id : s.id;
      let serviceId = parseInt(String(exposedId).replace(/\D/g, ''), 10) || 0;
      
      return {
        service: serviceId, 
        name: s.name, 
        type: s.type || 'Default', 
        category: s.category || 'General',
        rate: parseFloat(s.rate).toFixed(2), 
        min: parseInt(s.min_quantity || 1), 
        max: parseInt(s.max_quantity || 1000),
        refill: s.refill_supported === true, 
        cancel: s.cancel_supported === true, 
        dripfeed: s.dripfeed_supported === true
      };
    } catch (e) { return null; }
  }).filter(s => s && s.service > 0);
}

// --- 4. REQUEST PARSER ---
function parseRequest(event) {
  let params = {};
  
  // 1. Standard Parsing
  if (event.queryStringParameters) Object.assign(params, event.queryStringParameters);
  
  let bodyString = '';
  if (event.body) {
    bodyString = event.body;
    if (event.isBase64Encoded) bodyString = Buffer.from(bodyString, 'base64').toString('utf-8');
    try {
      if (bodyString.startsWith('{')) Object.assign(params, JSON.parse(bodyString));
      else Object.assign(params, querystring.parse(bodyString));
    } catch (e) {}
  }

  // 2. Regex Fallback (Bulletproof Parsing for malformed requests)
  if (!params.action && bodyString) {
    const aM = bodyString.match(/action=([^&]+)/); if (aM) params.action = aM[1];
    const kM = bodyString.match(/key=([^&]+)/); if (kM) params.key = kM[1];
  }
  
  if (params.key) params.key = String(params.key).trim();
  if (params.action) params.action = String(params.action).trim();
  return params;
}

// Normalize incoming links for duplicate detection
function normalizeLink(raw = '') {
  try {
    if (!raw || typeof raw !== 'string') return '';
    const original = raw.trim();

    // Fast cleanup for fragments and query
    let cleaned = original.replace(/#.*$/, '')
                          .replace(/\?.*$/, '')
                          .replace(/\/+$/g, '');

    // Try URL parsing for domain-aware normalization
    try {
      const u = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
      let host = u.hostname.toLowerCase();
      let path = u.pathname || '/';

      // Collapse multiple slashes in path
      path = path.replace(/\/{2,}/g, '/');

      // Instagram-specific normalization
      const isInstagram = /(^|\.)instagram\.com$/.test(host) || host === 'instagr.am';
      if (isInstagram) {
        // Unify host variants to instagram.com
        host = 'instagram.com';

        // Lowercase path for consistent matching
        path = decodeURIComponent(path).toLowerCase();

        // Normalize common IG routes
        // Profile: /username -> remove trailing slash
        // Posts: /p/{id}, Reels: /reel/{id}
        // Stories/highlights left as-is but cleaned
        // Remove trailing slash once more after lowercasing
        path = path.replace(/\/+$/g, '');

        // Convert /m/ and other mobile prefixes
        if (path.startsWith('/m/')) {
          path = path.substring(2); // remove '/m'
        }

        // Normalize short domain instagr.am to instagram.com is done above
      }

      // Rebuild normalized URL without query/fragment
      const normalized = `${host}${path || ''}`;
      return normalized;
    } catch {
      // Fallback: return cleaned string
      return cleaned;
    }
  } catch (_) {
    return String(raw || '').trim();
  }
}

// --- 5. HTML DOCUMENTATION ---
const HTML_DOCS = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>API v2 Integration</title><style>body{font-family:sans-serif;background:#0f172a;color:#fff;padding:40px;max-width:800px;margin:0 auto}h1{color:#38bdf8}pre{background:#1e293b;padding:15px;border-radius:5px;overflow-x:auto}code{color:#f472b6}</style></head><body><h1>🚀 API Integration</h1><p>Endpoint: <code>POST /api</code></p><h3>Check Balance</h3><pre>key=API_KEY&action=balance</pre><h3>Add Order</h3><pre>key=API_KEY&action=add&service=1&link=url&quantity=100</pre></body></html>`;

// --- 6. MAIN HANDLER ---
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params = parseRequest(event);
    const action = params.action;
    const apiKey = params.key;

    // Helper: Error function that always returns balance to prevent panel errors
    const errorResponse = (msg) => ({ 
        statusCode: 200, 
        headers, 
        body: JSON.stringify({ error: msg, balance: "0.00", currency: "USD" }) 
    });

    // Show HTML Docs (Only for GET requests without key/action)
    if (!action && !apiKey && event.httpMethod === 'GET') {
       if (!(event.headers['accept'] || '').includes('json')) {
          return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: HTML_DOCS };
       }
    }

    // 1. BALANCE CHECK (Special Case)
    if (action === 'balance') {
        const user = await getUserFromApiKey(apiKey);
        if (!user) return errorResponse('Invalid API key'); 
        
        const balanceStr = parseFloat(user.balance || 0).toFixed(2);
        return { statusCode: 200, headers, body: JSON.stringify({ balance: balanceStr, funds: balanceStr, currency: 'USD' }) };
    }

    // 2. GENERAL AUTHENTICATION
    let user = null;
    if (apiKey) user = await getUserFromApiKey(apiKey);
    
    // User is required for all actions except 'services'
    if ((!action || action !== 'services') && !user) return errorResponse('Invalid API key');

    // 3. RATE LIMIT CHECK
    if (user && !checkRateLimit(user.id)) {
        await auditLog(user.id, 'rate_limit', { action }, 'warning');
        return errorResponse('Rate limit exceeded (200/min)');
    }

    // 4. ACTION HANDLERS
    switch (action || 'services') {
      case 'services':
        const services = await getServices();
        return { statusCode: 200, headers, body: JSON.stringify(services) };

      case 'add':
        // Idempotency Check
        const idempotencyKey = event.headers['x-idempotency-key'];
        if (idempotencyKey) {
             const { data: existing } = await supabaseAdmin.from('orders')
                 .select('order_number')
                 .eq('external_order_id', idempotencyKey).single();
             if (existing) {
                 const safeOrderId = parseInt(existing.order_number) || existing.order_number;
                 return { statusCode: 200, headers, body: JSON.stringify({ order: safeOrderId }) };
             }
        }

        if (!params.service || !params.link || !params.quantity) return errorResponse('Missing parameters');
        
        // Fetch Service & Provider info
        const { data: sData } = await supabaseAdmin.from('services').select('*, provider:providers(*)').eq('public_id', params.service).single();
        if (!sData) return errorResponse('Service not found');

        // Quantity Check
        const qty = parseInt(params.quantity);
        if (qty < (sData.min_quantity || 1) || qty > (sData.max_quantity || 1000)) return errorResponse('Quantity error');

        // Duplicate Link Protection: reject same service+link if an active order exists
        const normalizedLink = normalizeLink(params.link);
        try {
          const { data: dup } = await supabaseAdmin
            .from('orders')
            .select('id, status, customer_status')
            .eq('service_id', sData.id)
            .eq('link', normalizedLink)
            .in('status', ['pending','processing','in progress','partial'])
            .limit(1);

          if (Array.isArray(dup) && dup.length > 0) {
            await auditLog(user.id, 'duplicate_link_active', { service_id: sData.id, link: normalizedLink }, 'warning');
            return errorResponse('Link duplicate. Order with this link already in progress.');
          }
        } catch (dupErr) {
          // If duplicate check fails, be conservative and proceed (do not block orders)
          await auditLog(user.id, 'duplicate_check_error', { msg: dupErr?.message }, 'warning');
        }

        // Note: No time-window duplicate block. Once provider marks completed,
        // reseller can resend; only active statuses are blocked.

        // Balance Check
        const charge = (parseFloat(sData.rate) / 1000) * qty;
        if (parseFloat(user.balance) < charge) {
            await auditLog(user.id, 'no_balance', { charge }, 'warning');
            return errorResponse('Not enough balance');
        }

        // Deduct Balance
        await supabaseAdmin.from('users').update({ balance: parseFloat(user.balance) - charge }).eq('id', user.id);
        
        // Create Order (DB Trigger will generate public_order_id and order_number)
        const { data: newOrder, error: oErr } = await supabaseAdmin.from('orders').insert({
          user_id: user.id, service_id: sData.id, service_name: sData.name, link: normalizedLink, quantity: qty, charge: charge,
            status: 'pending', customer_status: 'pending', mode: 'API', provider_currency: 'USD', external_order_id: idempotencyKey || null
        }).select('id, order_number').single();

        if (oErr) return errorResponse('Order failed');

        // Provider Forwarding (with 10s Timeout)
        if (sData.provider && sData.provider.api_key) {
           try {
            const pParams = new URLSearchParams({ 
              key: sData.provider.api_key, action: 'add', service: sData.provider_service_id, link: params.link, quantity: qty 
            });
            const pRes = await axios.post(sData.provider.api_url, pParams, { timeout: 10000 });
            if (pRes.data && pRes.data.order) {
              await supabaseAdmin.from('orders').update({ 
                status: 'processing',
                customer_status: 'processing',
                provider_status: 'processing',
                provider_order_id: pRes.data.order 
              }).eq('id', newOrder.id);
            }
           } catch (e) {
            // If provider rejects (e.g., insufficient balance), mark the order as failed for admins
            const providerErrorMessage = e?.response?.data?.error || e?.message || 'Provider request failed';
            await supabaseAdmin.from('orders').update({
              status: 'failed',
              customer_status: 'pending',
              provider_status: 'failed',
              provider_error: providerErrorMessage,
              last_status_sync: new Date().toISOString()
            }).eq('id', newOrder.id);
            await auditLog(user.id, 'provider_fail', { msg: providerErrorMessage }, 'error');
           }
        }
        
        // Return Order Number as Integer (e.g. 37000040)
        const finalOrderId = parseInt(newOrder.order_number) || newOrder.order_number;
        return { statusCode: 200, headers, body: JSON.stringify({ order: finalOrderId }) };

      case 'status':
         if (params.orders) {
             // Multi-Order Status
             const ids = params.orders.split(',').map(i => i.trim()).filter(i => i.length > 0);
             
             // Query using order_number (string in DB)
             const { data: mOrders } = await supabaseAdmin.from('orders')
                .select('order_number, status, charge, start_count, remains')
                .in('order_number', ids)
                .eq('user_id', user.id);

             let res = {};
             if(mOrders) mOrders.forEach(o => res[o.order_number] = { status: o.status, charge: o.charge, start_count: o.start_count, remains: o.remains, currency: 'USD' });
             return { statusCode: 200, headers, body: JSON.stringify(res) };
         }
         
         // Single Order Status
         if (!params.order) return errorResponse('Missing order ID');
         
         const { data: oData } = await supabaseAdmin.from('orders')
            .select('status, charge, start_count, remains')
            .eq('order_number', params.order)
            .eq('user_id', user.id)
            .single();

         if (!oData) return errorResponse('Order not found');
         return { statusCode: 200, headers, body: JSON.stringify({ status: oData.status, charge: oData.charge, start_count: oData.start_count || 0, remains: oData.remains || 0, currency: 'USD' }) };

      case 'refill':
         if (!params.order) return errorResponse('Missing order ID');
         
         const { data: rOrder } = await supabaseAdmin.from('orders')
            .select('id, provider_order_id, service:services(provider:providers(*))')
            .eq('order_number', params.order)
            .eq('user_id', user.id).single();
         
         if (rOrder && rOrder.service && rOrder.service.provider) {
             try {
                const rRes = await axios.post(rOrder.service.provider.api_url, new URLSearchParams({ key: rOrder.service.provider.api_key, action: 'refill', order: rOrder.provider_order_id }), { timeout: 10000 });
                if (rRes.data.refill) {
                    await supabaseAdmin.from('orders').update({ refill_id: rRes.data.refill, status: 'refilling' }).eq('id', rOrder.id);
                    return { statusCode: 200, headers, body: JSON.stringify({ refill: rRes.data.refill }) };
                }
             } catch(e) {}
         }
         return errorResponse('Refill failed');

      case 'refill_status':
         if (!params.refill) return errorResponse('Missing refill ID');
         const { data: rs } = await supabaseAdmin.from('orders').select('status').eq('refill_id', params.refill).eq('user_id', user.id).single();
         if (!rs) return errorResponse('Refill not found');
         return { statusCode: 200, headers, body: JSON.stringify({ status: rs.status === 'failed' ? 'rejected' : 'processing' }) };

      case 'cancel':
         const { data: cOrder } = await supabaseAdmin.from('orders')
             .select('id, status, charge')
             .eq('order_number', params.order)
             .eq('user_id', user.id)
             .single();

         if (!cOrder || cOrder.status !== 'pending') return errorResponse('Cancel failed');
         
         // Refund & Cancel
         await supabaseAdmin.from('users').update({ balance: parseFloat(user.balance) + parseFloat(cOrder.charge) }).eq('id', user.id);
         await supabaseAdmin.from('orders').update({ status: 'canceled' }).eq('id', cOrder.id);
         
         const cancelId = parseInt(params.order) || params.order;
         return { statusCode: 200, headers, body: JSON.stringify({ order: cancelId, canceled: true }) };

      default:
        return errorResponse('Invalid action');
    }
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: 'System error', balance: "0.00", currency: "USD" }) };
  }
};