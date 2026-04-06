const { performOrderStatusSync } = require('./orders');
const { sendFailedOrdersAlert } = require('./utils/failed-order-alerts');
const { supabaseAdmin } = require('./utils/supabase');
const axios = require('axios');

// ============= AUTO-RETRY FOR TIMEOUT FAILURES =============
const MAX_AUTO_RETRIES = 3;
// Backoff: 2min, 5min, 15min (in ms)
const RETRY_BACKOFF_MS = [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];

function isRateLimitProviderError(message = '') {
  const normalized = String(message || '').toLowerCase();
  return normalized.includes('429')
    || normalized.includes('too many requests')
    || normalized.includes('rate limited')
    || normalized.includes('rate limit')
    || normalized.includes('requests are too fast')
    || normalized.includes('hitting rate limit')
    || normalized.includes('too fast');
}

async function recoverRateLimitedFailedOrders() {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const recovery = { found: 0, recovered: 0 };

  try {
    const { data: failedOrders, error } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, customer_status, provider_status, provider_order_id, provider_error, updated_at')
      .in('status', ['failed', 'error'])
      .not('provider_order_id', 'is', null)
      .gt('updated_at', sixHoursAgo)
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[RATE-LIMIT RECOVERY] Query error:', error.message);
      return recovery;
    }

    const recoverableOrders = (failedOrders || []).filter(order => isRateLimitProviderError(order.provider_error));
    recovery.found = recoverableOrders.length;

    for (const order of recoverableOrders) {
      const nextStatus = order.provider_status === 'pending' ? 'pending' : 'processing';
      const nextCustomerStatus = order.customer_status === 'canceled' ? 'canceled' : 'pending';

      const { error: updateError } = await supabaseAdmin
        .from('orders')
        .update({
          status: nextStatus,
          customer_status: nextCustomerStatus,
          provider_status: nextStatus,
          last_status_sync: null
        })
        .eq('id', order.id);

      if (updateError) {
        console.error(`[RATE-LIMIT RECOVERY] Failed to requeue order ${order.order_number || order.id}:`, updateError.message);
        continue;
      }

      recovery.recovered++;
    }

    if (recovery.recovered > 0) {
      console.log(`[RATE-LIMIT RECOVERY] Re-queued ${recovery.recovered}/${recovery.found} rate-limited failed orders`);
    }
  } catch (err) {
    console.error('[RATE-LIMIT RECOVERY] Fatal error:', err.message);
  }

  return recovery;
}

async function autoRetryTimeoutOrders() {
  const now = new Date();
  const retryResults = { found: 0, retried: 0, succeeded: 0, failed: 0, skipped: 0 };

  try {
    // Find failed orders with timeout error, no provider_order_id (never reached provider),
    // created in the last 1 hour (don't retry very old orders)
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

    const { data: timeoutOrders, error: queryError } = await supabaseAdmin
      .from('orders')
      .select(`
        id, order_number, user_id, service_id, link, quantity, comments,
        overflow_quantity, provider_id, provider_name, provider_error,
        provider_order_id, created_at, updated_at,
        service:services(
          id, provider_service_id, public_id, type, overflow_percent,
          provider:providers(id, name, api_url, api_key, status)
        )
      `)
      .eq('status', 'failed')
      .is('provider_order_id', null)
      .ilike('provider_error', '%timeout%')
      .gt('created_at', oneHourAgo)
      .order('created_at', { ascending: true })
      .limit(10);

    if (queryError) {
      console.error('[AUTO-RETRY] Query error:', queryError.message);
      return retryResults;
    }

    if (!timeoutOrders || timeoutOrders.length === 0) {
      return retryResults;
    }

    retryResults.found = timeoutOrders.length;
    console.log(`[AUTO-RETRY] Found ${timeoutOrders.length} timeout-failed orders to retry`);

    for (const order of timeoutOrders) {
      let effectiveRetryCount = 0;
      try {
        // Get retry count from provider_errors table
        const { data: errorLog } = await supabaseAdmin
          .from('provider_errors')
          .select('id, retry_count, last_retry_at')
          .eq('order_id', order.id)
          .order('error_timestamp', { ascending: false })
          .limit(1)
          .maybeSingle();

        const currentRetryCount = errorLog?.retry_count || 0;

        // Also check provider_error for "Auto-retry #N" pattern if no error log
        effectiveRetryCount = currentRetryCount;
        if (!errorLog && order.provider_error) {
          const retryMatch = order.provider_error.match(/Auto-retry #(\d+)/);
          if (retryMatch) effectiveRetryCount = parseInt(retryMatch[1], 10);
        }

        if (effectiveRetryCount >= MAX_AUTO_RETRIES) {
          console.log(`[AUTO-RETRY] Order ${order.order_number} already retried ${effectiveRetryCount} times, skipping`);
          retryResults.skipped++;
          continue;
        }

        // Check backoff: enough time passed since last retry?
        const backoffMs = RETRY_BACKOFF_MS[effectiveRetryCount] || RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
        const lastAttemptTime = errorLog?.last_retry_at || order.updated_at;
        if (lastAttemptTime) {
          const lastAttempt = new Date(lastAttemptTime);
          const elapsed = now.getTime() - lastAttempt.getTime();
          if (elapsed < backoffMs) {
            console.log(`[AUTO-RETRY] Order ${order.order_number} backoff not met (${Math.round(elapsed / 1000)}s / ${Math.round(backoffMs / 1000)}s)`);
            retryResults.skipped++;
            continue;
          }
        }

        // Validate provider
        const provider = order.service?.provider;
        if (!provider || !provider.api_url || !provider.api_key || provider.status !== 'active') {
          console.log(`[AUTO-RETRY] Order ${order.order_number} - provider not available, skipping`);
          retryResults.skipped++;
          continue;
        }

        const providerServiceId = order.service.provider_service_id || order.service.public_id || order.service.id;
        const providerQty = order.overflow_quantity || order.quantity;

        // Build provider request
        const pParams = new URLSearchParams({
          key: provider.api_key,
          action: 'add',
          service: providerServiceId,
          link: order.link
        });

        const serviceType = String(order.service.type ?? '').trim().toLowerCase();
        if (order.comments && serviceType.includes('custom')) {
          pParams.append('comments', order.comments);
        } else {
          pParams.append('quantity', providerQty);
        }

        console.log(`[AUTO-RETRY] Retrying order ${order.order_number} (attempt ${effectiveRetryCount + 1}/${MAX_AUTO_RETRIES}) via ${provider.name}`);
        retryResults.retried++;

        // Update retry count BEFORE attempting (prevents parallel retries)
        if (errorLog?.id) {
          await supabaseAdmin
            .from('provider_errors')
            .update({ retry_count: effectiveRetryCount + 1, last_retry_at: now.toISOString() })
            .eq('id', errorLog.id);
        }

        // Send to provider with 15s timeout (extra buffer for retry)
        const pRes = await axios.post(provider.api_url, pParams, {
          timeout: 15000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        if (pRes.data && pRes.data.order) {
          // Provider accepted!
          const providerOrderId = pRes.data.order;
          console.log(`[AUTO-RETRY] SUCCESS - Order ${order.order_number} got provider_order_id: ${providerOrderId}`);

          await supabaseAdmin.from('orders').update({
            status: 'pending',
            customer_status: 'pending',
            provider_status: 'pending',
            provider_order_id: providerOrderId,
            provider_error: null,
            failure_source: null,
            failure_code: null,
            failure_context: null,
            last_status_sync: now.toISOString()
          }).eq('id', order.id);

          // Mark provider error as resolved
          if (errorLog?.id) {
            await supabaseAdmin
              .from('provider_errors')
              .update({ resolved: true, resolved_at: now.toISOString() })
              .eq('id', errorLog.id);
          }

          retryResults.succeeded++;
        } else {
          // Provider returned response but no order ID
          const errorMsg = pRes.data?.error || pRes.data?.message || 'Provider did not return order id';
          console.warn(`[AUTO-RETRY] Order ${order.order_number} - provider rejected: ${errorMsg}`);

          await supabaseAdmin.from('orders').update({
            provider_error: `Auto-retry #${effectiveRetryCount + 1}: ${errorMsg}`,
            last_status_sync: now.toISOString()
          }).eq('id', order.id);

          retryResults.failed++;
        }
      } catch (retryErr) {
        const errorMsg = retryErr?.response?.data?.error
          || retryErr?.message
          || 'Retry failed';
        const retryNum = effectiveRetryCount + 1;
        console.warn(`[AUTO-RETRY] Order ${order.order_number} - retry #${retryNum} error: ${errorMsg}`);

        await supabaseAdmin.from('orders').update({
          provider_error: `Auto-retry #${retryNum}: ${errorMsg}`,
          last_status_sync: now.toISOString()
        }).eq('id', order.id).catch(() => {});

        retryResults.failed++;
      }
    }
  } catch (err) {
    console.error('[AUTO-RETRY] Fatal error:', err.message);
  }

  if (retryResults.found > 0) {
    console.log('[AUTO-RETRY] Results:', retryResults);
  }
  return retryResults;
}

exports.handler = async (event = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const runAt = event.headers?.['x-netlify-schedule-run-at'] || new Date().toISOString();
  const qsLimit = event.queryStringParameters && event.queryStringParameters.limit;
  const limit = Number.isFinite(Number(qsLimit)) ? Number(qsLimit) : 200;  // Max 200 to avoid timeout (≈27s processing time safely within 26s limit with buffer)
  const providerFilter = event.queryStringParameters && (event.queryStringParameters.providerId || event.queryStringParameters.provider_id);

  console.log(`[SCHEDULED] Order status sync invoked at ${runAt} with limit ${limit}`);

  try {
    let recoveryResults = { found: 0, recovered: 0 };
    try {
      recoveryResults = await recoverRateLimitedFailedOrders();
    } catch (recoveryErr) {
      console.error('[RATE-LIMIT RECOVERY] Non-critical error:', recoveryErr.message);
    }

    const result = await performOrderStatusSync({ limit, providerId: providerFilter || null });

    // Auto-retry timeout-failed orders BEFORE sending alerts
    // (successful retries won't show up in fail alerts)
    let retryResults = { found: 0, retried: 0, succeeded: 0, failed: 0, skipped: 0 };
    try {
      retryResults = await autoRetryTimeoutOrders();
    } catch (retryErr) {
      console.error('[AUTO-RETRY] Non-critical error:', retryErr.message);
    }

    // After sync + retry completes, check DB for ANY un-alerted failed orders
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
      body: JSON.stringify({ ...result, runAt, alertsSent, autoRetry: retryResults, rateLimitRecovery: recoveryResults })
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
