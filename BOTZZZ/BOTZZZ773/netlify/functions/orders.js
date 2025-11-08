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
    // robust body parsing: accept JSON and application/x-www-form-urlencoded
    let body = {};
    const contentType = ((event.headers && (event.headers['content-type'] || event.headers['Content-Type'])) || '').toLowerCase();
    if (contentType.includes('application/json')) {
      body = JSON.parse(event.body || '{}');
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams(event.body || '');
      for (const [k, v] of params.entries()) body[k] = v;
    } else {
      // fallback: try JSON then urlencoded
      try {
        body = JSON.parse(event.body || '{}');
      } catch (e) {
        const params = new URLSearchParams(event.body || '');
        for (const [k, v] of params.entries()) body[k] = v;
      }
    }

    // Normalize common alternative field names so handlers can rely on consistent keys
    if (body.service_id && !body.serviceId) body.serviceId = body.service_id;
    if (body.service && !body.serviceId) body.serviceId = body.service;
    if (body.serviceID && !body.serviceId) body.serviceId = body.serviceID;

    if ((body.qty || body.q) && !body.quantity) body.quantity = Number(body.qty || body.q);
    if (body.quantity && typeof body.quantity === 'string') body.quantity = Number(body.quantity);

    if ((body.url || body.target) && !body.link) body.link = body.url || body.target;

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

    console.log('CREATE ORDER INPUT:', { userId: user.userId, serviceId, quantity, link });

    // Get service details
    let service, serviceError;
    const sid = String(serviceId || '').trim();
    const isNumeric = /^\d+$/.test(sid);

    if (isNumeric) {
      // Debug: fetch raw rows for numeric provider_service_id and log them
      const { data: rawRows, error: rawErr } = await supabaseAdmin
        .from('services')
        .select('*, provider:providers(*)')
        .eq('provider_service_id', Number(sid))
        .limit(10);
      console.log('DEBUG service rawRows (provider_service_id):', { sid, rawRows, rawErr });

      // Then use maybeSingle to keep existing behavior
      ({ data: service, error: serviceError } = await supabaseAdmin
        .from('services')
        .select('*, provider:providers(*)')
        .eq('provider_service_id', Number(sid))
        .maybeSingle());

      // FALLBACK: if nothing found, attempt to match frontend-generated site_id (startingId + index)
      if (!service) {
        const { data: allServices, error: allErr } = await supabaseAdmin
          .from('services')
          .select('*, provider:providers(*)')
          .order('category', { ascending: true })
          .order('name', { ascending: true });
        console.log('DEBUG allServices count:', { sid, count: allServices && allServices.length, allErr });

        if (Array.isArray(allServices)) {
          const startingId = 2231;
          const match = allServices
            .map((s, i) => ({ ...s, site_id: startingId + i }))
            .find(s => String(s.site_id) === sid);
          if (match) {
            service = match;
            serviceError = null;
            console.log('DEBUG matched service by site_id fallback:', { sid, matchedId: service.id });
          }
        }
      }
    } else {
      // Debug: fetch raw rows for UUID id and log them
      const { data: rawRows, error: rawErr } = await supabaseAdmin
        .from('services')
        .select('*, provider:providers(*)')
        .eq('id', sid)
        .limit(10);
      console.log('DEBUG service rawRows (id):', { sid, rawRows, rawErr });

      ({ data: service, error: serviceError } = await supabaseAdmin
        .from('services')
        .select('*, provider:providers(*)')
        .eq('id', sid)
        .maybeSingle());
    }

    console.log('Service lookup result:', { serviceId: sid, isNumeric, serviceError, found: !!service });

    if (serviceError || !service) {
      console.error('Service lookup failed:', serviceError || 'no service');
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: 'Service not found', 
          details: serviceError ? serviceError.message : 'No service matched the provided id' 
        })
      };
    }

    if (service.status !== 'active') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service is not available' })
      };
    }

    // Ensure numeric quantity
    const qty = Number(quantity);
    const totalCost = ((service.rate * qty) / 1000).toFixed(2);

    // Check user balance
    const { data: userData, error: userDataErr } = await supabaseAdmin
      .from('users')
      .select('balance')
      .eq('id', user.userId)
      .single();

    if (userDataErr) {
      console.error('User lookup failed:', userDataErr);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch user data', details: userDataErr.message })
      };
    }

    if (parseFloat(userData.balance) < parseFloat(totalCost)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Insufficient balance' })
      };
    }

    // Create order in database - use resolved service.id (UUID) for foreign key
    const insertPayload = {
      user_id: user.userId,
      service_id: service.id,           // use DB service UUID
      provider_service_id: service.provider_service_id || null,
      service_name: service.name,
      link: link,
      quantity: qty,
      charge: totalCost,
      status: 'pending',
      order_number: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`
    };

    console.log('Inserting order:', insertPayload);

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert(insertPayload)
      .select()
      .single();

    if (orderError) {
      console.error('Create order error (supabase):', orderError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create order', details: orderError.message })
      };
    }

    console.log('Order created:', order.id);

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

// Client example — DO NOT RUN IN LAMBDA (browser only)
// Use this in your frontend, not in this server file:
//
// fetch('/.netlify/functions/orders', {
//   method: 'POST',
//   headers: {
//     'Content-Type': 'application/json',
//     'Authorization': 'Bearer YOUR_JWT'
//   },
//   body: JSON.stringify({
//     serviceId: 123,        // number or string
//     quantity: 1000,        // number
//     link: 'https://...'    // string
//   })
// });
//
// Additional client-side code to fetch services (not for Lambda):
//
// const res = await fetch('/.netlify/functions/services');
// const json = await res.json();
// const svc = Array.isArray(json.services) ? json.services[0] : null;
//
// if (svc) {
//   const dbId = svc.id;                  // DB UUID (use this for orders)
//   const providerId = svc.provider_service_id; // Provider numeric id (if any)
//   const displayId = svc.site_id;        // Generated site-specific display id
//   console.log({ dbId, providerId, displayId });
// }
function populateServiceDropdown(services) {
    const serviceSelect = document.getElementById('service');
    if (!serviceSelect) return;

    // Clear existing options except first
    while (serviceSelect.options.length > 1) {
        serviceSelect.remove(1);
    }

    services.forEach(service => {
        const option = document.createElement('option');
        // Use DB UUID as the option value (backend expects this by default)
        option.value = service.id; 
        option.textContent = `${service.name} ($${service.rate}/1000)`;
        option.dataset.providerServiceId = service.provider_service_id ?? '';
        option.dataset.siteId = service.site_id ?? '';
        option.dataset.min = service.min_quantity ?? service.min_order ?? 0;
        option.dataset.max = service.max_quantity ?? service.max_order ?? 0;
        serviceSelect.appendChild(option);
    });
}

// filepath: [dashboard.js](http://_vscodecontentref_/8)
// ...existing code...
const orderData = {
    // prefer DB UUID
    serviceId: selectedService.id || selectedService.provider_service_id || selectedService.site_id,
    serviceLabel: selectedService.publicId ? `#${selectedService.publicId}` : selectedService.name,
    link: orderLink,
    quantity
};

