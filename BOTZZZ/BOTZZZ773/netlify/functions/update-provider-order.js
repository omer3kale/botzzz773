const { supabaseAdmin } = require('./utils/supabase');
const { createLogger } = require('./utils/logger');
const jwt = require('jsonwebtoken');

const logger = createLogger('update-provider-order');
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

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': getCorsOrigin(event),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '{}' };
  }

  try {
    // Verify JWT and admin role
    const user = getUserFromToken(event.headers.authorization);
    if (!user) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }
    if (user.role !== 'admin') {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const { providers } = body;

    if (!Array.isArray(providers) || providers.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid providers array' })
      };
    }

    console.log('[UPDATE-PROVIDER-ORDER] Updating provider order for', providers.length, 'providers');

    // Update each provider's sort_order
    for (const item of providers) {
      const { data, error } = await supabaseAdmin
        .from('providers')
        .update({ sort_order: item.sort_order })
        .eq('id', item.provider_id);
      
      if (error) {
        console.error('[UPDATE-PROVIDER-ORDER] Error updating provider', item.provider_id, error);
        throw error;
      }
    }
    
    logger.info('Provider order updated successfully', { count: providers.length });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        message: 'Provider order updated successfully'
      })
    };
  } catch (error) {
    console.error('[UPDATE-PROVIDER-ORDER] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal server error' })
    };
  }
};
