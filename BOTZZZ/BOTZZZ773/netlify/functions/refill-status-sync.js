const { supabaseAdmin } = require('./utils/supabase');
const axios = require('axios');

// Scheduled function: Runs every 60 minutes to sync refill status from providers
exports.handler = async (event) => {
  try {
    console.log('[REFILL_STATUS_SYNC] Starting refill status sync...');
    
    // Get all pending/in progress refills WITH provider_refill_id
    // (Skip manual refills without provider_refill_id - they don't need sync)
    const { data: refills, error } = await supabaseAdmin
      .from('refill_requests')
      .select('refill_id, provider_refill_id, order_number, status')
      .in('status', ['pending', 'in progress'])  // Only pending/in progress
      .not('provider_refill_id', 'is', null);    // ONLY those with provider_refill_id (skip manual ones)

    if (error) {
      console.error('[REFILL_STATUS_SYNC] Error fetching refills:', error.message);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to fetch refills' })
      };
    }

    console.log('[REFILL_STATUS_SYNC] Found refills to check:', refills?.length || 0);

    if (!refills || refills.length === 0) {
      console.log('[REFILL_STATUS_SYNC] No pending refills to sync');
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'No pending refills', synced: 0 })
      };
    }

    let syncedCount = 0;
    let errorCount = 0;

    // Check status for each refill
    for (const refill of refills) {
      try {
        console.log('[REFILL_STATUS_SYNC] Checking refill:', { refill_id: refill.refill_id, provider_refill_id: refill.provider_refill_id });

        // Get order and provider info
        const { data: order, error: orderError } = await supabaseAdmin
          .from('orders')
          .select('service:services(provider:providers(*))')
          .eq('order_number', refill.order_number)
          .single();

        if (orderError || !order?.service?.provider?.api_url) {
          console.warn('[REFILL_STATUS_SYNC] Order or provider not found:', { refill_id: refill.refill_id, error: orderError?.message });
          errorCount++;
          continue;
        }

        const provider = order.service.provider;

        try {
          // Query provider for refill status
          const statusRes = await axios.post(
            provider.api_url,
            new URLSearchParams({
              key: provider.api_key,
              action: 'refill_status',
              refill: refill.provider_refill_id
            }),
            { timeout: 5000 }
          );

          console.log('[REFILL_STATUS_SYNC] Provider response:', { refill_id: refill.refill_id, provider_status: statusRes.data?.status });

          // Parse and normalize provider status
          const providerStatus = statusRes.data?.status || statusRes.data?.status_text || statusRes.data?.statusText || null;
          
          const normalizeProviderStatus = (raw) => {
            if (!raw) return null;
            const s = String(raw).trim().toLowerCase();
            if (['pending', 'in queue', 'queue', 'waiting'].includes(s)) return 'pending';
            if (s === 'in progress' || s === 'inprogress' || s === 'in_progress') return 'in progress';
            if (s === 'processing' || s === 'started') return 'processing';
            if (s === 'completed' || s === 'success' || s === 'done') return 'completed';
            if (s === 'rejected' || s === 'failed') return 'rejected';
            return null;
          };

          const dbStatus = normalizeProviderStatus(providerStatus);

          // Only update if status changed
          if (dbStatus && dbStatus !== refill.status) {
            const { error: updateError } = await supabaseAdmin
              .from('refill_requests')
              .update({
                provider_response: statusRes.data,
                status: dbStatus,
                updated_at: new Date().toISOString()
              })
              .eq('refill_id', refill.refill_id);

            if (updateError) {
              console.warn('[REFILL_STATUS_SYNC] Failed to update refill:', { refill_id: refill.refill_id, error: updateError.message });
              errorCount++;
            } else {
              console.log('[REFILL_STATUS_SYNC] Updated refill status:', { refill_id: refill.refill_id, old_status: refill.status, new_status: dbStatus });
              syncedCount++;
            }
          } else {
            console.log('[REFILL_STATUS_SYNC] No status change for refill:', { refill_id: refill.refill_id, status: refill.status });
          }
        } catch (providerErr) {
          console.warn('[REFILL_STATUS_SYNC] Provider query failed:', { refill_id: refill.refill_id, error: providerErr.message });
          errorCount++;
        }
      } catch (err) {
        console.error('[REFILL_STATUS_SYNC] Error processing refill:', { refill_id: refill.refill_id, error: err.message });
        errorCount++;
      }
    }

    console.log('[REFILL_STATUS_SYNC] Sync complete:', { total: refills.length, synced: syncedCount, errors: errorCount });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Refill status sync complete',
        total: refills.length,
        synced: syncedCount,
        errors: errorCount
      })
    };
  } catch (error) {
    console.error('[REFILL_STATUS_SYNC] Unexpected error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
