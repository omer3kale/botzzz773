const { performOrderStatusSync } = require('./orders');
const { sendFailedOrdersAlert } = require('./utils/failed-order-alerts');
const { supabaseAdmin } = require('./utils/supabase');

exports.handler = async (event = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const runAt = event.headers?.['x-netlify-schedule-run-at'] || new Date().toISOString();
  const qsLimit = event.queryStringParameters && event.queryStringParameters.limit;
  const limit = Number.isFinite(Number(qsLimit)) ? Number(qsLimit) : 200;  // Max 200 to avoid timeout (≈27s processing time safely within 26s limit with buffer)
  const providerFilter = event.queryStringParameters && (event.queryStringParameters.providerId || event.queryStringParameters.provider_id);

  console.log(`[SCHEDULED] Order status sync invoked at ${runAt} with limit ${limit}`);

  try {
    const result = await performOrderStatusSync({ limit, providerId: providerFilter || null });

    // After sync completes, check DB for ANY un-alerted failed orders (regardless of how they failed)
    let alertsSent = 0;
    try {
      const { data: failedOrders } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, provider_id, provider_order_id, user_id, service_id, status, charge, quantity, provider_notes, provider_response, provider_error, created_at, updated_at, alerted_at')
        .in('status', ['failed', 'error'])
        .is('alerted_at', null)
        .order('created_at', { ascending: false })
        .limit(20);

      if (failedOrders && failedOrders.length > 0) {
        console.log(`[ALERT] Found ${failedOrders.length} un-alerted failed orders in DB`);

        // Enrich with user/service/provider names
        const userIds = [...new Set(failedOrders.map(o => o.user_id).filter(Boolean))];
        const serviceIds = [...new Set(failedOrders.map(o => o.service_id).filter(Boolean))];
        const usersMap = new Map();
        const servicesMap = new Map();
        const providersMap = new Map();

        if (userIds.length > 0) {
          const { data: users } = await supabaseAdmin.from('users').select('id, username').in('id', userIds);
          (users || []).forEach(u => usersMap.set(u.id, u));
        }
        if (serviceIds.length > 0) {
          const { data: services } = await supabaseAdmin.from('services').select('id, name, public_id, provider_id').in('id', serviceIds);
          (services || []).forEach(s => { servicesMap.set(s.id, s); if (s.provider_id) providersMap.set(s.provider_id, null); });
        }
        const providerIds = [...providersMap.keys()];
        if (providerIds.length > 0) {
          const { data: providers } = await supabaseAdmin.from('providers').select('id, name').in('id', providerIds);
          (providers || []).forEach(p => providersMap.set(p.id, p));
        }

        const enrichedOrders = failedOrders.map(order => {
          const user = usersMap.get(order.user_id);
          const service = servicesMap.get(order.service_id);
          const provider = service ? providersMap.get(service.provider_id) : null;
          let failureReason = order.provider_error || order.provider_notes || 'No reason provided';
          if (failureReason === 'No reason provided') {
            try {
              const resp = typeof order.provider_response === 'string' ? JSON.parse(order.provider_response) : order.provider_response;
              if (resp && (resp.error || resp.message || resp.reason)) failureReason = resp.error || resp.message || resp.reason;
            } catch (e) { /* ignore */ }
          }
          return { ...order, username: user?.username || 'N/A', serviceName: service?.name || 'N/A', servicePublicId: service?.public_id || 'N/A', providerName: provider?.name || 'N/A', failureReason };
        });

        await sendFailedOrdersAlert(enrichedOrders);
        alertsSent = enrichedOrders.length;
        console.log(`[ALERT] Failed order alert sent for ${alertsSent} orders`);
      }
    } catch (alertErr) {
      console.error('[ALERT] Failed to send alert (non-critical):', alertErr.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ...result, runAt, alertsSent })
    };
  } catch (error) {
    console.error('[SCHEDULED] Order status sync failed:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Order status sync failed', message: error.message })
    };
  }
};
