// SMM Panel Provider API - Compatible with Goupsocial, Nakrutka, Bigstata format
// Implements standard /api/ endpoint for provider registration
const { supabaseAdmin } = require('./utils/supabase');

async function getServices() {
  try {
    const { data, error } = await supabaseAdmin
      .from('services')
      .select('id, name, type, category, rate, min_order, max_order, min_quantity, max_quantity, refill, cancel, status')
      .order('id', { ascending: true });

    if (error) {
      console.error('Services fetch error:', error);
      return [];
    }

    if (!data || !Array.isArray(data)) {
      console.error('Services response is not an array:', typeof data);
      return [];
    }

    // Filter active-like statuses (string "active" or truthy)
    const activeServices = data.filter(service => {
      const status = service.status;
      return status === true || status === 'active' || status === 'Active' || status === 'ACTIVE';
    });

    console.log(`Services found: ${data.length}, active-like: ${activeServices.length}`);

    const formatted = activeServices.map(service => {
      try {
        const min = service.min_order ?? service.min_quantity ?? 1;
        const max = service.max_order ?? service.max_quantity ?? 1000;
        return {
          service: String(service.id),
          name: String(service.name || 'Unnamed').substring(0, 100),
          type: String(service.type || 'Default').substring(0, 50),
          category: String(service.category || 'General').substring(0, 50),
          rate: String(parseFloat(service.rate || 0).toFixed(2)),
          min: String(parseInt(min, 10)),
          max: String(parseInt(max, 10)),
          refill: service.refill !== false,
          cancel: service.cancel !== false
        };
      } catch (e) {
        console.error(`Error formatting service ${service.id}:`, e);
        return null;
      }
    }).filter(s => s !== null);

    console.log(`Formatted: ${formatted.length} services`);
    return formatted;
  } catch (err) {
    console.error('Services error:', err);
    return [];
  }
}

// Parse request body (POST/GET)
function parseRequest(event) {
  let params = {};
  
  // GET parameters
  if (event.queryStringParameters) {
    params = { ...event.queryStringParameters };
  }
  
  // POST body (form-encoded or JSON)
  if (event.body) {
    try {
      // Try JSON first
      if (event.headers['content-type']?.includes('application/json')) {
        params = { ...params, ...JSON.parse(event.body) };
      } else {
        // Form-encoded: action=services&key=xyz
        const pairs = event.body.split('&');
        pairs.forEach(pair => {
          const [key, value] = pair.split('=');
          if (key && value) {
            params[decodeURIComponent(key)] = decodeURIComponent(value);
          }
        });
      }
    } catch (err) {
      console.error('Parse error:', err);
    }
  }
  
  return params;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    const params = parseRequest(event);
    const action = params.action || 'services';
    const apiKey = params.key;

    // Log request for debugging
    console.log(`API request: action=${action}, path=${event.path}, method=${event.httpMethod}`);

    // Handle services action (main endpoint for provider validation)
    if (action === 'services' || !action) {
      const services = await getServices();
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(services)
      };
    }

    // Handle status check (returns success for provider validation)
    if (action === 'status') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'ok', provider: 'botzzz773' })
      };
    }

    // Handle balance check (dummy response for provider compatibility)
    if (action === 'balance') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ balance: '999999', currency: 'USD' })
      };
    }

    // Default: return services list
    const services = await getServices();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(services)
    };
  } catch (error) {
    console.error('API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
