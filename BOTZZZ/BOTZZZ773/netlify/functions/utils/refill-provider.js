async function resolveProviderForExistingOrder(supabaseAdmin, order, currentProvider, logger = console) {
  let provider = currentProvider || null;

  if (order?.provider_id) {
    const { data: providerData, error } = await supabaseAdmin
      .from('providers')
      .select('id, name, api_url, api_key, status')
      .eq('id', order.provider_id)
      .single();

    if (providerData && !error) {
      if (logger?.info) {
        logger.info('Using order provider snapshot for refill', {
          order_number: order.order_number,
          provider_id: providerData.id,
          provider_name: providerData.name
        });
      }
      return providerData;
    }

    if (error && logger?.warn) {
      logger.warn('Failed to load order.provider_id for refill; falling back', {
        order_number: order.order_number,
        provider_id: order.provider_id,
        error: error.message
      });
    }
  }

  if (order?.provider_order_id && order?.provider_name) {
    const { data: providerData, error } = await supabaseAdmin
      .from('providers')
      .select('id, name, api_url, api_key, status')
      .ilike('name', order.provider_name)
      .single();

    if (providerData && !error) {
      if (logger?.info) {
        logger.info('Using order provider_name snapshot for refill', {
          order_number: order.order_number,
          provider_name: providerData.name
        });
      }
      return providerData;
    }
  }

  if (logger?.warn) {
    logger.warn('Falling back to current service provider for refill', {
      order_number: order?.order_number,
      provider_name: currentProvider?.name || null
    });
  }

  return provider;
}

module.exports = {
  resolveProviderForExistingOrder
};
