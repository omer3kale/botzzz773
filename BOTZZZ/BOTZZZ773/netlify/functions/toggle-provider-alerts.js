const { supabaseAdmin } = require('./utils/supabase');
const { createLogger, serializeError } = require('./utils/logger');

const logger = createLogger('toggle-provider-alerts');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' };
  
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  try {
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
