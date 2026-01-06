const { supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Helper to verify token and get user
function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('[USER-REFILLS] JWT verification failed:', error.message);
    return null;
  }
}

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
    // Get user from token (JWT verification)
    const authHeader = event.headers.authorization || event.headers.Authorization;
    
    const user = getUserFromToken(authHeader);
    
    if (!user || !user.userId) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const action = event.queryStringParameters?.action || 
                   (event.body ? JSON.parse(event.body).action : null);

    switch (action) {
      case 'list':
        return await listUserRefills(user.userId, headers);
      
      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) };
    }
  } catch (error) {
    console.error('[USER-REFILLS] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};

// List user's refill requests
async function listUserRefills(userId, headers) {
  try {
    // Query refills for the specific user
    const { data: refills, error } = await supabaseAdmin
      .from('refill_requests')
      .select('id, refill_id, provider_refill_id, order_number, service_id, quantity, status, requested_at, processed_at')
      .eq('user_id', userId)
      .order('requested_at', { ascending: false });

    if (error) {
      console.error('[LIST_USER_REFILLS] Query error:', error);
      throw error;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        refills: refills || []
      })
    };
  } catch (error) {
    console.error('[LIST_USER_REFILLS] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
}
