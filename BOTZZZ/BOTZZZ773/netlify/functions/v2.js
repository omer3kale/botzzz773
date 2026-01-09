const { supabaseAdmin } = require('./utils/supabase');
const querystring = require('querystring');
const axios = require('axios');
const crypto = require('crypto');

// --- SERVICE-LEVEL DISCOUNTS (Global overrides) ---
// Map of public service_id -> discount percentage to apply for ALL users/resellers.
// Example: { 9071: 10 } means apply 10% discount for service 9071.
// Note: This overrides per-user global discount_rate when present.
const SERVICE_DISCOUNTS = {
  9071: 10
};

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
    
    // Extract prefix (first 12 chars) and last 4 chars
    const keyPrefix = apiKey.substring(0, 12);
    const keyLastFour = apiKey.slice(-4);

    // Lookup by prefix and last_four (more flexible than hash)
    const { data: keyData, error: kErr } = await supabaseAdmin
        .from('api_keys')
        .select('id, user_id, status')
        .eq('key_prefix', keyPrefix)
        .eq('key_last_four', keyLastFour)
        .single();

    if (kErr || !keyData || keyData.status !== 'active') return null;

    // Lookup user
    const { data: userData, error: uErr } = await supabaseAdmin
        .from('users')
        .select('id, email, balance, status, discount_rate, service_discounts')
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
async function getServices(user = null) {
  const { data: services, error } = await supabaseAdmin.from('services').select('*').eq('status', 'active').order('category', { ascending: true });
  if (error || !services) return [];
  
  return services.map(s => {
    try {
      // Use public_id for external exposure
      let exposedId = s.public_id ? s.public_id : s.id;
      let serviceId = parseInt(String(exposedId).replace(/\D/g, ''), 10) || 0;
      
      // Prefer retail_rate; show with 4-decimal precision to avoid misleading rounding
      let rateNumber = parseFloat(s.retail_rate ?? s.rate ?? 0);
      
      // Apply user-specific discounts if authenticated
      if (user) {
        const publicServiceId = Number(s.public_id || s.id || 0);
        const userServiceDiscounts = (user.service_discounts && typeof user.service_discounts === 'object') 
          ? user.service_discounts 
          : {};
        const userSpecificDiscount = userServiceDiscounts[publicServiceId];
        const globalServiceDiscount = SERVICE_DISCOUNTS[publicServiceId];
        const userGlobalDiscount = Number(user.discount_rate ?? 0);
        
        let effectiveDiscount = 0;
        
        if (userSpecificDiscount !== undefined && userSpecificDiscount !== null && Number.isFinite(Number(userSpecificDiscount))) {
          const val = Number(userSpecificDiscount);
          if (val >= 0 && val <= 100) {
            effectiveDiscount = val;
          }
        } else if (globalServiceDiscount !== undefined && globalServiceDiscount !== null && Number.isFinite(Number(globalServiceDiscount))) {
          const val = Number(globalServiceDiscount);
          if (val >= 0 && val <= 100) {
            effectiveDiscount = val;
          }
        } else if (userGlobalDiscount > 0 && userGlobalDiscount <= 100) {
          effectiveDiscount = userGlobalDiscount;
        }
        
        if (effectiveDiscount > 0) {
          rateNumber = Number((rateNumber * (1 - effectiveDiscount / 100)).toFixed(4));
        }
      }
      
      const rateValue = Number(rateNumber.toFixed(4));
      return {
        service: serviceId, 
        name: s.name, 
        type: 'Default', 
        category: s.category || 'General',
        rate: rateValue,
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

    // Accept API key from multiple locations (Perfect Panel may send Bearer token)
    const bearerHeader = event.headers?.authorization || event.headers?.Authorization;
    let apiKey = params.key
      || params.api_key
      || params.token
      || event.headers?.['x-api-key']
      || event.headers?.['X-API-Key'];
    if (!apiKey && bearerHeader && bearerHeader.toLowerCase().startsWith('bearer ')) {
      apiKey = bearerHeader.slice(7).trim();
    }

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
        
        // Format balance with up to 5 decimals, trim trailing zeros
        const balanceNum = parseFloat(user.balance || 0);
        const balanceStr = String(balanceNum.toFixed(5))
            .replace(/(\.\d*?[1-9])0+$/, '$1')
            .replace(/\.0+$/, '');
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
        // If user is authenticated, pass user object to apply their discounts
        const services = await getServices(user);
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
        const { data: sData } = await supabaseAdmin.from('services').select('*, rate, retail_rate, provider_id, provider:providers(id, name, api_url, api_key)').eq('public_id', params.service).single();
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
            .in('status', ['pending', 'processing', 'in progress', 'failed'])
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
        const rateValue = parseFloat(sData.retail_rate ?? sData.rate ?? 0);
        
        // Determine effective discount: user-specific service → global service → user global
        const publicServiceId = Number(sData.public_id || sData.id || 0);
        const userServiceDiscounts = (user.service_discounts && typeof user.service_discounts === 'object') 
          ? user.service_discounts 
          : {};
        const userSpecificDiscount = userServiceDiscounts[publicServiceId];
        const globalServiceDiscount = SERVICE_DISCOUNTS[publicServiceId];
        const userGlobalDiscount = Number(user.discount_rate ?? 0);
        
        let effectiveDiscount = 0;
        let discountSource = 'none';
        
        if (userSpecificDiscount !== undefined && userSpecificDiscount !== null && Number.isFinite(Number(userSpecificDiscount))) {
          const val = Number(userSpecificDiscount);
          if (val >= 0 && val <= 100) {
            effectiveDiscount = val;
            discountSource = 'user-service';
          }
        } else if (globalServiceDiscount !== undefined && globalServiceDiscount !== null && Number.isFinite(Number(globalServiceDiscount))) {
          const val = Number(globalServiceDiscount);
          if (val >= 0 && val <= 100) {
            effectiveDiscount = val;
            discountSource = 'global-service';
          }
        } else if (userGlobalDiscount > 0 && userGlobalDiscount <= 100) {
          effectiveDiscount = userGlobalDiscount;
          discountSource = 'user-global';
        }
        
        let finalRate = rateValue;
        if (effectiveDiscount > 0) {
            const discountAmount = rateValue * (effectiveDiscount / 100);
            finalRate = rateValue - discountAmount;
            console.log('[V2 ADD] Discount applied:', { original_rate: rateValue, discount_rate: effectiveDiscount + '%', source: discountSource, final_rate: finalRate });
        }
        
        // Preserve micro-charges by keeping 5-decimal precision on orders
        const charge = Number(((finalRate / 1000) * qty).toFixed(5));
        console.log('[V2 ADD] Charge calculation:', { retail_rate: sData.retail_rate, rate: sData.rate, rateValue, finalRate, qty, charge, discount_applied: effectiveDiscount > 0 });
        // Reject if rate is missing or computed charge is not positive
        if (!Number.isFinite(charge) || charge <= 0) {
          await auditLog(user.id, 'invalid_charge_computed', { service_id: sData.id, public_id: sData.public_id, rate: sData.rate, retail_rate: sData.retail_rate, rateValue, qty, charge }, 'warning');
          return errorResponse('Service rate unavailable. Please try again later.');
        }
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
            user_id: user.id, service_id: sData.id, service_name: sData.name, link: params.link, quantity: qty, charge: charge, original_charge: charge,
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
            .in('status', ['pending', 'processing', 'in progress', 'failed'])
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
               .select('order_number, customer_status, charge, quantity, start_count, remains')
                .in('order_number', ids)
                .eq('user_id', user.id);

             let res = {};
             if(mOrders) mOrders.forEach(o => {
               const status = o.customer_status || 'pending';
               let chargeOut = o.charge;
               if (status === 'canceled' || status === 'cancelled') {
                 chargeOut = 0;
               } else if (status === 'partial') {
                 const qty = parseFloat(o.quantity || 0);
                 const remains = parseFloat(o.remains || 0);
                 const full = parseFloat(o.charge || 0);
                 if (qty > 0) {
                   const delivered = Math.max(0, qty - remains);
                   const ratePerUnit = full / qty;
                   chargeOut = Math.round((ratePerUnit * delivered) * 100) / 100;
                 }
               }
               res[o.order_number] = { status, charge: chargeOut, start_count: o.start_count, remains: o.remains, currency: 'USD' };
             });
             return { statusCode: 200, headers, body: JSON.stringify(res) };
         }
         
         // Single Order Status
         if (!params.order) return errorResponse('Missing order ID');
         
         const { data: oData } = await supabaseAdmin.from('orders')
            .select('customer_status, charge, quantity, start_count, remains')
            .eq('order_number', params.order)
            .eq('user_id', user.id)
            .single();

         if (!oData) return errorResponse('Order not found');
         {
           const status = oData.customer_status || 'pending';
           let chargeOut = oData.charge;
           if (status === 'canceled' || status === 'cancelled') {
             chargeOut = 0;
           } else if (status === 'partial') {
             const qty = parseFloat(oData.quantity || 0);
             const remains = parseFloat(oData.remains || 0);
             const full = parseFloat(oData.charge || 0);
             if (qty > 0) {
               const delivered = Math.max(0, qty - remains);
               const ratePerUnit = full / qty;
               chargeOut = Math.round((ratePerUnit * delivered) * 100) / 100;
             }
           }
           return { statusCode: 200, headers, body: JSON.stringify({ status, charge: chargeOut, start_count: oData.start_count || 0, remains: oData.remains || 0, currency: 'USD' }) };
         }

      case 'refill':
         // Support both single (order) and multiple (orders) refill requests
         const refillOrders = params.orders ? String(params.orders).split(',').map(o => o.trim()) : (params.order ? [String(params.order).trim()] : []);
         if (refillOrders.length === 0) return errorResponse('Missing order ID(s)');
         
         // Single refill response
         if (refillOrders.length === 1) {
            const orderNum = refillOrders[0];
            const { data: rOrder } = await supabaseAdmin.from('orders')
               .select('id, order_number, provider_order_id, service:services(public_id, provider:providers(*))')
               .eq('order_number', orderNum)
               .eq('user_id', user.id).single();
            
            if (rOrder && rOrder.service && rOrder.service.provider) {
                try {
                   // First, create the refill record with "pending" status immediately
                   console.log('[V2 REFILL] Creating pending refill request:', {
                       user_id: user.id,
                       order_number: rOrder.order_number
                   });
                   
                   const { error: insertError, data: insertData } = await supabaseAdmin.from('refill_requests').insert({
                       user_id: user.id,
                       order_number: rOrder.order_number,
                       provider_refill_id: null, // Initially null
                       service_id: rOrder.service?.public_id,
                       quantity: rOrder?.quantity || 0,
                       status: 'pending',
                       refill_requested_at: new Date().toISOString()
                   });
                   
                   if (insertError) {
                       console.error('[V2 REFILL] Insert error:', JSON.stringify(insertError));
                       return errorResponse(`Database error: ${insertError.message}`);
                   }
                   
                   console.log('[V2 REFILL] Pending refill created, now requesting from provider');
                   
                   // Get the generated refill_id
                   const { data: refillRecord, error: selectError } = await supabaseAdmin
                       .from('refill_requests')
                       .select('refill_id')
                       .eq('order_number', rOrder.order_number)
                       .eq('user_id', user.id)
                       .order('refill_requested_at', { ascending: false })
                       .limit(1)
                       .single();
                   
                   if (selectError) {
                       console.error('[V2 REFILL] Select error:', JSON.stringify(selectError));
                       return errorResponse('Failed to retrieve refill_id');
                   }
                   
                   let refillId = refillRecord?.refill_id;
                   
                   // If refill_id is still NULL or provider-like (< 15000), generate our own
                   if (!refillId || refillId < 15000) {
                       const randomIncrement = Math.floor(Math.random() * 5) + 1;
                       refillId = 15090 + randomIncrement;
                   }
                   
                   const { error: updateError } = await supabaseAdmin.from('orders').update({ refill_id: String(refillId), status: 'refilling', refill_requested_at: new Date().toISOString() }).eq('id', rOrder.id);
                   
                   if (updateError) {
                       console.error('[V2 REFILL] Order update error:', JSON.stringify(updateError));
                   }
                   
                   // Now try to request refill from provider (non-blocking)
                   // If it fails, the pending refill remains in database for admin review
                   let providerRefillId = null;
                   try {
                       const rRes = await axios.post(rOrder.service.provider.api_url, new URLSearchParams({ key: rOrder.service.provider.api_key, action: 'refill', order: rOrder.provider_order_id }), { timeout: 10000 });
                       providerRefillId = rRes.data?.refill || null;
                       const providerStatus = rRes.data?.status || null;
                       
                       if (providerRefillId) {
                           // Map provider status to our database status
                           const statusMap = {
                               'Pending': 'pending',
                               'In Progress': 'in progress',
                               'Completed': 'completed',
                               'Rejected': 'rejected'
                           };
                           const dbStatus = providerStatus ? statusMap[providerStatus] || 'pending' : 'pending';
                           
                           // Update with provider refill ID and status
                           const { error: providerUpdateError } = await supabaseAdmin
                               .from('refill_requests')
                               .update({ provider_refill_id: String(providerRefillId), status: dbStatus })
                               .eq('refill_id', refillId);
                           
                           if (providerUpdateError) {
                               console.warn('[V2 REFILL] Could not update provider_refill_id/status:', providerUpdateError.message);
                           }
                       }
                       console.log('[V2 REFILL] Provider response received:', { refillId: providerRefillId, status: providerStatus });
                   } catch(providerError) { 
                       console.warn('[V2 REFILL] Provider request failed (refill still pending):', providerError.message);
                       // Continue anyway - refill is already saved as pending
                   }
                   
                   // Return refill_id and status (Perfect Panel expects both)
                   return { statusCode: 200, headers, body: JSON.stringify({ refill: String(refillId), status: 'Pending' }) };
                } catch(e) { 
                   console.error('[V2 REFILL] Unexpected error:', e);
                   return errorResponse(`Refill request failed: ${e.message}`);
                }
            }
            return errorResponse('Order not found or missing provider information');
         }
         
         // Multiple refills response
         const results = [];
         for (const orderNum of refillOrders) {
            const { data: rOrder } = await supabaseAdmin.from('orders')
               .select('id, order_number, provider_order_id, quantity, service:services(public_id, id, provider:providers(*))')
               .eq('order_number', orderNum)
               .eq('user_id', user.id).single();
            
            if (rOrder && rOrder.service && rOrder.service.provider) {
                try {
                   // First, create pending refill record immediately
                   const { error: insertError } = await supabaseAdmin.from('refill_requests').insert({
                       user_id: user.id,
                       order_number: rOrder.order_number,
                       provider_refill_id: null, // Initially null
                       service_id: rOrder.service?.public_id || rOrder.service?.id,
                       quantity: rOrder?.quantity || 0,
                       status: 'pending',
                       refill_requested_at: new Date().toISOString()
                   });
                   
                   if (insertError) {
                       results.push({ order: String(orderNum), refill: { error: 'Database error' } });
                       continue;
                   }
                   
                   // Get the generated refill_id
                   const { data: refillRecord } = await supabaseAdmin
                       .from('refill_requests')
                       .select('refill_id')
                       .eq('order_number', rOrder.order_number)
                       .eq('user_id', user.id)
                       .order('refill_requested_at', { ascending: false })
                       .limit(1)
                       .single();
                   
                   let refillId = refillRecord?.refill_id;
                   
                   // If refill_id is still NULL or provider-like (< 15000), generate our own
                   if (!refillId || refillId < 15000) {
                       const randomIncrement = Math.floor(Math.random() * 5) + 1;
                       refillId = 15090 + randomIncrement;
                   }
                   
                   results.push({ order: String(orderNum), refill: String(rOrder.order_number), status: 'Pending' });
                   
                   // Now try to request from provider (non-blocking)
                   try {
                       const rRes = await axios.post(rOrder.service.provider.api_url, new URLSearchParams({ key: rOrder.service.provider.api_key, action: 'refill', order: rOrder.provider_order_id }), { timeout: 10000 });
                       if (rRes.data.refill) {
                           const providerStatus = rRes.data?.status || null;
                           
                           // Map provider status to our database status
                           const statusMap = {
                               'Pending': 'pending',
                               'In Progress': 'in progress',
                               'Completed': 'completed',
                               'Rejected': 'rejected'
                           };
                           const dbStatus = providerStatus ? statusMap[providerStatus] || 'pending' : 'pending';
                           
                           // Update with provider refill ID and status
                           await supabaseAdmin
                               .from('refill_requests')
                               .update({ provider_refill_id: String(rRes.data.refill), status: dbStatus })
                               .eq('refill_id', refillId);
                       }
                   } catch(providerError) { 
                       console.warn('[V2 REFILL] Provider request failed for order', orderNum, ':', providerError.message);
                       // Continue - refill is already pending
                   }
                } catch(e) { 
                   results.push({ order: String(orderNum), refill: { error: 'Refill request error' } });
                }
            } else {
                results.push({ order: String(orderNum), refill: { error: 'Incorrect order ID' } });
            }
         }
         return { statusCode: 200, headers, body: JSON.stringify(results) };

      case 'refill_status':
         // Support both single (refill) and multiple (refills) status checks
         // Note: refill parameter now contains order_number (per Perfect Panel API spec)
         const statusRefills = params.refills ? String(params.refills).split(',').map(r => r.trim()) : (params.refill ? [String(params.refill).trim()] : []);
         if (statusRefills.length === 0) return errorResponse('Missing order ID(s)');
         
         // Single refill status response
         if (statusRefills.length === 1) {
            const refillId = statusRefills[0];
            console.log('[V2 REFILL_STATUS] Query:', { refillId, refillIdInt: parseInt(refillId) });
            const { data: rs, error: statusError } = await supabaseAdmin.from('refill_requests').select('status').eq('refill_id', parseInt(refillId)).single();
            console.log('[V2 REFILL_STATUS] Result:', { rs, statusError });
            if (statusError || !rs) return errorResponse(`Refill not found: ${statusError?.message || 'no data'}`);
            const statusMap = { 'pending': 'Pending', 'completed': 'Completed', 'rejected': 'Rejected', 'in progress': 'In Progress' };
            console.log('[V2 REFILL_STATUS] Status:', { dbStatus: rs.status, mappedStatus: statusMap[rs.status] });
            return { statusCode: 200, headers, body: JSON.stringify({ status: statusMap[rs.status] || 'Pending' }) };
         }
         
         // Multiple refill status response
         const statusResults = [];
         for (const refillId of statusRefills) {
            const { data: rs } = await supabaseAdmin.from('refill_requests').select('status').eq('refill_id', parseInt(refillId)).single();
            if (rs) {
                const statusMap = { 'pending': 'Pending', 'completed': 'Completed', 'rejected': 'Rejected', 'in progress': 'In Progress' };
                statusResults.push({ refill: refillId, status: statusMap[rs.status] || 'Pending' });
            } else {
                statusResults.push({ refill: refillId, status: 'Refill not found' });
            }
         }
         return { statusCode: 200, headers, body: JSON.stringify(statusResults) };

      case 'cancel':
         const { data: cOrder } = await supabaseAdmin.from('orders')
             .select('id, status, charge, original_charge, user_id, order_number')
             .eq('order_number', params.order)
             .eq('user_id', user.id)
             .single();

         if (!cOrder || cOrder.status !== 'pending') return errorResponse('Cancel failed');
         
         // Mark canceled (reseller expects success even if refund processing is async)
         await supabaseAdmin.from('orders').update({ status: 'canceled', customer_status: 'canceled' }).eq('id', cOrder.id);

         // Process refund immediately (cron skips canceled orders). Idempotent by checking existing payment.
         try {
           const { data: existingRefund } = await supabaseAdmin
             .from('payments')
             .select('id')
             .eq('order_id', cOrder.id)
             .eq('user_id', user.id)
             .eq('method', 'refund')
             .limit(1)
             .maybeSingle();

           if (!existingRefund) {
             const refundAmount = Number(((cOrder.original_charge ?? cOrder.charge) || 0));
             if (refundAmount > 0) {
               // Get fresh user balance
               const { data: uData } = await supabaseAdmin
                 .from('users')
                 .select('id, balance')
                 .eq('id', user.id)
                 .single();
               const newBalance = Number((Number(uData?.balance || 0) + refundAmount).toFixed(5));
               const { error: balErr } = await supabaseAdmin
                 .from('users')
                 .update({ balance: newBalance })
                 .eq('id', user.id);
               if (!balErr) {
                 const txid = `refund_${String(cOrder.id).replace(/[^a-z0-9]/gi, '').slice(0,12)}_${Date.now().toString(36)}`;
                 await supabaseAdmin.from('payments').insert({
                   user_id: user.id,
                   order_id: cOrder.id,
                   amount: -Math.abs(Number(refundAmount.toFixed(5))),
                   method: 'refund',
                   status: 'refunded',
                   currency: 'USD',
                   provider: 'internal',
                   txid,
                   memo: `Refund for order ${cOrder.order_number || cOrder.id} (CANCELED via v2)`
                 });
                 await supabaseAdmin.from('orders').update({ refund_applied_at: new Date().toISOString() }).eq('id', cOrder.id);
               }
             }
           }
         } catch (e) {
           console.warn('[V2 CANCEL] Refund processing warning:', e?.message);
         }
         
         const cancelId = parseInt(params.order) || params.order;
         return { statusCode: 200, headers, body: JSON.stringify({ order: cancelId, canceled: true }) };

      default:
        return errorResponse('Invalid action');
    }
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: 'System error', balance: "0.00", currency: "USD" }) };
  }
};