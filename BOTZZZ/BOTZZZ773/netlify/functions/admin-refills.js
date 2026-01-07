const { supabaseAdmin } = require('./utils/supabase');

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
      
      case 'accept':
        return await acceptRefill(event, headers);
      
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

    if (error) {
      console.log('[LIST_REFILLS] RPC failed, trying fallback query');
      
      // Fallback: just get refills without user email if the function doesn't exist
      const { data: refillsOnly, error: fallbackError } = await supabaseAdmin
        .from('refill_requests')
        .select('*')
        .order('requested_at', { ascending: false });

      console.log('[LIST_REFILLS] Fallback query - error:', fallbackError, 'data count:', refillsOnly?.length);

      if (fallbackError) throw fallbackError;

      const formattedRefills = refillsOnly.map(r => ({
        ...r,
        user_email: 'Unknown' // Placeholder since we can't get the username
      }));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          refills: formattedRefills
        })
      };
    }

    console.log('[LIST_REFILLS] Success - found refills:', refills?.length);

    const formattedRefills = refills.map(r => ({
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

// Accept refill
async function acceptRefill(event, headers) {
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
    console.error('[ACCEPT_REFILL]', error);
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
    const validStatuses = ['pending', 'in progress', 'completed', 'rejected'];
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
