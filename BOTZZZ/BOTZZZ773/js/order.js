// Orders API - Create, Get, Update, Cancel Orders
const { supabase, supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const JWT_SECRET = process.env.JWT_SECRET;

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
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Public services endpoint (no JWT required) -> GET ?type=services_public
  if (event.httpMethod === 'GET' && event.queryStringParameters && event.queryStringParameters.type === 'services_public') {
    return await handleGetPublicServices(headers);
  }

  const user = getUserFromToken(event.headers.authorization);
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ 
        error: 'Unauthorized - You must be signed in to place orders. Please sign in or create an account.' 
      })
    };
  }

  // Verify user has valid userId and email
  if (!user.userId || !user.email) {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ 
        error: 'Access denied - Invalid user credentials. Please sign in again.' 
      })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    switch (event.httpMethod) {
      case 'GET':
        return await handleGetOrders(user, headers);
      case 'POST':
        return await handleCreateOrder(user, body, headers);
      case 'PUT':
        return await handleUpdateOrder(user, body, headers);
      case 'DELETE':
        return await handleCancelOrder(user, body, headers);
      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    console.error('Orders API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleGetOrders(user, headers) {
  try {
    // Get pagination params
    const limit = 100; // Default limit
    const offset = 0;  // Can be made dynamic from query params
    
    let query = supabaseAdmin
      .from('orders')
      .select(`
        *,
        user:users(id, email, username),
        service:services(id, name, category, rate)
      `)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Non-admins can only see their own orders
    if (user.role !== 'admin') {
      query = query.eq('user_id', user.userId);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('Get orders error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch orders' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ orders })
    };
  } catch (error) {
    console.error('Get orders error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleCreateOrder(user, data, headers) {
  try {
    const { serviceId, quantity, link } = data;

    if (!serviceId || !quantity || !link) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service ID, quantity, and link are required' })
      };
    }

    // Validate quantity
    if (quantity <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Quantity must be greater than 0' })
      };
    }

    if (quantity > 1000000) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Quantity exceeds maximum limit' })
      };
    }

    // Get service details (use admin client so provider fields like api_key are available)
    const { data: service, error: serviceError } = await supabaseAdmin
      .from('services')
      .select('*, provider:providers(*)')
      .eq('id', serviceId)
      .single();

    if (serviceError || !service) {
      console.error('Service fetch error:', serviceError);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Service not found' })
      };
    }

    if (service.status !== 'active') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service is not available' })
      };
    }

    // Calculate total cost (rate is per 1000 units)
    const totalCost = ((service.rate * quantity) / 1000).toFixed(2);

    // Check user balance
    const { data: userData, error: userDataError } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', user.userId)
      .single();

    if (userDataError || !userData) {
      console.error('User fetch error:', userDataError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to verify user balance' })
      };
    }

    if (parseFloat(userData.balance) < parseFloat(totalCost)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Insufficient balance' })
      };
    }

    // Create order in database
    const orderPayload = {
      user_id: user.userId,
      service_id: serviceId,
      service_name: service.name,
      link: link,
      quantity: quantity,
      charge: totalCost,
      status: 'pending',
      order_number: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
    };

    // Detailed insert & logging to diagnose failures
    console.log('Creating order with payload:', orderPayload);
    const insertResult = await supabaseAdmin
      .from('orders')
      .insert(orderPayload)
      .select(); // return inserted rows

    console.log('Supabase insert result:', insertResult);

    // normalize response (data may be array)
    const order = Array.isArray(insertResult.data) ? insertResult.data[0] : insertResult.data;
    const orderError = insertResult.error;

    if (orderError || !order) {
      console.error('Create order insert error:', orderError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create order', details: orderError || 'no-order-returned' })
      };
    }

    // Deduct balance
    await supabaseAdmin
      .from('users')
      .update({ 
        balance: (parseFloat(userData.balance) - parseFloat(totalCost)).toFixed(2)
      })
      .eq('id', user.userId);

    // Submit order to provider
    try {
      const providerResponse = await submitOrderToProvider(service.provider, {
        service: service.provider_service_id,
        link: link,
        quantity: quantity
      });

      // Update order with provider order ID
      await supabaseAdmin
        .from('orders')
        .update({ 
          provider_order_id: providerResponse.order,
          status: 'processing'
        })
        .eq('id', order.id);

      order.provider_order_id = providerResponse.order;
      order.status = 'processing';
    } catch (providerError) {
      console.error('Provider submission error:', providerError);
      // Refund user if provider submission fails
      await supabaseAdmin
        .from('users')
        .update({ 
          balance: (parseFloat(userData.balance)).toFixed(2)
        })
        .eq('id', user.userId);

      await supabaseAdmin
        .from('orders')
        .update({ status: 'failed' })
        .eq('id', order.id);

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to submit order to provider' })
      };
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        order
      })
    };
  } catch (error) {
    console.error('Create order error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleUpdateOrder(user, data, headers) {
  try {
    const { orderId, action } = data;

    if (!orderId || !action) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order ID and action are required' })
      };
    }

    // Get order
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('*, service:services(*, provider:providers(*))')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    // Check permissions
    if (order.user_id !== user.userId && user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden' })
      };
    }

    if (action === 'refill') {
      // Submit refill request to provider
      try {
        const provider = order.service.provider;
        const refillResponse = await axios.post(provider.api_url, {
          key: provider.api_key,
          action: 'refill',
          order: order.provider_order_id
        });

        if (refillResponse.data.refill) {
          await supabaseAdmin
            .from('orders')
            .update({ 
              status: 'refilling',
              refill_id: refillResponse.data.refill
            })
            .eq('id', orderId);

          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              message: 'Refill request submitted'
            })
          };
        }
      } catch (error) {
        console.error('Refill error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to submit refill request' })
        };
      }
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid action' })
    };
  } catch (error) {
    console.error('Update order error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleCancelOrder(user, data, headers) {
  try {
    const { orderId } = data;

    if (!orderId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order ID is required' })
      };
    }

    // Get order
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('*, service:services(*, provider:providers(*))')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    // Check permissions
    if (order.user_id !== user.userId && user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden' })
      };
    }

    // Can only cancel pending orders
    if (order.status !== 'pending' && order.status !== 'processing') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order cannot be cancelled' })
      };
    }

    // Try to cancel with provider
    try {
      const provider = order.service.provider;
      await axios.post(provider.api_url, {
        key: provider.api_key,
        action: 'cancel',
        order: order.provider_order_id
      });
    } catch (error) {
      console.error('Provider cancel error:', error);
      // Continue even if provider cancel fails
    }

    // Refund user
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', order.user_id)
      .single();

    await supabaseAdmin
      .from('users')
      .update({ 
        balance: (parseFloat(userData.balance) + parseFloat(order.charge)).toFixed(2)
      })
      .eq('id', order.user_id);

    // Update order status
    await supabaseAdmin
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', orderId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Order cancelled and refunded'
      })
    };
  } catch (error) {
    console.error('Cancel order error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function submitOrderToProvider(provider, orderData) {
  try {
    const params = new URLSearchParams();
    params.append('key', provider.api_key);
    params.append('action', 'add');
    params.append('service', orderData.service);
    params.append('link', orderData.link);
    params.append('quantity', orderData.quantity);
    
    const response = await axios.post(provider.api_url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (response.data.order) {
      return response.data;
    } else {
      throw new Error(response.data.error || 'Provider returned no order ID');
    }
  } catch (error) {
    console.error('Provider API error:', error);
    throw error;
  }
}

