// Price Change Logs API
const jwt = require('jsonwebtoken');
const { supabaseAdmin } = require('./utils/supabase');

const JWT_SECRET = process.env.JWT_SECRET;

const ALLOWED_ORIGINS = ['https://www.botzzz773.pro', 'https://botzzz773.pro'];
function getCorsOrigin(event) {
  const origin = event?.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
}

function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.substring(7);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  const user = getUserFromToken(authHeader);
  if (!user || user.role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };
  }

  try {
    const params = event.queryStringParameters || {};
    const page = Math.max(1, parseInt(params.page) || 1);
    const limit = Math.min(parseInt(params.limit) || 50, 200);
    const offset = (page - 1) * limit;
    const providerId = params.provider_id || null;
    const direction = params.direction || null; // 'up' or 'down'

    let query = supabaseAdmin
      .from('price_change_logs')
      .select(`
        *,
        services:service_id (id, name, public_id),
        providers:provider_id (id, name)
      `, { count: 'exact' })
      .order('detected_at', { ascending: false });

    if (providerId) {
      query = query.eq('provider_id', providerId);
    }

    // Apply direction filter at DB level
    if (direction === 'up') {
      query = query.gt('new_provider_rate', 0).filter('new_provider_rate', 'gt', 'old_provider_rate');
    } else if (direction === 'down') {
      query = query.gt('old_provider_rate', 0).filter('new_provider_rate', 'lt', 'old_provider_rate');
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error('[price-change-logs] Query error:', error);
      // Fallback: if column comparison filter fails, do JS-level filtering
      let fallbackQuery = supabaseAdmin
        .from('price_change_logs')
        .select(`
          *,
          services:service_id (id, name, public_id),
          providers:provider_id (id, name)
        `, { count: 'exact' })
        .order('detected_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (providerId) fallbackQuery = fallbackQuery.eq('provider_id', providerId);
      const { data: fbData, error: fbError, count: fbCount } = await fallbackQuery;
      if (fbError) {
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch logs' }) };
      }
      let logs = fbData || [];
      if (direction === 'up') {
        logs = logs.filter(l => parseFloat(l.new_provider_rate) > parseFloat(l.old_provider_rate));
      } else if (direction === 'down') {
        logs = logs.filter(l => parseFloat(l.new_provider_rate) < parseFloat(l.old_provider_rate));
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          logs,
          pagination: { page, limit, total: logs.length, totalPages: Math.ceil(logs.length / limit) }
        })
      };
    }

    const logs = data || [];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        logs,
        pagination: {
          page,
          limit,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / limit)
        }
      })
    };
  } catch (error) {
    console.error('[price-change-logs] Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
