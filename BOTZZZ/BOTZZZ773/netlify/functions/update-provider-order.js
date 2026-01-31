const { supabaseAdmin } = require('./utils/supabase');
const { createLogger } = require('./utils/logger');

const logger = createLogger('update-provider-order');

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '{}' };
  }

  try {
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
