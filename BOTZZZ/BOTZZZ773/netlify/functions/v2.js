// Public API v2 - Standard SMM Panel API Format
// Supports external integrations using API keys
const { supabaseAdmin } = require('./utils/supabase');
const { hashApiKey, extractKeyPrefix, safeCompareHash } = require('./utils/apiKeys');

// Verify API key and get user
async function getUserFromApiKey(apiKey) {
  if (!apiKey || !apiKey.startsWith('sk_')) {
    return null;
  }

  try {
    const prefix = extractKeyPrefix(apiKey);
    const hashed = hashApiKey(apiKey);

    let candidates = [];

    if (prefix) {
      const { data: prefixMatches, error: prefixError } = await supabaseAdmin
        .from('api_keys')
        .select('id, key_hash, key_prefix, key, user:users(id, email, role, balance, status)')
        .eq('key_prefix', prefix)
        .eq('status', 'active');

      if (prefixError) {
        console.error('API key prefix lookup error:', prefixError);
        return null;
      }

      if (prefixMatches && prefixMatches.length) {
        candidates = prefixMatches;
      }
    }

    if (!candidates.length) {
      const { data: legacyMatches, error: legacyError } = await supabaseAdmin
        .from('api_keys')
        .select('id, key_hash, key_prefix, key, user:users(id, email, role, balance, status)')
        .eq('key', apiKey)
        .eq('status', 'active');

      if (legacyError) {
        console.error('API key legacy lookup error:', legacyError);
        return null;
      }

      if (legacyMatches && legacyMatches.length) {
        candidates = legacyMatches;
      }
    }

    if (!candidates.length) {
      return null;
    }

    let matchingKey = candidates.find(candidate => {
      if (candidate.key_hash && safeCompareHash(hashed, candidate.key_hash)) {
        return true;
      }

      if (candidate.key && candidate.key === apiKey) {
        return true;
      }

      return false;
    });

    if (!matchingKey) {
      const { data: legacyMatches, error: legacyError } = await supabaseAdmin
        .from('api_keys')
        .select('id, key_hash, key_prefix, key, user:users(id, email, role, balance, status)')
        .eq('key', apiKey)
        .eq('status', 'active');

      if (legacyError) {
        console.error('API key legacy fallback error:', legacyError);
        return null;
      }

      if (legacyMatches && legacyMatches.length) {
        matchingKey = legacyMatches.find(candidate => candidate.key === apiKey);

        if (!matchingKey) {
          matchingKey = legacyMatches.find(candidate => candidate.key_hash && safeCompareHash(hashed, candidate.key_hash));
        }
      }
    }

    if (!matchingKey || !matchingKey.user) {
      return null;
    }

    // Update last_used timestamp
    await supabaseAdmin
      .from('api_keys')
      .update({ last_used: new Date().toISOString() })
      .eq('id', matchingKey.id);

    return matchingKey.user;
  } catch (error) {
    console.error('API key verification error:', error);
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { key, action, ...params } = JSON.parse(event.body || '{}');

    // Validate API key
    if (!key) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'API key is required' })
      };
    }

    const user = await getUserFromApiKey(key);
    if (!user) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid API key' })
      };
    }

    if (user.status !== 'active') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Account is not active' })
      };
    }

    // Route to appropriate handler based on action
    switch (action) {
      case 'services':
        return await handleServices(user, headers);
      case 'add':
        return await handleAddOrder(user, params, headers);
      case 'status':
        return await handleOrderStatus(user, params, headers);
      case 'balance':
        return await handleBalance(user, headers);
      case 'refill':
        return await handleRefill(user, params, headers);
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid action. Supported: services, add, status, balance, refill' })
        };
    }
  } catch (error) {
    console.error('API v2 error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

// Get services list
async function handleServices(user, headers) {
  try {
    const { data: services, error } = await supabaseAdmin
      .from('services')
      .select('*')
      .eq('status', 'active')
      .order('category', { ascending: true });

    if (error) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch services' })
      };
    }

    // Format services in standard SMM panel format
    const formattedServices = services.map(service => ({
      service: service.id,
      name: service.name,
      type: service.type || 'Default',
      category: service.category,
      rate: parseFloat(service.rate).toFixed(2),
      min: service.min_quantity.toString(),
      max: service.max_quantity.toString(),
      refill: true,
      cancel: true
    }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(formattedServices)
    };
  } catch (error) {
    console.error('Services error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// Add new order
async function handleAddOrder(user, params, headers) {
  try {
    const { service, link, quantity } = params;

    if (!service || !link || !quantity) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service, link, and quantity are required' })
      };
    }

    // Get service details
    const { data: serviceData, error: serviceError } = await supabaseAdmin
      .from('services')
      .select('*, provider:providers(*)')
      .eq('id', service)
      .single();

    if (serviceError || !serviceData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Service not found' })
      };
    }

    if (serviceData.status !== 'active') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service is not available' })
      };
    }

    // Calculate cost
    const totalCost = (serviceData.rate * quantity).toFixed(2);

    // Check balance
    if (parseFloat(user.balance) < parseFloat(totalCost)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Insufficient balance' })
      };
    }

    // Create order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: user.id,
        service_id: service,
        service_name: serviceData.name,
        link: link,
        quantity: quantity,
        charge: totalCost,
        status: 'pending',
  order_number: `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`
      })
      .select()
      .single();

    if (orderError) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create order' })
      };
    }

    // Deduct balance
    await supabaseAdmin
      .from('users')
      .update({ 
        balance: (parseFloat(user.balance) - parseFloat(totalCost)).toFixed(2)
      })
      .eq('id', user.id);

    // Submit to provider if available
    if (serviceData.provider && serviceData.provider.api_url && serviceData.provider.api_key) {
      try {
        const axios = require('axios');
        const providerParams = new URLSearchParams();
        providerParams.append('key', serviceData.provider.api_key);
        providerParams.append('action', 'add');
        providerParams.append('service', serviceData.provider_service_id);
        providerParams.append('link', link);
        providerParams.append('quantity', quantity);

        const providerResponse = await axios.post(serviceData.provider.api_url, providerParams);
        
        if (providerResponse.data && providerResponse.data.order) {
          await supabaseAdmin
            .from('orders')
            .update({ 
              provider_order_id: providerResponse.data.order,
              status: 'processing'
            })
            .eq('id', order.id);
        }
      } catch (providerError) {
        console.error('Provider submission error:', providerError);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ order: order.id })
    };
  } catch (error) {
    console.error('Add order error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// Get order status
async function handleOrderStatus(user, params, headers) {
  try {
    const { order } = params;

    if (!order) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order ID is required' })
      };
    }

    const { data: orderData, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', order)
      .eq('user_id', user.id)
      .single();

    if (error || !orderData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        charge: orderData.charge,
        start_count: orderData.start_count || '0',
        status: orderData.status.charAt(0).toUpperCase() + orderData.status.slice(1),
        remains: orderData.remains || '0',
        currency: 'USD'
      })
    };
  } catch (error) {
    console.error('Order status error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// Get user balance
async function handleBalance(user, headers) {
  try {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        balance: parseFloat(user.balance).toFixed(2),
        currency: 'USD'
      })
    };
  } catch (error) {
    console.error('Balance error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// Request refill
async function handleRefill(user, params, headers) {
  try {
    const { order } = params;

    if (!order) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order ID is required' })
      };
    }

    const { data: orderData, error } = await supabaseAdmin
      .from('orders')
      .select('*, service:services(*, provider:providers(*))')
      .eq('id', order)
      .eq('user_id', user.id)
      .single();

    if (error || !orderData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    if (!orderData.provider_order_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order cannot be refilled' })
      };
    }

    // Submit refill to provider
    if (orderData.service.provider) {
      const axios = require('axios');
      const providerParams = new URLSearchParams();
      providerParams.append('key', orderData.service.provider.api_key);
      providerParams.append('action', 'refill');
      providerParams.append('order', orderData.provider_order_id);

      const providerResponse = await axios.post(orderData.service.provider.api_url, providerParams);

      if (providerResponse.data && providerResponse.data.refill) {
        await supabaseAdmin
          .from('orders')
          .update({ 
            status: 'refilling',
            refill_id: providerResponse.data.refill
          })
          .eq('id', order);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ refill: providerResponse.data.refill })
        };
      }
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to request refill' })
    };
  } catch (error) {
    console.error('Refill error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
