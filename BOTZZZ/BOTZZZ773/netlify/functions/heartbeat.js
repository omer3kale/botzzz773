const { supabaseAdmin } = require('./utils/supabase');

exports.handler = async (event) => {
  const start = Date.now();
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  const checks = {
    database: { healthy: false, latencyMs: null, error: null }
  };

  try {
    const dbStart = Date.now();
    const { error } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      throw error;
    }

    checks.database.healthy = true;
    checks.database.latencyMs = Date.now() - dbStart;
  } catch (error) {
    checks.database.error = error.message;
  }

  const anyFailures = Object.values(checks).some(check => !check.healthy);

  const payload = {
    success: !anyFailures,
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - start,
    source: event.queryStringParameters?.reason || 'unknown',
    checks
  };

  return {
    statusCode: anyFailures ? 503 : 200,
    headers,
    body: JSON.stringify(payload)
  };
};
