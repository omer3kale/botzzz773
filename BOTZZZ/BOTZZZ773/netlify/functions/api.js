// SMM Panel Provider API - Compatible with Goupsocial, Nakrutka, Bigstata format
// Implements standard /api/ endpoint for provider registration
const { supabaseAdmin } = require('./utils/supabase');

async function getServices() {
  try {
    const { data: services, error } = await supabaseAdmin
      .from('services')
      .select('*')
      .eq('status', 'active')
      .order('category', { ascending: true });

    if (error) {
      console.error('[API] Services query error:', error);
      return [];
    }

    if (!Array.isArray(services)) {
      console.error('[API] Services response is not an array');
      return [];
    }

    // Format services exactly like v2
    const formatted = services.map(service => {
      try {
        const rate = parseFloat(service.rate);
        const minQty = parseInt(service.min_quantity || service.min_order || 1, 10);
        const maxQty = parseInt(service.max_quantity || service.max_order || 1000, 10);

        return {
          service: typeof service.id === 'number' ? service.id : parseInt(service.id, 10) || service.id,
          name: String(service.name || 'Unnamed Service').substring(0, 100),
          type: String(service.type || 'Default').substring(0, 50),
          category: String(service.category || 'General').substring(0, 50),
          rate: isNaN(rate) ? '0.00' : rate.toFixed(2),
          min: isNaN(minQty) ? '1' : minQty.toString(),
          max: isNaN(maxQty) ? '1000' : maxQty.toString(),
          refill: service.refill !== false,
          cancel: service.cancel !== false
        };
      } catch (formatError) {
        console.error(`[API] Error formatting service ${service.id}:`, formatError);
        return null;
      }
    }).filter(Boolean);

    console.log(`[API] Formatted services: ${formatted.length}`);

    // Fallback: if empty, proxy to v2 services (ensures provider discovery works)
    if (!formatted.length) {
      try {
        const baseUrl = process.env.URL || 'https://www.botzzz773.pro';
        const resp = await fetch(`${baseUrl}/.netlify/functions/v2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'services' })
        });
        const v2Services = await resp.json();
        console.log(`[API] Fallback to v2 returned ${Array.isArray(v2Services) ? v2Services.length : 'non-array'}`);
        if (Array.isArray(v2Services) && v2Services.length) {
          return v2Services;
        }
      } catch (fallbackErr) {
        console.error('[API] Fallback to v2 failed:', fallbackErr);
      }
    }

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
