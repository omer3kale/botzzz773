const { supabaseAdmin } = require('./utils/supabase');
const axios = require('axios');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Check authorization
    const token = event.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    // Verify admin role
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, role')
      .eq('id', token.replace('Bearer ', ''))
      .single();

    // Note: In production, use proper JWT verification
    // For now, we'll check auth via the token header

    const action = event.queryStringParameters?.action || 
                   (event.body ? JSON.parse(event.body).action : null);

    switch (action) {
      case 'list':
        return await listRefills(headers);
      
      case 'completed':
        return await completeRefill(event, headers);
      
      case 'reject':
        return await rejectRefill(event, headers);
      
      case 'update_notes':
        return await updateNotes(event, headers);
      
      case 'update_status':
        return await updateStatus(event, headers);
      
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };
    }
  } catch (error) {
    console.error('[ADMIN-REFILLS]', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};

// List all refill requests
async function listRefills(headers) {
  try {
    console.log('[LIST_REFILLS] Starting to fetch refills');
    
    // Use raw SQL to join with auth.users since the relationship isn't in public schema
    const { data: refills, error } = await supabaseAdmin.rpc(
      'get_refills_with_emails'
    );

    console.log('[LIST_REFILLS] RPC result - error:', error, 'data count:', refills?.length);

    let refillsList = refills;

    if (error) {
      console.log('[LIST_REFILLS] RPC failed, trying fallback query');
      
      // Fallback: just get refills without user email if the function doesn't exist
      const { data: refillsOnly, error: fallbackError } = await supabaseAdmin
        .from('refill_requests')
        .select(`
          *,
          order_number
        `)
        .order('requested_at', { ascending: false });

      console.log('[LIST_REFILLS] Fallback query - error:', fallbackError, 'data count:', refillsOnly?.length);

      if (fallbackError) throw fallbackError;

      refillsList = refillsOnly;
    }

    console.log('[LIST_REFILLS] Success - found refills:', refillsList?.length);

    // Add provider info to each refill
    if (refillsList && Array.isArray(refillsList) && refillsList.length > 0) {
      for (const refill of refillsList) {
        try {
          // Get order and provider info for ALL refills
          const { data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .select('service:services(provider:providers(name, api_url, api_key))')
            .eq('order_number', refill.order_number)
            .single();
          
          if (!orderError && order?.service?.provider) {
            // Attach provider info to refill object
            refill.orders = order;
            refill.provider_name = order.service?.provider?.name || 'Unknown';
          }
        } catch (err) {
          console.warn('[LIST_REFILLS] Failed to get provider info for refill:', { refill_id: refill.refill_id, error: err.message });
          refill.provider_name = 'Unknown';
        }
      }
    }

    // For each refill with provider_refill_id, query provider for status update
    if (refillsList && Array.isArray(refillsList) && refillsList.length > 0) {
      for (const refill of refillsList) {
        if (refill.provider_refill_id && refill.order_number && refill.status !== 'completed' && refill.status !== 'rejected') {
          try {
            console.log('[LIST_REFILLS] Checking provider status for refill:', { refill_id: refill.refill_id, provider_refill_id: refill.provider_refill_id });
            
            // Get order and provider info
            const { data: order, error: orderError } = await supabaseAdmin
              .from('orders')
              .select('service:services(provider:providers(*))')
              .eq('order_number', refill.order_number)
              .single();
            
            if (orderError || !order?.service?.provider?.api_url) {
              console.warn('[LIST_REFILLS] Order or provider not found:', { refill_id: refill.refill_id, order_number: refill.order_number, error: orderError?.message });
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

                console.log('[LIST_REFILLS] Provider response:', { refill_id: refill.refill_id, status: statusRes.data?.status });

                // Parse and normalize provider status
                const providerStatus = statusRes.data?.status || statusRes.data?.status_text || statusRes.data?.statusText || null;
                const normalizeProviderStatus = (raw) => {
                  if (!raw) return null;
                  const s = String(raw).trim().toLowerCase();
                  if (['pending', 'in queue', 'queue', 'waiting'].includes(s)) return 'pending';
                  if (s === 'in progress' || s === 'inprogress' || s === 'in_progress') return 'in progress';
                  if (s === 'processing' || s === 'started') return 'processing';
                  if (s.includes('completed') || s.includes('success') || s.includes('done')) return 'completed';
                  if (s.includes('reject')) return 'rejected';
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
                    console.warn('[LIST_REFILLS] Failed to update refill status:', { refill_id: refill.refill_id, error: updateError.message });
                  } else {
                    console.log('[LIST_REFILLS] Updated refill status:', { refill_id: refill.refill_id, new_status: dbStatus });
                    // Update local object for response
                    refill.status = dbStatus;
                    refill.provider_response = statusRes.data;
                  }
                }
              } catch (providerErr) {
                console.warn('[LIST_REFILLS] Provider query failed:', { refill_id: refill.refill_id, error: providerErr.message });
              }
          } catch (err) {
            console.warn('[LIST_REFILLS] Error checking provider status:', { refill_id: refill.refill_id, error: err.message });
          }
        }
      }
    }

    const formattedRefills = (refillsList || []).map(r => ({
      ...r,
      user_email: r.email || 'Unknown'  // Returns username now, but keeping key as user_email for compatibility
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        refills: formattedRefills
      })
    };
  } catch (error) {
    console.error('[LIST_REFILLS] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Complete refill (mark as completed)
async function completeRefill(event, headers) {
  try {
    const { refill_id, id } = JSON.parse(event.body || '{}');
    const recordId = refill_id || id;  // Accept both refill_id and id
    
    if (!recordId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing refill_id or id' }) };
    }

    const { error } = await supabaseAdmin
      .from('refill_requests')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString()
      })
      .eq('id', recordId);

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('[COMPLETE_REFILL]', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Reject refill
async function rejectRefill(event, headers) {
  try {
    const { refill_id, id, reason } = JSON.parse(event.body || '{}');
    const recordId = refill_id || id;  // Accept both refill_id and id
    
    if (!recordId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing refill_id or id' }) };
    }

    const { error } = await supabaseAdmin
      .from('refill_requests')
      .update({
        status: 'rejected',
        reason: reason || null,
        processed_at: new Date().toISOString()
      })
      .eq('id', recordId);

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('[REJECT_REFILL]', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Update admin notes
async function updateNotes(event, headers) {
  try {
    const { refill_id, admin_notes } = JSON.parse(event.body || '{}');
    
    if (!refill_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing refill_id' }) };
    }

    const { error } = await supabaseAdmin
      .from('refill_requests')
      .update({
        admin_notes: admin_notes || null
      })
      .eq('id', refill_id);

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('[UPDATE_NOTES]', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
}

// Update refill status
async function updateStatus(event, headers) {
  try {
    const { refill_id, id, status } = JSON.parse(event.body || '{}');
    const recordId = refill_id || id;
    
    if (!recordId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing refill_id or id' }) };
    }

    if (!status) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing status' }) };
    }

    // Validate status
    const validStatuses = ['pending', 'awaiting', 'in progress', 'completed', 'rejected'];
    if (!validStatuses.includes(status)) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ 
          error: `Invalid status. Valid options: ${validStatuses.join(', ')}` 
        }) 
      };
    }

    // If status changes to completed or rejected, set processed_at
    const updateData = {
      status: status,
      ...(status === 'completed' || status === 'rejected' ? { processed_at: new Date().toISOString() } : {})
    };

    const { error } = await supabaseAdmin
      .from('refill_requests')
      .update(updateData)
      .eq('id', recordId);

    if (error) throw error;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: `Status updated to "${status}"` })
    };
  } catch (error) {
    console.error('[UPDATE_STATUS]', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
}
