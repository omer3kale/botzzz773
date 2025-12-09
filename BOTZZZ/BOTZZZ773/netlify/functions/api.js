const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const requestCounts = {};
const RATE_LIMIT = 120;
const RATE_LIMIT_WINDOW = 60000;

function parseQueryString(body) {
  if (!body) return {};
  const params = {};
  body.split('&').forEach(pair => {
    const [key, value] = pair.split('=');
    params[decodeURIComponent(key)] = decodeURIComponent(value || '');
  });
  return params;
}

function checkRateLimit(ip) {
  const now = Date.now();
  if (!requestCounts[ip]) {
    requestCounts[ip] = [];
  }
  requestCounts[ip] = requestCounts[ip].filter(time => now - time < RATE_LIMIT_WINDOW);
  if (requestCounts[ip].length >= RATE_LIMIT) {
    return false;
  }
  requestCounts[ip].push(now);
  return true;
}

async function handleServices() {
  try {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, type, category, rate, min_order, max_order, refill, cancel')
      .eq('status', true)
      .order('id', { ascending: true });

    if (error) {
      console.error('Services fetch error:', error);
      return [];
    }

    return data.map(service => ({
      service: service.id,
      name: service.name,
      type: 'service',
      category: service.category,
      rate: String(service.rate),
      min: String(service.min_order),
      max: String(service.max_order),
      refill: service.refill,
      cancel: service.cancel
    }));
  } catch (err) {
    console.error('Services error:', err);
    return [];
  }
}

exports.handler = async (event) => {
  try {
    const ip = event.headers['client-ip'] || event.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    
    if (!checkRateLimit(ip)) {
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Rate limit exceeded' })
      };
    }

    const body = event.body || '';
    const params = parseQueryString(body);
    const action = params.action || '';

    const services = await handleServices();
    
    return {
      statusCode: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: JSON.stringify(services)
    };
  } catch (error) {
    console.error('API error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
