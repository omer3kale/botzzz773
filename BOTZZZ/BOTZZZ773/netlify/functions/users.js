// Users API - Get, Update, Delete User Data
const { supabase, supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

// Real-time exchange rates cache
let exchangeRatesCache = null;
let exchangeRatesCacheTime = null;
const EXCHANGE_RATES_CACHE_TTL = 3600000; // 1 hour

// Fetch real-time exchange rates from API
async function fetchExchangeRates() {
  const now = Date.now();
  
  // Return cached rates if still valid
  if (exchangeRatesCache && exchangeRatesCacheTime && (now - exchangeRatesCacheTime < EXCHANGE_RATES_CACHE_TTL)) {
    return exchangeRatesCache;
  }
  
  try {
    const axios = require('axios');
    const response = await axios.get('https://open.er-api.com/v6/latest/USD', {
      timeout: 5000
    });
    
    if (response.data && response.data.rates) {
      exchangeRatesCache = response.data.rates;
      exchangeRatesCacheTime = now;
      console.log('[CURRENCY] Exchange rates updated successfully');
      return exchangeRatesCache;
    }
  } catch (error) {
    console.error('[CURRENCY] Failed to fetch exchange rates:', error.message);
  }
  
  // Fallback to static rates if API fails
  return {
    USD: 1,
    EUR: 1.09,
    GBP: 1.27,
    INR: 0.012,
    TRY: 0.029,
    BRL: 0.20,
    NGN: 0.0007,
    CAD: 0.71,
    AUD: 0.65,
    SGD: 0.74,
    AED: 0.27,
    SAR: 0.27,
    PHP: 0.018,
    RUB: 0.011,
    MXN: 0.050,
    ZAR: 0.055,
    JPY: 0.0068,
    CNY: 0.14
  };
}

// Convert amount from any currency to USD
async function convertToUSD(amount, fromCurrency) {
  const currency = String(fromCurrency || 'USD').toUpperCase().trim();
  
  if (currency === 'USD') {
    return parseFloat(amount) || 0;
  }
  
  const rates = await fetchExchangeRates();
  const rate = rates[currency];
  
  if (!rate) {
    console.warn(`[CURRENCY] Unknown currency ${currency}, treating as USD`);
    return parseFloat(amount) || 0;
  }
  
  // rates are USD-based, so we need to divide by the rate to convert TO USD
  // Example: 100 INR with rate 83.5 (1 USD = 83.5 INR) -> 100/83.5 = 1.20 USD
  return (parseFloat(amount) || 0) / rate;
}

// Helper to verify token and get user
function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  
  const token = authHeader.substring(7);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Verify authentication - normalize header casing
  const authHeader = event.headers.authorization || event.headers.Authorization;
  
  // DEBUG: Log auth attempt
  console.log('[DEBUG] Auth attempt:', {
    hasAuthHeader: !!authHeader,
    headerValue: authHeader ? authHeader.substring(0, 20) + '...' : 'none',
    hasJwtSecret: !!JWT_SECRET,
    jwtSecretLength: JWT_SECRET?.length,
    jwtSecretPrefix: JWT_SECRET?.substring(0, 8) + '...',
    allHeaders: Object.keys(event.headers)
  });
  
  // Extract token
  const tokenString = authHeader ? authHeader.substring(7) : null;
  console.log('[DEBUG] Token extraction:', {
    hasToken: !!tokenString,
    tokenLength: tokenString?.length,
    tokenStart: tokenString?.substring(0, 20) + '...',
    tokenEnd: '...' + tokenString?.substring(tokenString.length - 20),
    tokenHasNewlines: tokenString ? /[\r\n]/.test(tokenString) : false,
    tokenHasSpaces: tokenString ? /\s/.test(tokenString) : false
  });
  
  const user = getUserFromToken(authHeader);
  
  // DEBUG: Log auth result
  console.log('[DEBUG] Auth result:', {
    userFound: !!user,
    userRole: user?.role,
    userEmail: user?.email
  });
  
  // DEBUG: Try to manually decode token without verification to see payload
  if (!user && tokenString) {
    try {
      const decoded = jwt.decode(tokenString);
      console.log('[DEBUG] Token payload (unverified):', decoded);
      
      // Try verification with error details
      try {
        const verified = jwt.verify(tokenString, JWT_SECRET);
        console.log('[DEBUG] Verification succeeded:', verified);
      } catch (verifyError) {
        console.log('[DEBUG] Verification failed:', {
          name: verifyError.name,
          message: verifyError.message
        });
      }
    } catch (e) {
      console.log('[DEBUG] Failed to decode token:', e.message);
    }
  }
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    const bodyData = event.body && event.body.trim() ? JSON.parse(event.body) : {};
    const { action, userId, ...data } = bodyData;

    // Admin-only actions
    const adminActions = ['list', 'create', 'update-any', 'delete'];
    if (adminActions.includes(action) && user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    switch (event.httpMethod) {
      case 'GET':
        return await handleGet(user, headers);
      case 'POST':
        // Handle POST with action parameter
        if (action === 'list') {
          return await handleGet(user, headers);
        }
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action' })
        };
      case 'PUT':
        // Pass userId explicitly to handleUpdate
        return await handleUpdate(user, { ...data, userId: userId || data.userId }, headers);
      case 'DELETE':
        return await handleDelete(user, userId, headers);
      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    console.error('Users API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleGet(user, headers) {
  try {
    // Admin can get all users
    if (user.role === 'admin') {
      const { data: users, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to fetch users' })
        };
      }

      // Fetch all orders in batches (Supabase has 1000 record limit per request)
      let allOrders = [];
      let offset = 0;
      let hasMore = true;
      
      while (hasMore) {
        const { data: batchOrders, error: ordersErr } = await supabaseAdmin
          .from('orders')
          .select('user_id, charge, provider_cost, provider_currency')
          .neq('status', 'canceled') // Exclude only canceled orders
          .range(offset, offset + 999); // Fetch 1000 records at a time
        
        if (ordersErr) {
          console.error('[PROFIT] Orders batch fetch error:', ordersErr);
          break;
        }
        
        if (!batchOrders || batchOrders.length === 0) {
          hasMore = false;
          break;
        }
        
        allOrders = allOrders.concat(batchOrders);
        
        if (batchOrders.length < 1000) {
          hasMore = false; // Less than 1000 means we've reached the end
        }
        
        offset += 1000;
      }

      const spendMap = new Map();
      if (Array.isArray(allOrders)) {
        for (const order of allOrders) {
          const charge = parseFloat(order.charge || 0);
          const providerCost = parseFloat(order.provider_cost || 0);
          const providerCurrency = (order.provider_currency || 'USD').toUpperCase();
          
          // Convert provider_cost to USD if it's in a different currency
          const providerCostUSD = providerCurrency === 'USD' 
            ? providerCost 
            : await convertToUSD(providerCost, providerCurrency);
          
          if (!spendMap.has(order.user_id)) {
            spendMap.set(order.user_id, { spent: 0, profit: 0 });
          }
          
          const agg = spendMap.get(order.user_id);
          agg.spent += charge;
          agg.profit += (charge - providerCostUSD);
          
          if (providerCurrency !== 'USD') {
            console.log(`[PROFIT] Converted provider cost: ${providerCost} ${providerCurrency} → ${providerCostUSD.toFixed(4)} USD`);
          }
        }
      }

      // Remove password hashes and attach spend/profit
      users.forEach(u => {
        delete u.password_hash;
        const agg = spendMap.get(u.id);
        u.spent = agg ? agg.spent : 0;
        u.profit = agg ? agg.profit : 0;
      });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ users })
      };
    }

    // Regular users get their own data
    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.userId)
      .single();

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch user data' })
      };
    }

    delete userData.password_hash;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ user: userData })
    };
  } catch (error) {
    console.error('Get users error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleUpdate(user, data, headers) {
  try {
    const targetUserId = data.userId || user.userId;

    // Users can only update their own data unless admin
    if (targetUserId !== user.userId && user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden' })
      };
    }

    // Don't allow users to change their own role
    if (data.role && targetUserId === user.userId && user.role !== 'admin') {
      delete data.role;
    }

    // Remove sensitive fields
    delete data.password_hash;
    delete data.userId;

    // Handle service_discounts JSONB field
    if (data.service_discounts !== undefined) {
      // Ensure it's valid JSON object
      if (typeof data.service_discounts === 'string') {
        try {
          data.service_discounts = JSON.parse(data.service_discounts);
        } catch (e) {
          console.error('Invalid service_discounts JSON:', e);
          data.service_discounts = {};
        }
      }
      if (!data.service_discounts || typeof data.service_discounts !== 'object') {
        data.service_discounts = {};
      }
    }

    const { data: updatedUser, error } = await supabaseAdmin
      .from('users')
      .update(data)
      .eq('id', targetUserId)
      .select()
      .single();

    if (error) {
      console.error('Update user error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to update user' })
      };
    }

    delete updatedUser.password_hash;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        user: updatedUser
      })
    };
  } catch (error) {
    console.error('Update user error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleDelete(user, targetUserId, headers) {
  try {
    // Only admins can delete users
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    // Can't delete yourself
    if (targetUserId === user.userId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Cannot delete your own account' })
      };
    }

    const { error } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', targetUserId);

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to delete user' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('Delete user error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
