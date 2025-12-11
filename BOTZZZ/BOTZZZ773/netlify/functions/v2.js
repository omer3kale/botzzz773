const { supabaseAdmin } = require('./utils/supabase');
const querystring = require('querystring');
const axios = require('axios');

// --- 0. YARDIMCI FONKSİYONLAR ---
async function auditLog(userId, eventType, details, severity = 'info') {
  const timestamp = new Date().toISOString();
  supabaseAdmin.from('audit_log').insert([{
      user_id: userId || null, event_type: eventType, details: JSON.stringify(details), severity: severity, created_at: timestamp
    }]).then(() => {}).catch(() => {});
}

async function getUserFromApiKey(apiKey) {
  if (!apiKey) return null;
  try {
    const { data: keyData } = await supabaseAdmin.from('api_keys').select('id, user_id, status').eq('key', apiKey.trim()).eq('status', 'active').single();
    if (!keyData) return null;
    const { data: userData } = await supabaseAdmin.from('users').select('id, email, balance, status').eq('id', keyData.user_id).eq('status', 'active').single();
    if (!userData) return null;
    supabaseAdmin.from('api_keys').update({ last_used: new Date().toISOString() }).eq('id', keyData.id).then(() => {});
    return userData;
  } catch (error) { return null; }
}

async function getServices() {
  const { data: services, error } = await supabaseAdmin.from('services').select('*').eq('status', 'active').order('category', { ascending: true });
  if (error || !services) return [];
  return services.map(s => {
    try {
      let exposedId = s.public_id ? s.public_id : s.id;
      let serviceId = parseInt(String(exposedId).replace(/\D/g, ''), 10) || 0;
      return {
        service: serviceId, name: s.name, type: s.type || 'Default', category: s.category || 'General',
        rate: parseFloat(s.rate).toFixed(2), min: parseInt(s.min_quantity || 1), max: parseInt(s.max_quantity || 1000),
        refill: s.refill_supported === true, cancel: s.cancel_supported === true, dripfeed: s.dripfeed_supported === true
      };
    } catch (e) { return null; }
  }).filter(s => s && s.service > 0);
}

// --- 1. PARSER (BRUTE FORCE EKLENDİ) ---
function parseRequest(event) {
  let params = {};
  
  // 1. Standart Yöntemler
  if (event.queryStringParameters) Object.assign(params, event.queryStringParameters);
  
  let bodyString = '';
  if (event.body) {
    bodyString = event.body;
    if (event.isBase64Encoded) bodyString = Buffer.from(bodyString, 'base64').toString('utf-8');
    
    try {
      if (bodyString.startsWith('{')) {
         Object.assign(params, JSON.parse(bodyString));
      } else {
         Object.assign(params, querystring.parse(bodyString));
      }
    } catch (e) {}
  }

  // 2. KURTARMA OPERASYONU (Eğer action hala yoksa Regex ile sök al)
  if (!params.action && bodyString) {
    const actionMatch = bodyString.match(/action=([^&]+)/);
    if (actionMatch) params.action = actionMatch[1];
    
    const keyMatch = bodyString.match(/key=([^&]+)/);
    if (keyMatch) params.key = keyMatch[1];
  }

  // Temizlik
  if (params.key) params.key = String(params.key).trim();
  if (params.action) params.action = String(params.action).trim();
  
  return params;
}

// --- 2. ANA HANDLER ---
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params = parseRequest(event);
    const action = params.action;
    const apiKey = params.key;

    // --- KRİTİK DEĞİŞİKLİK: Her hatada balance dön ---
    const errorResponse = (msg) => {
        return { 
            statusCode: 200, 
            headers, 
            body: JSON.stringify({ error: msg, balance: "0.00", currency: "USD" }) 
        };
    };

    // HTML Docs (Sadece GET ve key yoksa)
    if (!action && !apiKey && event.httpMethod === 'GET') {
       if (!(event.headers['accept'] || '').includes('json')) {
          return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<h1>API v2 Ready</h1>' };
       }
    }

    // 1. ÖZEL DURUM: BALANCE
    if (action === 'balance') {
        const user = await getUserFromApiKey(apiKey);
        if (!user) return errorResponse('Invalid API key'); // Balance: 0.00 döner
        
        const balanceStr = parseFloat(user.balance || 0).toFixed(2);
        return { statusCode: 200, headers, body: JSON.stringify({ balance: balanceStr, funds: balanceStr, currency: 'USD' }) };
    }

    // 2. GENEL AUTH
    let user = null;
    if (apiKey) user = await getUserFromApiKey(apiKey);
    
    // Services hariç user zorunlu
    if ((!action || action !== 'services') && !user) {
        return errorResponse('Invalid API key'); // Balance: 0.00 döner
    }

    // 3. İŞLEMLER
    switch (action || 'services') {
      case 'services':
        const services = await getServices();
        return { statusCode: 200, headers, body: JSON.stringify(services) };

      case 'add':
        // Idempotency
        const idempotencyKey = event.headers['x-idempotency-key'];
        if (idempotencyKey) {
             const { data: existing } = await supabaseAdmin.from('orders').select('public_order_id').eq('external_order_id', idempotencyKey).single();
             if (existing) return { statusCode: 200, headers, body: JSON.stringify({ order: existing.public_order_id }) };
        }

        if (!params.service || !params.link || !params.quantity) return errorResponse('Missing parameters');
        
        const { data: sData } = await supabaseAdmin.from('services').select('*, provider:providers(*)').eq('public_id', params.service).single();
        if (!sData) return errorResponse('Service not found');

        const qty = parseInt(params.quantity);
        if (qty < (sData.min_quantity || 1) || qty > (sData.max_quantity || 1000)) return errorResponse('Quantity error');

        const charge = (parseFloat(sData.rate) / 1000) * qty;
        if (parseFloat(user.balance) < charge) {
            await auditLog(user.id, 'no_balance', { charge }, 'warning');
            return errorResponse('Not enough balance');
        }

        await supabaseAdmin.from('users').update({ balance: parseFloat(user.balance) - charge }).eq('id', user.id);
        
        const { data: newOrder, error: oErr } = await supabaseAdmin.from('orders').insert({
            user_id: user.id, service_id: sData.id, service_name: sData.name, link: params.link, quantity: qty, charge: charge,
            status: 'pending', mode: 'API', provider_currency: 'USD', external_order_id: idempotencyKey || null
        }).select('id, public_order_id').single();

        if (oErr) return errorResponse('Order failed');

        // Forwarding
        if (sData.provider && sData.provider.api_key) {
             try {
                const pParams = new URLSearchParams({ 
                    key: sData.provider.api_key, action: 'add', service: sData.provider_service_id, link: params.link, quantity: qty 
                });
                const pRes = await axios.post(sData.provider.api_url, pParams);
                if (pRes.data && pRes.data.order) {
                    await supabaseAdmin.from('orders').update({ status: 'processing', provider_order_id: pRes.data.order }).eq('id', newOrder.id);
                }
             } catch (e) { await auditLog(user.id, 'provider_fail', { msg: e.message }, 'error'); }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ order: newOrder.public_order_id }) };

      case 'status':
         if (params.orders) {
             // Multi Status
             const ids = params.orders.split(',').map(i=>parseInt(i)).filter(i=>!isNaN(i));
             const { data: mOrders } = await supabaseAdmin.from('orders').select('public_order_id, status, charge, start_count, remains').in('public_order_id', ids).eq('user_id', user.id);
             let res = {};
             if(mOrders) mOrders.forEach(o => res[o.public_order_id] = { status: o.status, charge: o.charge, start_count: o.start_count, remains: o.remains, currency: 'USD' });
             return { statusCode: 200, headers, body: JSON.stringify(res) };
         }
         if (!params.order) return errorResponse('Missing order ID');
         const { data: oData } = await supabaseAdmin.from('orders').select('status, charge, start_count, remains').eq('public_order_id', params.order).eq('user_id', user.id).single();
         if (!oData) return errorResponse('Order not found');
         return { statusCode: 200, headers, body: JSON.stringify({ status: oData.status, charge: oData.charge, start_count: oData.start_count || 0, remains: oData.remains || 0, currency: 'USD' }) };

      case 'refill':
         if (!params.order) return errorResponse('Missing order ID');
         const { data: rOrder } = await supabaseAdmin.from('orders').select('id, provider_order_id, service:services(provider:providers(*))').eq('public_order_id', params.order).eq('user_id', user.id).single();
         if (rOrder && rOrder.service && rOrder.service.provider) {
             try {
                const rRes = await axios.post(rOrder.service.provider.api_url, new URLSearchParams({ key: rOrder.service.provider.api_key, action: 'refill', order: rOrder.provider_order_id }));
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
         const { data: cOrder } = await supabaseAdmin.from('orders').select('id, status, charge').eq('public_order_id', params.order).eq('user_id', user.id).single();
         if (!cOrder || cOrder.status !== 'pending') return errorResponse('Cancel failed');
         await supabaseAdmin.from('users').update({ balance: parseFloat(user.balance) + parseFloat(cOrder.charge) }).eq('id', user.id);
         await supabaseAdmin.from('orders').update({ status: 'canceled' }).eq('id', cOrder.id);
         return { statusCode: 200, headers, body: JSON.stringify({ order: parseInt(params.order), canceled: true }) };

      default:
        // Eğer hiçbir action uymuyorsa bile balance dönüyoruz ki panel hata vermesin.
        return errorResponse('Invalid action');
    }
  } catch (err) {
    return { statusCode: 200, headers, body: JSON.stringify({ error: 'System error', balance: "0.00", currency: "USD" }) };
  }
};