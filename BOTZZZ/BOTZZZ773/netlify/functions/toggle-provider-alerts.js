const { supabaseAdmin } = require('./utils/supabase');
const { createLogger, serializeError } = require('./utils/logger');
const jwt = require('jsonwebtoken');

const logger = createLogger('toggle-provider-alerts');
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
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': getCorsOrigin(event),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
    // Verify JWT and admin role
    const user = getUserFromToken(event.headers.authorization);
    if (!user) {
      return { statusCode: 401, headers, body: JSON.stringify({ success: false, error: 'Unauthorized' }) };
    }
    if (user.role !== 'admin') {
      return { statusCode: 403, headers, body: JSON.stringify({ success: false, error: 'Forbidden' }) };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch (e) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'Invalid JSON body' })
      };
    }

    const { providerId, enabled } = body;

    if (!providerId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'providerId is required' })
      };
    }

    if (typeof enabled !== 'boolean') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ success: false, error: 'enabled must be boolean' })
      };
    }

    // Update provider
    const { data, error } = await supabaseAdmin
      .from('providers')
      .update({ low_balance_alerts_enabled: enabled })
      .eq('id', providerId)
      .select();

    if (error) {
      logger.error('Failed to update provider alerts setting', {
        providerId,
        enabled,
        error: serializeError(error)
      });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Failed to update provider' })
      };
    }

    logger.info('Provider alert toggle updated', {
      providerId,
      enabled,
      provider: data?.[0]?.name || 'unknown'
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Alerts ${enabled ? 'enabled' : 'disabled'} for provider`,
        data: data?.[0] || {}
      })
    };
  } catch (error) {
    logger.error('Provider alert toggle error', { error: serializeError(error) });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: 'Internal server error' })
    };
  }
};
