const { supabaseAdmin } = require('./utils/supabase');
const { createLogger, serializeError } = require('./utils/logger');
const { syncProviderServices } = require('./sync-service-catalog');
const { performOrderStatusSync } = require('./orders');
const { getPricingEngine } = require('./utils/pricing-engine');

const logger = createLogger('provider-automation');
const DEFAULT_ORDER_SYNC_LIMIT = Number(process.env.PROVIDER_AUTOMATION_ORDER_LIMIT || 75);

function parseLimit(rawValue, fallback) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(Math.trunc(numeric), 500);
}

exports.handler = async (event = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const runAt = event.headers?.['x-netlify-schedule-run-at'] || new Date().toISOString();
  const query = event.queryStringParameters || {};
  const targetProviderId = query.providerId || query.provider_id || null;
  const orderSyncLimit = parseLimit(query.orderLimit || query.order_limit, DEFAULT_ORDER_SYNC_LIMIT);

  logger.info('Provider automation invoked', { runAt, targetProviderId, orderSyncLimit });

  try {
    let providerQuery = supabaseAdmin
      .from('providers')
      .select('id, name, status, api_url, api_key, health_status, services_count, markup')
      .eq('status', 'active');

    if (targetProviderId) {
      providerQuery = providerQuery.eq('id', targetProviderId);
    }

    const { data: providers, error } = await providerQuery;

    if (error) {
      logger.error('Failed to load providers', { error: serializeError(error) });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ success: false, error: 'Failed to load providers' })
      };
    }

    if (!providers || providers.length === 0) {
      logger.info('No providers eligible for automation');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, runAt, summary: [] })
      };
    }

    const summary = [];
    const pricingEngine = await getPricingEngine();

    for (const provider of providers) {
      const entry = {
        providerId: provider.id,
        providerName: provider.name,
        catalog: null,
        orderSync: null
      };

      try {
        logger.info('Syncing provider catalog', { providerId: provider.id, providerName: provider.name });
        const catalogResult = await syncProviderServices(provider, { pricingEngine });
        entry.catalog = { ...catalogResult, success: true };

        logger.info('Queueing provider order sync', { providerId: provider.id, limit: orderSyncLimit });
        const orderResult = await performOrderStatusSync({ providerId: provider.id, limit: orderSyncLimit });
        entry.orderSync = orderResult;

        if (!orderResult.success) {
          logger.warn('Order sync returned errors', { providerId: provider.id, error: orderResult.error });
        }
      } catch (providerError) {
        entry.catalog = entry.catalog || { success: false };
        entry.orderSync = entry.orderSync || { success: false, error: providerError.message };
        logger.error('Provider automation failed', {
          providerId: provider.id,
          error: serializeError(providerError)
        });
      }

      summary.push(entry);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        runAt,
        providersProcessed: summary.length,
        summary
      })
    };
  } catch (error) {
    logger.error('Provider automation fatal error', { error: serializeError(error) });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Provider automation failed',
        details: error.message
      })
    };
  }
};
