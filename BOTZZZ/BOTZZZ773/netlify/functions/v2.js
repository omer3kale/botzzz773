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
        const { data: sData } = await supabaseAdmin.from('services').select('*, provider_id, provider:providers(id, name, api_url, api_key)').eq('public_id', params.service).single();
        if (!sData) return errorResponse('Service not found');

        // Quantity Check
        const qty = parseInt(params.quantity);
        if (qty < (sData.min_quantity || 1) || qty > (sData.max_quantity || 1000)) return errorResponse('Quantity error');

        // Duplicate Link Protection: allow only if previous order is COMPLETED
        try {
          const { data: dup } = await supabaseAdmin
            .from('orders')
            .select('id, status, customer_status, provider_error, order_number')
            .eq('service_id', sData.id)
            .eq('link', params.link)
            .in('status', ['pending', 'processing', 'in progress', 'failed', 'canceled'])
            .limit(1);

          if (Array.isArray(dup) && dup.length > 0) {
            const prev = dup[0];
            await auditLog(user.id, 'duplicate_link_blocked_until_completed', { service_id: sData.id, link: params.link, previous_order: prev?.order_number, previous_status: prev?.status, previous_error: prev?.provider_error }, 'warning');
            const msg = prev?.status === 'failed' && prev?.provider_error 
              ? `Previous order failed: ${prev.provider_error}. You can reorder this link only after the previous order is completed.`
              : 'Link duplicate. You can reorder this link only after the previous order is completed.';
            return errorResponse(msg);
          }

          // Allow retries when previous order is completed/failed/canceled.
          // Only active statuses are blocked above.
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
        
        // Generate order number with random increment (1-30) from last order number
        let orderNumber = null;
        let newOrder = null;
        let oErr = null;
        let retryCount = 0;
        const maxRetries = 3;

        // Retry loop for handling duplicate order_number (race condition)
        while (retryCount < maxRetries) {
          try {
            const { data: lastOrder } = await supabaseAdmin
              .from('orders')
              .select('order_number')
              .order('created_at', { ascending: false })
              .limit(1)
              .single();

            let baseNumber = 37000000;
            if (lastOrder && lastOrder.order_number) {
              const lastNum = parseInt(String(lastOrder.order_number), 10);
              if (!isNaN(lastNum) && lastNum >= baseNumber) {
                baseNumber = lastNum;
              }
            }

            // Wider range on retry to reduce collision probability
            const randomIncrement = retryCount === 0 
              ? Math.floor(Math.random() * 30) + 1
              : Math.floor(Math.random() * 50) + 1;
            orderNumber = String(baseNumber + randomIncrement);
          } catch (error) {
            console.error('[V2] Failed to generate order number:', error);
            orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
          }
          
          // Try to create order with generated order_number
          const insertResult = await supabaseAdmin.from('orders').insert({
            user_id: user.id, service_id: sData.id, service_name: sData.name, link: params.link, quantity: qty, charge: charge,
              order_number: orderNumber, status: 'pending', customer_status: 'pending', mode: 'API', provider_currency: 'USD', external_order_id: idempotencyKey || null
          }).select('id, order_number').single();

          newOrder = insertResult.data;
          oErr = insertResult.error;

          // Check if error is duplicate order_number (unique constraint violation)
          const isDuplicateOrderNumber = oErr && (
            oErr.code === '23505' || // Postgres unique violation
            /unique.*order_number/i.test(oErr.message || '') ||
            /duplicate.*order_number/i.test(oErr.message || '')
          );

          if (isDuplicateOrderNumber && retryCount < maxRetries - 1) {
            retryCount++;
            console.log(`[V2] Duplicate order_number detected, retrying (attempt ${retryCount})`);
            continue;
          }

          // Either success or non-duplicate error, exit loop
          break;
        }

        if (oErr) return errorResponse('Order failed');

        // Post-Creation Race Condition Check: if another non-completed order with same service+link exists, delete this one and reject
        try {
          const { data: otherOrders } = await supabaseAdmin
            .from('orders')
            .select('id, created_at, status, provider_error, order_number')
            .eq('service_id', sData.id)
            .eq('link', params.link)
            .in('status', ['pending', 'processing', 'in progress', 'failed', 'canceled'])
            .neq('id', newOrder.id)
            .limit(1);

          if (Array.isArray(otherOrders) && otherOrders.length > 0) {
            // Another order exists; delete this one and reject
            await supabaseAdmin.from('orders').delete().eq('id', newOrder.id);
            // Refund the charge
            await supabaseAdmin.from('users').update({ balance: parseFloat(user.balance) }).eq('id', user.id);
            const prev = otherOrders[0];
            await auditLog(user.id, 'duplicate_link_race_blocked_until_completed', { service_id: sData.id, link: params.link, previous_order: prev?.order_number, previous_status: prev?.status, previous_error: prev?.provider_error, deleted_order_id: newOrder.id }, 'warning');
            const msg = prev?.status === 'failed' && prev?.provider_error 
              ? `Previous order failed: ${prev.provider_error}. You can reorder this link only after the previous order is completed.`
              : 'Link duplicate. You can reorder this link only after the previous order is completed.';
            return errorResponse(msg);
          }
        } catch (raceErr) {
          console.error('[V2] Race condition check failed:', raceErr?.message);
          // Continue anyway; if there's an issue, let sync handle it
        }

        // Provider Forwarding (with 10s Timeout)
        console.log('[V2 DEBUG] Checking provider:', { hasProvider: !!sData.provider, hasApiKey: !!sData.provider?.api_key });
        if (sData.provider && sData.provider.api_key) {
           try {
            console.log('[V2 PROVIDER] Forwarding to provider:', sData.provider.name);
            const providerServiceId = sData.provider_service_id || sData.public_id || sData.id;
            const pParams = new URLSearchParams({ 
              key: sData.provider.api_key, action: 'add', service: providerServiceId, link: params.link, quantity: qty 
            });
            console.log('[V2 PROVIDER] Request params:', { service: providerServiceId, link: params.link, quantity: qty });
            const pRes = await axios.post(sData.provider.api_url, pParams, { timeout: 10000 });
            console.log('[V2 PROVIDER] Response:', pRes.data);
            if (pRes.data && pRes.data.order) {
              // Provider accepted order; immediately check status to get real state
              const providerOrderId = pRes.data.order;
              let finalStatus = 'pending';
              let finalCustomerStatus = 'pending';
              let finalProviderStatus = 'pending';

              try {
                const statusParams = new URLSearchParams({
                  key: sData.provider.api_key,
                  action: 'status',
                  order: providerOrderId
                });
                const statusRes = await axios.post(sData.provider.api_url, statusParams, { timeout: 5000 });
                const providerStatusRaw = statusRes.data?.status || statusRes.data?.status_text || 'pending';
                
                // Normalize provider status using same logic as orders.js
                const normalizeStatus = (raw) => {
                  const s = String(raw).trim().toLowerCase();
                  if (['pending', 'in queue', 'queue', 'waiting'].includes(s)) return 'pending';
                  if (s === 'in progress' || s === 'inprogress' || s === 'in_progress') return 'in progress';
                  if (s === 'processing' || s === 'started') return 'processing';
                  if (s.includes('partial')) return 'partial';
                  if (s.includes('cancel')) return 'canceled';
                  if (s.includes('fail')) return 'failed';
                  if (s.includes('completed') || s.includes('success') || s.includes('done')) return 'completed';
                  return 'processing';
                };
                
                finalProviderStatus = providerStatusRaw;
                finalStatus = normalizeStatus(providerStatusRaw);
                
                // Sync customer_status: mirror provider status for in progress/processing
                if (finalStatus === 'in progress') {
                  finalCustomerStatus = 'in progress';
                } else if (finalStatus === 'processing') {
                  finalCustomerStatus = 'processing';
                } else if (finalStatus === 'completed') {
                  finalCustomerStatus = 'completed';
                } else if (finalStatus === 'partial') {
                  finalCustomerStatus = 'partial';
                } else if (finalStatus === 'canceled') {
                  finalCustomerStatus = 'canceled';
                } else if (finalStatus === 'failed') {
                  finalCustomerStatus = 'pending'; // admin sees failed, user sees pending
                } else {
                  finalCustomerStatus = 'pending';
                }
              } catch (statusErr) {
                // Status check failed; default to pending and let sync job handle it later
              }

              await supabaseAdmin.from('orders').update({ 
                status: finalStatus,
                customer_status: finalCustomerStatus,
                provider_status: finalProviderStatus,
                provider_order_id: providerOrderId,
                last_status_sync: new Date().toISOString()
              }).eq('id', newOrder.id);
            } else {
              const providerErrorMessage = pRes?.data?.error 
                || pRes?.data?.message 
                || pRes?.data?.status_text
                || 'Provider did not return order id';

              await supabaseAdmin.from('orders').update({
                status: 'failed',
                customer_status: 'pending',
                provider_status: 'failed',
                provider_error: providerErrorMessage,
                last_status_sync: new Date().toISOString()
              }).eq('id', newOrder.id);

              if (sData.provider && sData.provider.id) {
                await supabaseAdmin.from('provider_errors').insert({
                  provider_id: sData.provider.id,
                  order_id: newOrder.id,
                  error_type: 'forward_rejected',
                  error_message: providerErrorMessage,
                  error_context: { service_id: sData.id, service_name: sData.name, response: pRes?.data },
                  resolved: false,
                  error_timestamp: new Date().toISOString()
                }).then(() => {}).catch(err => console.error('Failed to log provider_error:', err));
              }

              await auditLog(user.id, 'provider_fail', { msg: providerErrorMessage, response: pRes?.data }, 'error');
            }
           } catch (e) {
            // If provider rejects (e.g., insufficient balance), mark the order as failed for admins
            const providerErrorMessage = e?.response?.data?.error 
              || e?.response?.data?.message 
              || e?.response?.data?.status_text
              || e?.response?.data?.description
              || (e?.response?.data ? JSON.stringify(e.response.data) : null)
              || e?.message 
              || 'Provider request failed';
            
            await supabaseAdmin.from('orders').update({
              status: 'failed',
              customer_status: 'pending',
              provider_status: 'failed',
              provider_error: providerErrorMessage,
              last_status_sync: new Date().toISOString()
            }).eq('id', newOrder.id);
            
            // Log to provider_errors table for admin visibility
            if (sData.provider && sData.provider.id) {
              await supabaseAdmin.from('provider_errors').insert({
                provider_id: sData.provider.id,
                order_id: newOrder.id,
                error_type: 'forward_failed',
                error_message: providerErrorMessage,
                error_context: { 
                  service_id: sData.id,
                  service_name: sData.name,
                  response: e?.response?.data 
                },
                resolved: false,
                error_timestamp: new Date().toISOString()
              }).then(() => {}).catch(err => console.error('Failed to log provider_error:', err));
            }
            
            await auditLog(user.id, 'provider_fail', { msg: providerErrorMessage, response: e?.response?.data }, 'error');
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
                .select('order_number, customer_status, charge, start_count, remains')
                .in('order_number', ids)
                .eq('user_id', user.id);

             let res = {};
             if(mOrders) mOrders.forEach(o => res[o.order_number] = { status: o.customer_status || 'pending', charge: o.charge, start_count: o.start_count, remains: o.remains, currency: 'USD' });
             return { statusCode: 200, headers, body: JSON.stringify(res) };
         }
         
         // Single Order Status
         if (!params.order) return errorResponse('Missing order ID');
         
         const { data: oData } = await supabaseAdmin.from('orders')
            .select('customer_status, charge, start_count, remains')
            .eq('order_number', params.order)
            .eq('user_id', user.id)
            .single();

         if (!oData) return errorResponse('Order not found');
         return { statusCode: 200, headers, body: JSON.stringify({ status: oData.customer_status || 'pending', charge: oData.charge, start_count: oData.start_count || 0, remains: oData.remains || 0, currency: 'USD' }) };

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