// Public API v2 - FINAL FIX VERSION
const { supabaseAdmin } = require('./utils/supabase');

// --- 1. GARANTİLİ AUTH FONKSİYONU (JOIN YOK, MANUEL SORGULAMA VAR) ---
async function getUserFromApiKey(apiKey) {
  if (!apiKey) return null;

  try {
    // ADIM 1: Sadece api_keys tablosuna bak. İlişki kurmaya çalışma.
    const { data: keyData, error: keyError } = await supabaseAdmin
      .from('api_keys')
      .select('id, user_id, status') // Sadece user_id'yi al
      .eq('key', apiKey)
      .eq('status', 'active') // Key aktif mi?
      .single();

    if (keyError || !keyData) {
      console.warn('[AUTH FAIL] Key api_keys tablosunda bulunamadı:', apiKey);
      return null;
    }

    if (!keyData.user_id) {
      console.warn('[AUTH FAIL] Key bulundu ama user_id boş:', keyData.id);
      return null;
    }

    // ADIM 2: user_id elimizde, şimdi users tablosuna gidip kullanıcıyı alalım.
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, balance, status')
      .eq('id', keyData.user_id)
      .eq('status', 'active') // Kullanıcı aktif mi?
      .single();

    if (userError || !userData) {
      console.warn('[AUTH FAIL] Kullanıcı users tablosunda bulunamadı ID:', keyData.user_id);
      return null;
    }

    // ADIM 3: Son kullanım tarihini güncelle (Arka planda)
    supabaseAdmin
      .from('api_keys')
      .update({ last_used: new Date().toISOString() })
      .eq('id', keyData.id)
      .then(() => {});

    return userData;

  } catch (error) {
    console.error('[System Error] Auth işlemi sırasında hata:', error);
    return null;
  }
}

// --- 2. SERVİSLERİ ÇEKME (ID SORUNUNU ÇÖZEN KISIM) ---
async function getServices() {
  const { data: services, error } = await supabaseAdmin
    .from('services')
    .select('*') // Tüm sütunları çek
    .eq('status', 'active')
    .order('category', { ascending: true });

  if (error) {
    console.error('Servis çekme hatası:', error);
    return [];
  }

  if (!services || !Array.isArray(services)) return [];

  // Perfect Panel formatına çevir
  return services.map(service => {
    try {
      // ID'yi sayıya çevir
      let serviceId = service.id;
      if (typeof serviceId === 'string') {
        serviceId = parseInt(serviceId.replace(/\D/g, ''), 10) || 0; // Sadece sayıları al
      }

      // Fiyat ve limitleri ayarla
      const rate = parseFloat(service.rate);
      const min = parseInt(service.min_quantity || service.min_order || 1, 10);
      const max = parseInt(service.max_quantity || service.max_order || 1000, 10);

      return {
        service: serviceId, // Kesinlikle sayı (Integer)
        name: service.name || 'Service',
        type: service.type || 'Default',
        category: service.category || 'General',
        rate: isNaN(rate) ? '0.00' : rate.toFixed(2),
        min: isNaN(min) ? 1 : min,
        max: isNaN(max) ? 1000 : max,
        refill: service.refill_supported !== false,
        cancel: service.cancel_supported !== false
      };
    } catch (e) {
      return null;
    }
  }).filter(s => s !== null && s.service > 0); // ID'si 0 olanları veya hatalıları temizle
}

// --- 3. REQUEST PARSER (GELEN VERİYİ OKUMA) ---
function parseRequest(event) {
  let params = {};
  
  // 1. GET Parametreleri
  if (event.queryStringParameters) {
    params = { ...event.queryStringParameters };
  }

  // 2. POST Body
  if (event.body) {
    try {
      if (event.headers['content-type']?.includes('application/json')) {
        params = { ...params, ...JSON.parse(event.body) };
      } else {
        // Form-UrlEncoded (Perfect Panel bunu kullanır)
        const searchParams = new URLSearchParams(event.body);
        for (const [key, value] of searchParams) {
          params[key] = value;
        }
      }
    } catch (e) {
      console.error('Body parse hatası:', e);
    }
  }
  return params;
}

// --- 4. ANA HANDLER ---
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params = parseRequest(event);
    const action = params.action || 'services'; // Varsayılan services
    const apiKey = params.key;

    console.log(`[API Hit] Action: ${action} | Key Var mı: ${!!apiKey}`);

    // --- KULLANICI DOĞRULAMA ---
    let user = null;
    if (apiKey) {
      user = await getUserFromApiKey(apiKey);
    }

    // KURAL: Eğer action 'services' ise ve key yoksa/yanlışsa bile servisleri göster (Opsiyonel)
    // Ama eğer action 'balance' veya 'add' ise key zorunlu!
    if (action !== 'services' && !user) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Invalid API key' })
      };
    }

    switch (action) {
      case 'services':
        // Eğer kullanıcı varsa onun özel fiyatlarını göstermek isteyebilirsin (ileride)
        // Şimdilik herkese genel listeyi dönüyoruz.
        const services = await getServices();
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(services)
        };

      case 'balance':
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            balance: user.balance.toString(),
            currency: 'USD' // Sitenizdeki para birimi
          })
        };

      case 'add':
        // Sipariş oluşturma (Basit Örnek)
        // Gerçek sipariş kodlarını buraya entegre edebilirsiniz
        const orderID = Math.floor(Math.random() * 900000) + 100000;
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ order: orderID })
        };

      case 'status':
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ status: 'Pending', currency: 'USD' })
        };

      default:
        // Action boşsa veya saçmaysa servis listesi dön (Perfect Panel için güvenli liman)
        const defServices = await getServices();
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify(defServices)
        };
    }

  } catch (err) {
    console.error('Critical Server Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'System error' })
    };
  }
};