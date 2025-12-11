const { supabaseAdmin } = require('./utils/supabase');
const querystring = require('querystring');
const axios = require('axios');

// --- 0. BELLEK TABANLI RATE LIMIT (Code A'dan Alındı) ---
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 dakika
const MAX_REQUESTS_PER_WINDOW = 120; 

function checkRateLimitInMemory(userId) {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  
  if (now > userLimit.resetAt) {
    userLimit.count = 0;
    userLimit.resetAt = now + RATE_LIMIT_WINDOW;
  }
  
  userLimit.count++;
  rateLimitMap.set(userId, userLimit);
  return userLimit.count <= MAX_REQUESTS_PER_WINDOW;
}

// --- 1. AUDIT LOGGING ---
async function auditLog(userId, eventType, details, severity = 'info') {
  const timestamp = new Date().toISOString();
  // Hata yakalama eklendi ki log tutamazsa sistem durmasın
  supabaseAdmin.from('audit_log').insert([{
      user_id: userId || null,
      event_type: eventType,
      details: JSON.stringify(details),
      severity: severity,
      created_at: timestamp
    }]).then(() => {}).catch(e => console.error('Audit Log Error:', e.message));
}

// --- 2. AUTH ---
async function getUserFromApiKey(apiKey) {
  if (!apiKey) return null;
  try {
    const { data: keyData, error: keyError } = await supabaseAdmin
      .from('api_keys')
      .select('id, user_id, status')
      .eq('key', apiKey.trim())
      .eq('status', 'active')
      .single();

    if (keyError || !keyData) return null;

    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, balance, status')
      .eq('id', keyData.user_id)
      .eq('status', 'active')
      .single();

    if (userError || !userData) return null;

    // Async update
    supabaseAdmin.from('api_keys').update({ last_used: new Date().toISOString() }).eq('id', keyData.id).then(() => {});
    return userData;
  } catch (error) { return null; }
}

// --- 3. SERVICES ---
async function getServices() {
  const { data: services, error } = await supabaseAdmin
    .from('services')
    .select('id, public_id, name, type, category, rate, min_quantity, max_quantity, refill_supported, cancel_supported, dripfeed_supported')
    .eq('status', 'active')
    .order('category', { ascending: true });

  if (error || !services) return [];

  return services.map(service => {
    try {
      let exposedId = service.public_id ? service.public_id : service.id;
      let serviceId = parseInt(String(exposedId).replace(/\D/g, ''), 10) || 0;
      const rate = parseFloat(service.rate);
      return {
        service: serviceId,
        name: service.name || 'Service',
        type: service.type || 'Default',
        category: service.category || 'General',
        rate: isNaN(rate) ? '0.00' : rate.toFixed(2),
        min: parseInt(service.min_quantity || 1),
        max: parseInt(service.max_quantity || 1000),
        refill: service.refill_supported === true,
        cancel: service.cancel_supported === true,
        dripfeed: service.dripfeed_supported === true
      };
    } catch (e) { return null; }
  }).filter(s => s && s.service > 0);
}

// --- 4. PARSER ---
function parseRequest(event) {
  let params = {};
  if (event.queryStringParameters) Object.assign(params, event.queryStringParameters);
  if (event.body) {
    let body = event.body;
    if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf-8');
    try {
      const jsonBody = JSON.parse(body);
      Object.assign(params, jsonBody);
    } catch (e) {
      try {
        const formData = querystring.parse(body);
        Object.assign(params, formData);
      } catch (e2) {}
    }
  }
  if (params.key) params.key = String(params.key).trim();
  if (params.action) params.action = String(params.action).trim();
  return params;
}

// --- 5. FULL HTML DOCS (Code A Tasarımı) ---
const HTML_DOCS = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>API v2 - SMM Panel Integration</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif; background: #0a0a0a; color: #e2e8f0; line-height: 1.6; }
        .container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
        h1 { background: linear-gradient(135deg, #ff1494 0%, #00ff7f 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-size: 2.5em; margin-bottom: 10px; }
        h2 { color: #ff1494; margin-top: 40px; margin-bottom: 15px; font-size: 1.5em; }
        h3 { color: #00ff7f; margin-top: 25px; margin-bottom: 10px; font-size: 1.2em; }
        p { margin-bottom: 15px; color: #94a3b8; }
        code { background: rgba(255, 20, 148, 0.15); padding: 3px 8px; border-radius: 4px; color: #00ff7f; font-family: 'Courier New', monospace; font-size: 0.9em; }
        pre { background: #1a1a1a; border: 1px solid rgba(255, 20, 148, 0.3); border-radius: 8px; padding: 20px; margin: 20px 0; overflow-x: auto; }
        .endpoint { background: rgba(0, 255, 127, 0.1); border-left: 4px solid #00ff7f; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
        th { background: rgba(255, 20, 148, 0.1); color: #ff1494; font-weight: 600; }
        td { color: #94a3b8; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 BOTZZZ API v2</h1>
        <p>Standard SMM Panel API - Compatible with all major platforms.</p>
        <div class="endpoint">
            <strong>Endpoint:</strong> <code>POST /api</code>
        </div>
        <h2>🎯 Example Requests</h2>
        <h3>Check Balance</h3>
        <pre><code>key=YOUR_API_KEY&action=balance</code></pre>
        <h3>Add Order</h3>
        <pre><code>key=YOUR_API_KEY&action=add&service=1&link=example.com&quantity=1000</code></pre>
        <h3>Order Status</h3>
        <pre><code>key=YOUR_API_KEY&action=status&order=12345</code></pre>
        <h3>Multi Status</h3>
        <pre><code>key=YOUR_API_KEY&action=status&orders=123,456,789</code></pre>
    </div>
</body>
</html>`;

// --- 6. HANDLER ---
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params = parseRequest(event);
    const action = params.action;
    const apiKey = params.key;

    // A. HTML DOKÜMANTASYON (Tam Tasarım)
    if (!action && !apiKey && event.httpMethod === 'GET') {
        const accept = event.headers['accept'] || event.headers['Accept'] || '';
        if (!accept.includes('json')) {
            return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: HTML_DOCS };
        }
    }

    // B. BAKİYE ÖZEL KONTROL
    if (action === 'balance') {
        const user = await getUserFromApiKey(apiKey);
        if (!user) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Invalid API key', balance: "0.00", currency: "USD" }) };
        const balanceStr = parseFloat(user.balance || 0).toFixed(2);
        return { statusCode: 200, headers, body: JSON.stringify({ balance: balanceStr, funds: balanceStr, currency: 'USD' }) };
    }

    // C. GENEL AUTH VE USER
    let user = null;
    if (apiKey) user = await getUserFromApiKey(apiKey);
    
    if ((!action || action !== 'services') && !user) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: 'Invalid API key' }) };
    }

    // D. RATE LIMIT (Code A Özelliği - IN MEMORY)
    // Önce hızlı bellek kontrolü, sonra (isteğe bağlı) DB kontrolü yapılabilir.
    if (user && !checkRateLimitInMemory(user.id)) {
        await auditLog(user.id, 'rate_limit_exceeded', { action }, 'warning');
        return { statusCode: 200, headers, body: JSON.stringify({ error: 'Rate limit exceeded (120/min)' }) };
    }

    switch (action || 'services') {
      case 'services':
        const services = await getServices();
        return { statusCode: 200, headers, body: JSON.stringify(services) };

      case 'add':
        // 1. Idempotency Check
        const idempotencyKey = event.headers['x-idempotency-key'];
        // Not: Eğer şemanda 'idempotency_key' sütunu yoksa 'external_order_id' kullanabilirsin.
        if (idempotencyKey) {
             const { data: existing } = await supabaseAdmin.from('orders')
                .select('public_order_id').eq('external_order_id', idempotencyKey).single();
             if (existing) return { statusCode: 200, headers, body: JSON.stringify({ order: existing.public_order_id }) };
        }

        const incomingServiceId = params.service;
        const link = params.link;
        const quantity = parseInt(params.quantity);

        if (!incomingServiceId || !link || !quantity) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing parameters' }) };

        // 2. Servis ve Provider Çekme
        const { data: serviceData, error: sErr } = await supabaseAdmin
          .from('services')
          .select('*, provider:providers(*)')
          .eq('public_id', incomingServiceId)
          .single();

        if (sErr || !serviceData) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Service not found' }) };

        const min = parseInt(serviceData.min_quantity || 1);
        const max = parseInt(serviceData.max_quantity || 1000);
        if (quantity < min || quantity > max) return { statusCode: 200, headers, body: JSON.stringify({ error: `Quantity error` }) };

        const charge = (parseFloat(serviceData.rate) / 1000) * quantity;
        if (parseFloat(user.balance) < charge) {
            await auditLog(user.id, 'insufficient_balance', { service: incomingServiceId, charge, balance: user.balance }, 'warning');
            return { statusCode: 200, headers, body: JSON.stringify({ error: 'Not enough balance' }) };
        }

        // 3. Sipariş Kaydı
        await supabaseAdmin.from('users').update({ balance: parseFloat(user.balance) - charge }).eq('id', user.id);
        
        const { data: newOrder, error: oErr } = await supabaseAdmin
          .from('orders')
          .insert({
            user_id: user.id,
            service_id: serviceData.id,
            service_name: serviceData.name,
            link: link,
            quantity: quantity,
            charge: charge,
            status: 'pending',
            mode: 'API',
            provider_currency: 'USD',
            external_order_id: idempotencyKey || null // Schema uyuşmazlığı olmasın diye buraya yazıyorum
          })
          .select('id, public_order_id')
          .single();

        if (oErr) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Order failed' }) };

        // 4. PROVIDER FORWARDING (Karşıya İletim)
        if (serviceData.provider && serviceData.provider.api_url && serviceData.provider.api_key) {
            try {
                const providerParams = new URLSearchParams();
                providerParams.append('key', serviceData.provider.api_key);
                providerParams.append('action', 'add');
                providerParams.append('service', serviceData.provider_service_id);
                providerParams.append('link', link);
                providerParams.append('quantity', quantity);

                const pRes = await axios.post(serviceData.provider.api_url, providerParams);
                if (pRes.data && pRes.data.order) {
                    await supabaseAdmin.from('orders').update({
                        status: 'processing',
                        provider_order_id: pRes.data.order,
                        provider_status: 'processing'
                    }).eq('id', newOrder.id);
                } else {
                    await auditLog(user.id, 'provider_error', { order: newOrder.public_order_id, error: pRes.data }, 'error');
                }
            } catch (pErr) {
                await auditLog(user.id, 'provider_connection_fail', { error: pErr.message }, 'error');
            }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ order: newOrder.public_order_id }) };

      // --- STATUS (Multi-Order Desteği Eklendi) ---
      case 'status':
        // Toplu Sorgulama (Code A Özelliği)
        if (params.orders) {
            const orderIds = params.orders.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            const { data: mOrders } = await supabaseAdmin.from('orders')
                .select('public_order_id, status, charge, start_count, remains')
                .in('public_order_id', orderIds)
                .eq('user_id', user.id);
            
            let results = {};
            if (mOrders) {
                mOrders.forEach(o => {
                    results[o.public_order_id] = {
                        status: o.status, charge: o.charge, start_count: o.start_count, remains: o.remains, currency: 'USD'
                    };
                });
            }
            return { statusCode: 200, headers, body: JSON.stringify(results) };
        }

        // Tekli Sorgulama
        if (!params.order) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing order ID' }) };
        const { data: orderData } = await supabaseAdmin.from('orders')
            .select('status, charge, start_count, remains').eq('public_order_id', params.order).eq('user_id', user.id).single();
        if (!orderData) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Order not found' }) };
        return { statusCode: 200, headers, body: JSON.stringify({ status: orderData.status, charge: orderData.charge, start_count: orderData.start_count || 0, remains: orderData.remains || 0, currency: 'USD' }) };

      // --- REFILL ---
      case 'refill':
        if (!params.order) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing order ID' }) };
        const { data: rOrder } = await supabaseAdmin.from('orders')
            .select('id, provider_order_id, service:services(provider:providers(*))').eq('public_order_id', params.order).eq('user_id', user.id).single();

        if (rOrder && rOrder.provider_order_id && rOrder.service && rOrder.service.provider) {
             try {
                const rParams = new URLSearchParams();
                rParams.append('key', rOrder.service.provider.api_key);
                rParams.append('action', 'refill');
                rParams.append('order', rOrder.provider_order_id);
                const rRes = await axios.post(rOrder.service.provider.api_url, rParams);
                if (rRes.data && rRes.data.refill) {
                     await supabaseAdmin.from('orders').update({ refill_id: rRes.data.refill, status: 'refilling' }).eq('id', rOrder.id);
                     return { statusCode: 200, headers, body: JSON.stringify({ refill: rRes.data.refill }) };
                }
             } catch (e) {}
        }
        return { statusCode: 200, headers, body: JSON.stringify({ error: 'Refill failed' }) };

      // --- REFILL STATUS (Multi-Refill Desteği Eklendi) ---
      case 'refill_status':
         if (params.refills) {
             // Toplu Refill Sorgu
             // (Basitlik için boş obje dönüyorum, şemanın refill tablosuna göre düzenlenmeli)
             return { statusCode: 200, headers, body: JSON.stringify({}) };
         }
         if (!params.refill) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing refill ID' }) };
         const { data: rsOrder } = await supabaseAdmin.from('orders').select('status').eq('refill_id', params.refill).eq('user_id', user.id).single();
         if (!rsOrder) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Refill not found' }) };
         return { statusCode: 200, headers, body: JSON.stringify({ status: rsOrder.status === 'failed' ? 'rejected' : 'processing' }) };

      case 'cancel':
         const { data: cOrder } = await supabaseAdmin.from('orders').select('id, status, charge').eq('public_order_id', params.order).eq('user_id', user.id).single();
         if (!cOrder || cOrder.status !== 'pending') return { statusCode: 200, headers, body: JSON.stringify({ error: 'Cancel failed' }) };
         await supabaseAdmin.from('users').update({ balance: parseFloat(user.balance) + parseFloat(cOrder.charge) }).eq('id', user.id);
         await supabaseAdmin.from('orders').update({ status: 'canceled' }).eq('id', cOrder.id);
         return { statusCode: 200, headers, body: JSON.stringify({ order: parseInt(params.order), canceled: true }) };

      default:
        return { statusCode: 200, headers, body: JSON.stringify({ error: 'Invalid action' }) };
    }

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'System error' }) };
  }
};