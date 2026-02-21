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
      const formatServiceType = (rawType) => {
        const normalized = String(rawType ?? '').trim();
        if (!normalized) return 'Default';
        const lowered = normalized.toLowerCase();
        if (lowered === 'default') return 'Default';
        if (lowered.includes('custom')) return 'Custom Comments';
        return normalized
          .replace(/[_-]+/g, ' ')
          .split(' ')
          .filter(Boolean)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      };

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
        type: formatServiceType(s.type), 
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

        const rawComments = params.comments ?? params.comment ?? params.custom_comments ?? params.custom_comment ?? params.customComment;
        const hasCommentsField = rawComments !== undefined && rawComments !== null;
        let normalizedComments = null;
        let commentLines = [];

        if (hasCommentsField) {
          const rawCommentText = String(rawComments).trim();
          if (!rawCommentText) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Comments are required for custom comment orders.' }) };
          }
          commentLines = rawCommentText
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0);
          if (commentLines.length === 0) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Comments are required for custom comment orders.' }) };
          }
          normalizedComments = commentLines.join('\n');
        }

        if (!params.service || !params.link || (!params.quantity && !hasCommentsField)) return errorResponse('Missing parameters');
        
        // Fetch Service & Provider info with nested provider relationship
        const { data: sData } = await supabaseAdmin
          .from('services')
          .select('*, provider:providers(id, name, api_url, api_key)')
          .eq('public_id', params.service)
          .single();
        if (!sData) return errorResponse('Service not found');

        const serviceTypeRaw = String(sData.type ?? '').trim().toLowerCase();
        const isCustomCommentsService = serviceTypeRaw.includes('custom');
        if (isCustomCommentsService && !hasCommentsField) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Comments are required for this service.' }) };
        }
        
        // DEBUG: Log full service data to understand provider structure
        console.log('[V2] Service full data:', JSON.stringify({
          id: sData.id,
          provider_id: sData.provider_id,
          provider: sData.provider,
          provider_name: sData.provider_name
        }));

        // Quantity Check
        const qty = hasCommentsField ? commentLines.length : parseInt(params.quantity);
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

        // Deduct Balance - ATOMIC: prevents race condition when multiple orders arrive simultaneously
        const { data: deductResult, error: deductError } = await supabaseAdmin.rpc('deduct_balance', {
          p_user_id: user.id,
          p_amount: charge
        });

        if (deductError) {
          console.error('[V2 ADD] Atomic balance deduction failed:', deductError.message);
          if (deductError.message?.includes('INSUFFICIENT_BALANCE')) {
            await auditLog(user.id, 'no_balance_atomic', { charge, balance: user.balance }, 'warning');
            return errorResponse('Not enough balance');
          }
          await auditLog(user.id, 'balance_deduct_error', { charge, error: deductError.message }, 'error');
          return errorResponse('Payment processing failed. Please try again.');
        }

        let balanceDeducted = true;
        console.log(`[V2 ADD] Balance deducted atomically: new_balance=${deductResult}`);
        
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
          // Get provider info from service provider_id
          let providerIdForOrder = sData.provider_id || null;
          let providerNameForOrder = null;
          
          // Fetch provider name from provider_id
          if (providerIdForOrder) {
            try {
              const { data: providerData } = await supabaseAdmin
                .from('providers')
                .select('name')
                .eq('id', providerIdForOrder)
                .single();
              providerNameForOrder = providerData?.name || null;
            } catch (err) {
              // Silently continue without provider_name if fetch fails
            }
          }
          
          const insertResult = await supabaseAdmin.from('orders').insert({
            user_id: user.id, service_id: sData.id, service_name: sData.name, link: params.link, quantity: qty, charge: charge, original_charge: charge,
              order_number: orderNumber, status: 'pending', customer_status: 'pending', mode: 'API', provider_currency: 'USD', external_order_id: idempotencyKey || null,
              provider_id: providerIdForOrder,
              provider_name: providerNameForOrder
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

        if (oErr) {
          // Rollback: refund the deducted balance since order creation failed
          if (balanceDeducted) {
            const { error: rollbackErr } = await supabaseAdmin.rpc('refund_balance', {
              p_user_id: user.id,
              p_amount: charge
            });
            if (rollbackErr) {
              console.error('[V2 CRITICAL] Balance deducted but order failed AND rollback failed:', { userId: user.id, charge, error: rollbackErr.message });
            } else {
              console.log(`[V2 ADD] Balance rolled back after order creation failure`);
            }
          }
          return errorResponse('Order failed');
        }

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
            // Refund the charge atomically
            const { error: dupRefundErr } = await supabaseAdmin.rpc('refund_balance', {
              p_user_id: user.id,
              p_amount: charge
            });
            if (dupRefundErr) {
              console.error('[V2 CRITICAL] Duplicate order refund failed:', { userId: user.id, charge, error: dupRefundErr.message });
            }
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
            if (normalizedComments) {
              pParams.append('comments', normalizedComments);
            }
            console.log('[V2 PROVIDER] Request params:', { service: providerServiceId, link: params.link, quantity: qty, hasComments: !!normalizedComments });
            const pRes = await axios.post(sData.provider.api_url, pParams, { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
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
                const statusRes = await axios.post(sData.provider.api_url, statusParams, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
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
                console.error('[V2 PROVIDER STATUS CHECK FAILED]', {
                  provider: sData.provider.name,
                  providerOrderId: providerOrderId,
                  error: statusErr.message,
                  response: statusErr.response?.data
                });
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

              if (newOrder.provider_id) {
                await supabaseAdmin.from('provider_errors').insert({
                  provider_id: newOrder.provider_id,
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
            if (newOrder.provider_id) {
              await supabaseAdmin.from('provider_errors').insert({
                provider_id: newOrder.provider_id,
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
               .select('order_number, customer_status, customer_status_lock, charge, quantity, start_count, remains')
                .in('order_number', ids)
                .eq('user_id', user.id);

             let res = {};
             if(mOrders) mOrders.forEach(o => {
               const status = o.customer_status_lock === 'admin'
                 ? 'in progress'
                 : (o.customer_status || 'pending');
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
          .select('customer_status, customer_status_lock, charge, quantity, start_count, remains')
            .eq('order_number', params.order)
            .eq('user_id', user.id)
            .single();

         if (!oData) return errorResponse('Order not found');
         {
           const status = oData.customer_status_lock === 'admin'
             ? 'in progress'
             : (oData.customer_status || 'pending');
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
         // Support both single (order/order_id) and multiple (orders) refill requests
         // Handle both 'order' (botzzz773.pro) and 'order_id' (Perfect Panel) parameters
         const refillOrders = params.orders ? String(params.orders).split(',').map(o => o.trim()) : (params.order || params.order_id ? [String(params.order || params.order_id).trim()] : []);
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
                       status: 'pending', // Initially pending
                       api_request: params,
                       api_response: null,
                       refill_requested_at: new Date().toISOString()
                   }).select('refill_id').single();
                   
                   if (insertError) {
                       console.error('[V2 REFILL] Insert error:', JSON.stringify(insertError));
                       return errorResponse(`Database error: ${insertError.message}`);
                   }

                   const refillId = insertData?.refill_id;
                   if (!refillId) {
                       console.error('[V2 REFILL] Missing refill_id after insert');
                       return errorResponse('Database error: missing refill ID');
                   }
                   
                   console.log('[V2 REFILL] Pending refill created, now requesting from provider');
                   
                   
                   const { error: updateError } = await supabaseAdmin.from('orders').update({ refill_id: String(refillId), refill_requested_at: new Date().toISOString() }).eq('id', rOrder.id);
                   
                   if (updateError) {
                       console.error('[V2 REFILL] Order update error:', JSON.stringify(updateError));
                   }
                   
                   // Now try to request refill from provider (non-blocking)
                   // If it fails, the pending refill remains in database for admin review
                   let providerRefillId = null;
                   try {
                       const rRes = await axios.post(rOrder.service.provider.api_url, new URLSearchParams({ key: rOrder.service.provider.api_key, action: 'refill', order: rOrder.provider_order_id }), { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
                       
                       // Log full response for debugging
                       console.log('[V2 REFILL] Provider refill response:', {
                           status: rRes.status,
                           data: JSON.stringify(rRes.data)
                       });
                       
                       // Expected format: { "refill": "123456" }
                       providerRefillId = rRes.data?.refill || null;
                       
                       console.log('[V2 REFILL] Parsed provider response:', {
                           providerOrderId: rOrder.provider_order_id,
                           providerRefillId,
                           rawData: rRes.data
                       });
                       
                       if (providerRefillId) {
                           // Refill action returns only refill ID, status is checked via refill_status later
                           // Initially set status to 'pending'
                           const dbStatus = 'pending';
                           
                           // Update with provider refill ID only
                           // Status will be updated via refill_status sync (scheduled every 10 minutes)
                           const { error: providerUpdateError } = await supabaseAdmin
                               .from('refill_requests')
                               .update({ 
                                   provider_refill_id: String(providerRefillId), 
                                   status: dbStatus,
                                   api_response: rRes.data
                               })
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
                   
                   // Return only refill_id (status is checked via refill_status action)
                   const apiResponseToUser = { refill: String(refillId) };
                   
                   // Save the response we're sending to user
                   await supabaseAdmin
                       .from('refill_requests')
                       .update({ api_response: apiResponseToUser })
                       .eq('refill_id', refillId);
                   
                   return { statusCode: 200, headers, body: JSON.stringify(apiResponseToUser) };
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
                     const { error: insertError, data: insertData } = await supabaseAdmin.from('refill_requests').insert({
                       user_id: user.id,
                       order_number: rOrder.order_number,
                       provider_refill_id: null, // Initially null
                       service_id: rOrder.service?.public_id || rOrder.service?.id,
                       quantity: rOrder?.quantity || 0,
                       status: 'pending',
                       api_request: params,
                       api_response: null,
                       refill_requested_at: new Date().toISOString()
                   }).select('refill_id').single();
                   
                   if (insertError) {
                       results.push({ order: String(orderNum), refill: { error: 'Database error' } });
                       continue;
                   }

                   const refillId = insertData?.refill_id;
                   if (!refillId) {
                       results.push({ order: String(orderNum), refill: { error: 'Missing refill ID' } });
                       continue;
                   }
                   
                   const apiResponseToUser = { order: String(orderNum), refill: String(refillId) };
                   results.push(apiResponseToUser);
                   
                   // Save the response we're sending to user
                   await supabaseAdmin
                       .from('refill_requests')
                       .update({ api_response: apiResponseToUser })
                       .eq('refill_id', refillId);
                   
                   // Now try to request from provider (non-blocking)
                   try {
                       const rRes = await axios.post(rOrder.service.provider.api_url, new URLSearchParams({ key: rOrder.service.provider.api_key, action: 'refill', order: rOrder.provider_order_id }), { timeout: 10000, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
                       
                       // Log full response for debugging provider format
                       console.log('[V2 REFILL BULK] Provider response for order ' + orderNum + ':', {
                           status: rRes.status,
                           data: JSON.stringify(rRes.data)
                       });
                       
                       let providerRefillId = rRes.data?.refill || rRes.data?.refill_id || rRes.data?.refillId || rRes.data?.order || null;
                       const providerStatus = rRes.data?.status || rRes.data?.status_text || rRes.data?.statusText || null;
                       
                       console.log('[V2 REFILL BULK] Parsed response:', {
                           orderNum,
                           providerRefillId,
                           providerStatus,
                           rawData: rRes.data
                       });
                       
                       if (providerRefillId) {
                           // Map provider status to our database status
                           const statusMap = {
                               'Pending': 'pending',
                               'In Progress': 'in progress',
                               'Completed': 'completed',
                               'Rejected': 'rejected'
                           };
                           const dbStatus = providerStatus ? statusMap[providerStatus] || 'pending' : 'pending';
                           
                           // Update with provider refill ID, status, and full response
                           await supabaseAdmin
                               .from('refill_requests')
                               .update({ 
                                   provider_refill_id: String(providerRefillId), 
                                   status: dbStatus,
                                   api_response: rRes.data  // Store full provider response for debugging
                               })
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
         // Also queries provider API to get current status and save response
         const statusRefills = params.refills ? String(params.refills).split(',').map(r => r.trim()) : (params.refill ? [String(params.refill).trim()] : []);
         if (statusRefills.length === 0) return errorResponse('Missing order ID(s)');
         
         // Single refill status response
         if (statusRefills.length === 1) {
            const refillId = statusRefills[0];
            console.log('[V2 REFILL_STATUS] Query:', { refillId, refillIdString: String(refillId) });
            const { data: rs, error: statusError } = await supabaseAdmin
               .from('refill_requests')
               .select('refill_id, status, provider_refill_id, order_number, id')
               .eq('refill_id', String(refillId))
               .single();
            
            console.log('[V2 REFILL_STATUS] Result:', { rs, statusError });
            
            // If refill not found, return Pending status
            if (statusError || !rs) {
               console.warn('[V2 REFILL_STATUS] Refill not found, returning Pending:', statusError?.message);
               return { statusCode: 200, headers, body: JSON.stringify({ status: 'Pending' }) };
            }
            
            // Try to query provider if we have provider_refill_id
            // If NO provider_refill_id, this is a manual refill - return DB status
            if (rs.provider_refill_id && rs.order_number) {
               try {
                  // Get order to find provider info
                  const { data: orderData } = await supabaseAdmin
                     .from('orders')
                     .select('service:services(provider:providers(*))')
                     .eq('order_number', rs.order_number)
                     .eq('user_id', user.id)
                     .single();
                  
                  if (orderData?.service?.provider?.api_url && orderData.service.provider.api_key) {
                     const provider = orderData.service.provider;
                     console.log('[V2 REFILL_STATUS] Querying provider for refill status:', { 
                        refillId: rs.provider_refill_id,
                        providerName: provider.name 
                     });
                     
                     try {
                        const statusRes = await axios.post(
                           provider.api_url,
                           new URLSearchParams({ 
                              key: provider.api_key, 
                              action: 'refill_status', 
                              refill: rs.provider_refill_id 
                           }),
                           { timeout: 5000 }
                        );
                        
                        console.log('[V2 REFILL_STATUS] Provider response:', {
                           status: statusRes.status,
                           data: JSON.stringify(statusRes.data)
                        });
                        
                        // Save provider response to database
                        const providerStatus = statusRes.data?.status || statusRes.data?.status_text || statusRes.data?.statusText || null;
                        const normalizeProviderStatus = (raw) => {
                           if (!raw) return 'pending';
                           const s = String(raw).trim().toLowerCase();
                           if (['pending', 'in queue', 'queue', 'waiting'].includes(s)) return 'pending';
                           if (s === 'in progress' || s === 'inprogress' || s === 'in_progress') return 'in progress';
                           if (s === 'processing' || s === 'started') return 'processing';
                           if (s === 'completed' || s === 'success' || s === 'done') return 'completed';
                           if (s === 'rejected' || s === 'failed') return 'rejected';
                           return 'pending';
                        };
                        
                        const dbStatus = normalizeProviderStatus(providerStatus);
                        
                        // Update database with provider response
                        const { error: updateError } = await supabaseAdmin
                           .from('refill_requests')
                           .update({ 
                              provider_response: statusRes.data,
                              status: dbStatus
                           })
                           .eq('refill_id', rs.refill_id);
                        
                        if (updateError) {
                           console.error('[V2 REFILL_STATUS] Database update failed:', {
                              refillId: rs.id,
                              error: updateError.message,
                              code: updateError.code
                           });
                        }
                        
                        console.log('[V2 REFILL_STATUS] Saved provider response:', { 
                           providerStatus,
                           dbStatus 
                        });
                        
                        // Return standardized status response (not raw provider response)
                        return { statusCode: 200, headers, body: JSON.stringify({ status: statusMap[dbStatus] || 'Awaiting' }) };
                     } catch (providerErr) {
                        console.warn('[V2 REFILL_STATUS] Provider query failed:', providerErr.message);
                        // Fall through to return DB status
                     }
                  }
               } catch (err) {
                  console.warn('[V2 REFILL_STATUS] Could not query provider:', err.message);
                  // Fall through to return DB status
               }
            } else {
               // No provider_refill_id = Manual refill handled by admin
               console.log('[V2 REFILL_STATUS] Manual refill (no provider_refill_id), returning DB status:', rs.status);
            }
            
            // Return status from database (manual refill or provider sync didn't get updated yet)
            const statusMap = { 'pending': 'Pending', 'awaiting': 'Awaiting', 'completed': 'Completed', 'rejected': 'Rejected', 'in progress': 'In Progress' };
            console.log('[V2 REFILL_STATUS] Returning DB status:', { dbStatus: rs.status });
            return { statusCode: 200, headers, body: JSON.stringify({ status: statusMap[rs.status] || 'Awaiting' }) };
         }
         
         // Multiple refill status response
         const statusResults = [];
         for (const refillId of statusRefills) {
            const { data: rs } = await supabaseAdmin
               .from('refill_requests')
               .select('refill_id, status, provider_refill_id, order_number, id')
               .eq('refill_id', String(refillId))
               .single();
            
            if (rs) {
               // Try to query provider for updated status
               if (rs.provider_refill_id && rs.order_number) {
                  try {
                     const { data: orderData } = await supabaseAdmin
                        .from('orders')
                        .select('service:services(provider:providers(*))')
                        .eq('order_number', rs.order_number)
                        .eq('user_id', user.id)
                        .single();
                     
                     if (orderData?.service?.provider?.api_url && orderData.service.provider.api_key) {
                        const provider = orderData.service.provider;
                        const statusRes = await axios.post(
                           provider.api_url,
                           new URLSearchParams({ 
                              key: provider.api_key, 
                              action: 'refill_status', 
                              refill: rs.provider_refill_id 
                           }),
                           { timeout: 5000 }
                        );
                        
                        const providerStatus = statusRes.data?.status || statusRes.data?.status_text || statusRes.data?.statusText || null;
                        const normalizeProviderStatus = (raw) => {
                           if (!raw) return 'pending';
                           const s = String(raw).trim().toLowerCase();
                           if (['pending', 'in queue', 'queue', 'waiting'].includes(s)) return 'pending';
                           if (s === 'in progress' || s === 'inprogress' || s === 'in_progress') return 'in progress';
                           if (s === 'processing' || s === 'started') return 'processing';
                           if (s === 'completed' || s === 'success' || s === 'done') return 'completed';
                           if (s === 'rejected' || s === 'failed') return 'rejected';
                           return 'pending';
                        };
                        
                        const dbStatus = normalizeProviderStatus(providerStatus);
                        
                        // Update database
                        const { error: bulkUpdateError } = await supabaseAdmin
                           .from('refill_requests')
                           .update({ 
                              provider_response: statusRes.data,
                              status: dbStatus
                           })
                           .eq('refill_id', rs.refill_id);
                        
                        if (bulkUpdateError) {
                           console.error('[V2 REFILL_STATUS BULK] Database update failed:', {
                              refillId: rs.id,
                              error: bulkUpdateError.message,
                              code: bulkUpdateError.code
                           });
                        }
                        
                        // Return provider response directly
                        statusResults.push({ refill: refillId, ...statusRes.data });
                     } else {
                        const bulkStatusMap = { 'pending': 'Pending', 'completed': 'Completed', 'rejected': 'Rejected', 'in progress': 'In Progress' };
                        statusResults.push({ refill: refillId, status: bulkStatusMap[rs.status] || 'Pending' });
                     }
                  } catch (err) {
                     console.warn('[V2 REFILL_STATUS] Provider query failed for refill', refillId);
                     const bulkStatusMap = { 'pending': 'Pending', 'completed': 'Completed', 'rejected': 'Rejected', 'in progress': 'In Progress' };
                     statusResults.push({ refill: refillId, status: bulkStatusMap[rs.status] || 'Pending' });
                  }
               } else {
                  statusResults.push({ refill: refillId, status: 'Pending' });
               }
            } else {
                statusResults.push({ refill: refillId, status: 'Pending' });
            }
         }
         return { statusCode: 200, headers, body: JSON.stringify(statusResults) };

      case 'get-sync-rate':
        // Fetch current service rates for rate synchronization
        // Used by API users to auto-update their panel prices
        if (!params.service) return errorResponse('Missing service parameter');
        
        const syncServiceId = String(params.service).trim();
        const { data: syncService } = await supabaseAdmin
          .from('services')
          .select('id, public_id, name, provider_rate, rate, retail_rate, markup_percentage')
          .or(`public_id.eq.${syncServiceId},id.eq.${syncServiceId}`)
          .single();
        
        if (!syncService) return errorResponse('Service not found');
        
        // Return rates for API user to sync with their panel
        return { 
          statusCode: 200, 
          headers, 
          body: JSON.stringify({
            service: syncService.public_id || syncService.id,
            name: syncService.name,
            provider_rate: Number((syncService.provider_rate || 0).toFixed(5)),
            retail_rate: Number((syncService.retail_rate || syncService.rate || 0).toFixed(5)),
            markup_percentage: Number(syncService.markup_percentage || 0).toFixed(2),
            currency: 'USD'
          })
        };

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