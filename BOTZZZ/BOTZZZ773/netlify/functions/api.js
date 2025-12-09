/**
 * API Gateway Function
 * Handles all API requests from api.botzzz773.pro
 * Routes to appropriate handler based on action parameter
 */

const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Simple in-memory rate limiting
const requestCounts = {};
const RATE_LIMIT = 120; // requests per minute
const RATE_LIMIT_WINDOW = 60000; // 1 minute in ms

// Helper: Parse query string
function parseQueryString(body) {
  if (!body) return {};
  const params = {};
  body.split('&').forEach(pair => {
    const [key, value] = pair.split('=');
    params[decodeURIComponent(key)] = decodeURIComponent(value || '');
  });
  return params;
}

// Helper: Check rate limit
function checkRateLimit(ip) {
  const now = Date.now();
  if (!requestCounts[ip]) {
    requestCounts[ip] = [];
  }
  
  // Remove old requests outside the window
  requestCounts[ip] = requestCounts[ip].filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (requestCounts[ip].length >= RATE_LIMIT) {
    return false;
  }
  
  requestCounts[ip].push(now);
  return true;
}

// Helper: Get services list
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

    // Transform to match SMM panel format
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

// Main handler
exports.handler = async (event, context) => {
  try {
    const ip = event.headers['client-ip'] || event.headers['x-forwarded-for']?.split(',')[0] || 'unknown';
    
    // Check rate limit
    if (!checkRateLimit(ip)) {
      return {
        statusCode: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Rate limit exceeded' })
      };
    }

    let body = event.body || '';
    const params = parseQueryString(body);
    const action = params.action || '';

    // Handle services action (unrestricted)
    if (action === 'services') {
      const services = await handleServices();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(services)
      };
    }

    // Default: return services for api subdomain requests without action
    if (!action) {
      const services = await handleServices();
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(services)
      };
    }

    // Unknown action
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid action' })
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
