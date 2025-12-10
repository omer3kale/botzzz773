// Public API v6 - CANCEL & INSUFFICIENT BALANCE LOG
const { supabaseAdmin } = require('./utils/supabase');

// --- 1. AUTH VE USER ÇEKME ---
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

// --- 3. PARSE ---
function parseRequest(event) {
  let params = {};
  if (event.queryStringParameters) params = { ...event.queryStringParameters };
  if (event.body) {
    try {
      if (event.headers['content-type']?.includes('application/json')) {
        params = { ...params, ...JSON.parse(event.body) };
      } else {
        const searchParams = new URLSearchParams(event.body);
        for (const [key, value] of searchParams) params[key] = value;
      }
    } catch (e) {}
  }
  return params;
}

// --- 4. ANA HANDLER ---
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params = parseRequest(event);
    const action = params.action || 'services';
    const apiKey = params.key;

    // Auth
    let user = null;
    if (apiKey) user = await getUserFromApiKey(apiKey);

    if (action !== 'services' && !user) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Invalid API key' }) };
    }

    switch (action) {
      case 'services':
        const services = await getServices();
        return { statusCode: 200, headers, body: JSON.stringify(services) };

      case 'balance':
        const balanceFormatted = parseFloat(user.balance).toFixed(2);
        return {
          statusCode: 200, 
          headers,
          body: JSON.stringify({ balance: balanceFormatted, currency: 'USD' })
        };

      // --- SİPARİŞ EKLEME (Yetersiz Bakiye Loglama Eklendi) ---
      case 'add':
        const incomingServiceId = params.service;
        const link = params.link;
        const quantity = parseInt(params.quantity);

        if (!incomingServiceId || !link || !quantity) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing parameters' }) };
        }

        const { data: serviceData, error: sErr } = await supabaseAdmin
          .from('services')
          .select('*')
          .eq('public_id', incomingServiceId)
          .single();

        if (sErr || !serviceData) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Service not found' }) };
        }

        // Limit Kontrolü
        const min = parseInt(serviceData.min_quantity || 1);
        const max = parseInt(serviceData.max_quantity || 1000);
        if (quantity < min || quantity > max) {
             return { statusCode: 400, headers, body: JSON.stringify({ error: `Quantity must be between ${min} and ${max}` }) };
        }

        const charge = (parseFloat(serviceData.rate) / 1000) * quantity;

        // --- YETERSİZ BAKİYE KONTROLÜ VE LOGLAMA ---
        if (parseFloat(user.balance) < charge) {
          
          // Veritabanına "Failed" statüsünde kayıt atalım
          await supabaseAdmin
            .from('orders')
            .insert({
              user_id: user.id,
              service_id: serviceData.id,
              service_name: serviceData.name,
              link: link,
              quantity: quantity,
              charge: 0, // Para çekilmedi
              status: 'failed', // Şemanda bu statü vardı
              failure_reason: 'Insufficient Balance', // Hata nedenini kaydet
              mode: 'API',
              provider_currency: 'USD'
            });

          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Not enough balance' }) };
        }

        // Bakiye düş ve Başarılı Sipariş Ekle
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
          return { statusCode: 500, headers, body: JSON.stringify({ error: 'Order creation failed' }) };
        }

        return { statusCode: 200, headers, body: JSON.stringify({ order: newOrder.public_order_id }) };

      // --- DURUM SORGULAMA ---
      case 'status':
        const orderCheckId = params.order;
        if (!orderCheckId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing order ID' }) };

        const { data: orderData } = await supabaseAdmin
          .from('orders')
          .select('status, charge, start_count, remains')
          .eq('public_order_id', orderCheckId)
          .eq('user_id', user.id)
          .single();

        if (!orderData) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };

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

      // --- İPTAL İŞLEMİ (YENİ EKLENDİ) ---
      case 'cancel':
        const orderCancelId = params.order;
        if (!orderCancelId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing order ID' }) };

        // 1. Siparişi Bul
        const { data: cancelOrderData, error: coErr } = await supabaseAdmin
          .from('orders')
          .select('id, status, charge, user_id')
          .eq('public_order_id', orderCancelId)
          .eq('user_id', user.id) // Sadece kendi siparişini iptal edebilir
          .single();

        if (coErr || !cancelOrderData) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
        }

        // 2. Durum Kontrolü (Sadece 'pending' iptal edilebilir)
        if (cancelOrderData.status !== 'pending') {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Order cannot be canceled (Not pending)' }) };
        }

        // 3. İade ve İptal İşlemi
        const refundAmount = parseFloat(cancelOrderData.charge);
        const updatedBalance = parseFloat(user.balance) + refundAmount;

        // A. Bakiyeyi Geri Yükle
        await supabaseAdmin.from('users').update({ balance: updatedBalance }).eq('id', user.id);

        // B. Siparişi İptal Olarak İşaretle
        await supabaseAdmin
            .from('orders')
            .update({ 
                status: 'canceled',
                customer_status: 'canceled', // Şemanda varsa bunu da güncellemek iyidir
                updated_at: new Date().toISOString()
            })
            .eq('id', cancelOrderData.id); // UUID ile güncellemek daha güvenli

        return {
          statusCode: 200, 
          headers, 
          body: JSON.stringify({ 
              order: parseInt(orderCancelId), 
              canceled: true,
              message: 'Order canceled and refunded'
          }) 
        };

      default:
        const defServices = await getServices();
        return { statusCode: 200, headers, body: JSON.stringify(defServices) };
    }

  } catch (err) {
    console.error('API Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'System error' }) };
  }
};