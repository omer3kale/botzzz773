// Public API v4 - SCHEMA MATCHED & PUBLIC ID
const { supabaseAdmin } = require('./utils/supabase');

// --- 1. AUTH VE USER ÇEKME ---
async function getUserFromApiKey(apiKey) {
  if (!apiKey) return null;
  try {
    // Önce Key'i kontrol et
    const { data: keyData, error: keyError } = await supabaseAdmin
      .from('api_keys')
      .select('id, user_id, status')
      .eq('key', apiKey)
      .eq('status', 'active')
      .single();

    if (keyError || !keyData) return null;

    // Sonra User'ı çek
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, balance, status')
      .eq('id', keyData.user_id)
      .eq('status', 'active')
      .single();

    if (userError || !userData) return null;

    // Tarihi güncelle (Promise beklemeden)
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
      // API'da görünecek ID (Public ID öncelikli)
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

    // User Doğrulama
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
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ balance: user.balance.toString(), currency: 'USD' })
        };

      // --- SİPARİŞ EKLEME (GÜNCELLENDİ) ---
      case 'add':
        const incomingServiceId = params.service;
        const link = params.link;
        const quantity = parseInt(params.quantity);

        if (!incomingServiceId || !link || !quantity) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing parameters' }) };
        }

        // 1. Servisi PUBLIC ID ile bul
        const { data: serviceData, error: sErr } = await supabaseAdmin
          .from('services')
          .select('*')
          .eq('public_id', incomingServiceId)
          .single();

        if (sErr || !serviceData) {
          return { statusCode: 404, headers, body: JSON.stringify({ error: 'Service not found' }) };
        }

        // 2. Fiyat ve Limit Kontrolü
        const min = parseInt(serviceData.min_quantity || 1);
        const max = parseInt(serviceData.max_quantity || 1000);
        if (quantity < min || quantity > max) {
             return { statusCode: 400, headers, body: JSON.stringify({ error: `Quantity must be between ${min} and ${max}` }) };
        }

        const charge = (parseFloat(serviceData.rate) / 1000) * quantity;

        if (parseFloat(user.balance) < charge) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Not enough balance' }) };
        }

        // 3. Sipariş Oluşturma (Şemaya Uygun)
        
        // Önce Bakiyeyi düş
        const newBalance = parseFloat(user.balance) - charge;
        await supabaseAdmin.from('users').update({ balance: newBalance }).eq('id', user.id);

        // Sonra Siparişi Ekle
        const { data: newOrder, error: oErr } = await supabaseAdmin
          .from('orders')
          .insert({
            user_id: user.id,            // User UUID
            service_id: serviceData.id,   // Servisin GERÇEK (internal) Integer ID'si
            service_name: serviceData.name, // Şemada ZORUNLU (Not Null)
            link: link,                   // Text
            quantity: quantity,           // Integer
            charge: charge,               // Numeric
            status: 'pending',            // Varsayılan
            mode: 'API',                  // Manuel değil API olduğunu belirtmek için
            // public_order_id: DB Trigger tarafından otomatik oluşturulacak
            // created_at: DB tarafından otomatik oluşturulacak
          })
          .select('public_order_id') // ÖNEMLİ: Trigger'ın ürettiği sayısal ID'yi geri istiyoruz
          .single();

        if (oErr) {
          console.error('Sipariş kayıt hatası:', oErr);
          // Hata durumunda iade işlemi eklenebilir
          return { statusCode: 500, headers, body: JSON.stringify({ error: 'Order creation failed' }) };
        }

        // Perfect Panel'e Sayısal ID dönüyoruz (UUID değil)
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ order: newOrder.public_order_id }) 
        };

      // --- SİPARİŞ DURUMU (GÜNCELLENDİ) ---
      case 'status':
        const orderCheckId = params.order;
        if (!orderCheckId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing order ID' }) };

        // Perfect Panel bize sayısal ID (public_order_id) gönderir
        const { data: orderData } = await supabaseAdmin
          .from('orders')
          .select('status, charge, start_count, remains')
          .eq('public_order_id', orderCheckId) // UUID değil, public_order_id ile ara
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

      default:
        const defServices = await getServices();
        return { statusCode: 200, headers, body: JSON.stringify(defServices) };
    }

  } catch (err) {
    console.error('Critical Server Error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'System error' }) };
  }
};