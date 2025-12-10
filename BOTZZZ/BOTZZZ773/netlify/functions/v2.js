const { supabaseAdmin } = require('./utils/supabase');

// --- 1. AUTH ---
async function getUserFromApiKey(apiKey) {
  if (!apiKey) return null;
  try {
    const { data: keyData, error: keyError } = await supabaseAdmin
      .from('api_keys')
      .select('id, user_id, status')
      .eq('key', apiKey)
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

    // Last used güncelle (Promise beklemeden)
    supabaseAdmin.from('api_keys').update({ last_used: new Date().toISOString() }).eq('id', keyData.id).then(() => {});

    return userData;
  } catch (error) {
    return null;
  }
}

// --- 2. SERVİSLERİ ÇEKME ---
async function getServices() {
  const { data: services, error } = await supabaseAdmin
    .from('services')
    .select('*')
    .eq('status', 'active')
    .order('category', { ascending: true });

  if (error || !services) return [];

  return services.map(service => {
    try {
      let exposedId = service.public_id ? service.public_id : service.id;
      let serviceId = parseInt(String(exposedId).replace(/\D/g, ''), 10) || 0;

      const rate = parseFloat(service.rate);
      const min = parseInt(service.min_quantity || service.min_order || 1, 10);
      const max = parseInt(service.max_quantity || service.max_order || 1000, 10);

      return {
        service: serviceId,
        name: service.name || 'Service',
        type: service.type || 'Default',
        category: service.category || 'General',
        rate: isNaN(rate) ? '0.00' : rate.toFixed(2),
        min: min,
        max: max,
        refill: service.refill_supported === true,
        cancel: service.cancel_supported === true
      };
    } catch (e) { return null; }
  }).filter(s => s && s.service > 0);
}

// --- 3. PARSE REQUEST (SORUN ÇÖZÜCÜ BÖLÜM) ---
// Perfect Panel'in gönderdiği veriyi her ihtimale karşı okur.
function parseRequest(event) {
  let params = {};

  // A. Query String (URL'den gelenler)
  if (event.queryStringParameters) {
    params = { ...event.queryStringParameters };
  }

  // B. Body (Gövdeden gelenler)
  if (event.body) {
    let body = event.body;

    // Eğer body zaten bir obje ise (bazı platformlar otomatik parse eder)
    if (typeof body === 'object') {
      params = { ...params, ...body };
    } 
    // Eğer body bir string ise (klasik durum)
    else if (typeof body === 'string') {
      try {
        // Önce JSON mu diye dene
        const jsonBody = JSON.parse(body);
        params = { ...params, ...jsonBody };
      } catch (e) {
        // JSON değilse, URL Encoded Form Data'dır (Perfect Panel bunu sever)
        try {
          const searchParams = new URLSearchParams(body);
          for (const [key, value] of searchParams) {
            params[key] = value;
          }
        } catch (e2) {
          console.error('Body parse edilemedi:', body);
        }
      }
    }
  }
  
  // Küçük harf/büyük harf sorunu olmasın diye trim yapalım
  if(params.key) params.key = params.key.trim();
  if(params.action) params.action = params.action.trim();

  return params;
}

// --- 4. ANA HANDLER ---
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params = parseRequest(event);
    const action = params.action || 'services'; // Varsayılan services
    const apiKey = params.key;

    // API Key yoksa direkt hata dön (Services hariç, ama services de public değilse hata dönmeli)
    // Debug için: console.log('Gelen İstek:', JSON.stringify(params));

    let user = null;
    if (apiKey) user = await getUserFromApiKey(apiKey);

    // Services dışındaki her işlem için USER şarttır.
    if (action !== 'services' && !user) {
      // Perfect Panel bazen hatalı key durumunda boş JSON veya özel hata bekler.
      return { 
        statusCode: 200, // 403 yerine 200 dönüp içinde error verelim, panel daha iyi anlar.
        headers, 
        body: JSON.stringify({ error: 'Invalid API key' }) 
      };
    }

    switch (action) {
      case 'services':
        const services = await getServices();
        return { statusCode: 200, headers, body: JSON.stringify(services) };

      // --- BAKİYE (FIX) ---
      case 'balance':
        // Eğer kullanıcı veritabanında varsa ama balance null ise 0 kabul et.
        const rawBalance = user.balance !== null ? user.balance : 0;
        
        // Mutlaka string formatında ve 2 ondalıklı gönder (Örn: "100.00")
        const balanceStr = parseFloat(rawBalance).toFixed(2);
        
        return {
          statusCode: 200, 
          headers,
          body: JSON.stringify({ 
            balance: balanceStr, 
            currency: 'USD' 
          })
        };

      case 'add':
        const incomingServiceId = params.service;
        const link = params.link;
        const quantity = parseInt(params.quantity);

        if (!incomingServiceId || !link || !quantity) {
          return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing parameters' }) };
        }

        const { data: serviceData, error: sErr } = await supabaseAdmin
          .from('services')
          .select('*')
          .eq('public_id', incomingServiceId)
          .single();

        if (sErr || !serviceData) {
          return { statusCode: 200, headers, body: JSON.stringify({ error: 'Service not found' }) };
        }

        const min = parseInt(serviceData.min_quantity || 1);
        const max = parseInt(serviceData.max_quantity || 1000);
        if (quantity < min || quantity > max) {
             return { statusCode: 200, headers, body: JSON.stringify({ error: `Quantity must be between ${min} and ${max}` }) };
        }

        const charge = (parseFloat(serviceData.rate) / 1000) * quantity;

        // Bakiye Kontrol
        if (parseFloat(user.balance) < charge) {
          await supabaseAdmin.from('orders').insert({
              user_id: user.id,
              service_id: serviceData.id,
              service_name: serviceData.name,
              link: link,
              quantity: quantity,
              charge: 0,
              status: 'failed',
              failure_reason: 'Insufficient Balance',
              mode: 'API',
              provider_currency: 'USD'
            });
          return { statusCode: 200, headers, body: JSON.stringify({ error: 'Not enough balance' }) };
        }

        // Sipariş Geç
        const newBalance = parseFloat(user.balance) - charge;
        await supabaseAdmin.from('users').update({ balance: newBalance }).eq('id', user.id);

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
            provider_currency: 'USD'
          })
          .select('public_order_id')
          .single();

        if (oErr) {
          return { statusCode: 200, headers, body: JSON.stringify({ error: 'Order creation failed' }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ order: newOrder.public_order_id }) };

      case 'status':
        const orderCheckId = params.order;
        if (!orderCheckId) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing order ID' }) };

        const { data: orderData } = await supabaseAdmin
          .from('orders')
          .select('status, charge, start_count, remains')
          .eq('public_order_id', orderCheckId)
          .eq('user_id', user.id)
          .single();

        if (!orderData) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Order not found' }) };

        return {
          statusCode: 200, headers,
          body: JSON.stringify({
            status: orderData.status,
            charge: orderData.charge,
            start_count: orderData.start_count || 0,
            remains: orderData.remains || 0,
            currency: 'USD'
          })
        };

      case 'cancel':
        const orderCancelId = params.order;
        if (!orderCancelId) return { statusCode: 200, headers, body: JSON.stringify({ error: 'Missing order ID' }) };

        const { data: cancelOrderData } = await supabaseAdmin
          .from('orders')
          .select('id, status, charge, user_id')
          .eq('public_order_id', orderCancelId)
          .eq('user_id', user.id)
          .single();

        if (!cancelOrderData || cancelOrderData.status !== 'pending') {
          return { statusCode: 200, headers, body: JSON.stringify({ error: 'Cancel failed' }) };
        }

        const refundAmount = parseFloat(cancelOrderData.charge);
        await supabaseAdmin.from('users').update({ balance: parseFloat(user.balance) + refundAmount }).eq('id', user.id);
        await supabaseAdmin.from('orders').update({ status: 'canceled', customer_status: 'canceled' }).eq('id', cancelOrderData.id);

        return { statusCode: 200, headers, body: JSON.stringify({ order: parseInt(orderCancelId), canceled: true }) };

      default:
        const defServices = await getServices();
        return { statusCode: 200, headers, body: JSON.stringify(defServices) };
    }

  } catch (err) {
    // 500 hatası panelde "System Error" olarak görünür.
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'System error' }) };
  }
};