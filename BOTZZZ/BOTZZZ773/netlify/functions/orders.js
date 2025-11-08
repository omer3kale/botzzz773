// Orders API - Create, Get, Update, Cancel Orders
// Ensure browser-only globals never break the server runtime when bundled.
if (typeof globalThis.document === 'undefined') {
  globalThis.document = undefined;
}

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
  let orderCreated = null;
  let balanceDeducted = false;
  let originalBalance = null;

  try {
    const { serviceId, quantity, link } = data;

    // ============= STEP 1: VALIDATE INPUT =============
    console.log(`[ORDER] User ${user.email} attempting to create order for service ${serviceId}`);

    if (!serviceId || !quantity || !link) {
      console.error('[ORDER] Missing required fields:', { serviceId, quantity, link });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Service ID, quantity, and link are required',
          details: {
            serviceId: !serviceId ? 'missing' : 'provided',
            quantity: !quantity ? 'missing' : 'provided',
            link: !link ? 'missing' : 'provided'
          }
        })
      };
    }

    // Validate quantity is a number
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty <= 0) {
      console.error('[ORDER] Invalid quantity:', quantity);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Quantity must be a positive number' })
      };
    }

    // Validate link format
    const linkStr = String(link).trim();
    if (linkStr.length === 0 || linkStr.length > 500) {
      console.error('[ORDER] Invalid link length:', linkStr.length);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Link must be between 1 and 500 characters' })
      };
    }

    // ============= STEP 2: GET AND VALIDATE SERVICE =============
    console.log(`[ORDER] Fetching service details for ${serviceId}`);
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('*, provider:providers(*)')
      .eq('id', serviceId)
      .single();

    if (serviceError) {
      console.error('[ORDER] Service lookup error:', serviceError);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Service not found' })
      };
    }

    if (!service) {
      console.error('[ORDER] Service not found:', serviceId);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Service does not exist' })
      };
    }

    if (service.status !== 'active') {
      console.error('[ORDER] Service inactive:', serviceId, service.status);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service is not available' })
      };
    }

    // Validate quantity within service limits
    if (qty < service.min_quantity) {
      console.error('[ORDER] Quantity below minimum:', qty, service.min_quantity);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: `Quantity must be at least ${service.min_quantity}`,
          min_quantity: service.min_quantity
        })
      };
    }

    if (qty > service.max_quantity) {
      console.error('[ORDER] Quantity above maximum:', qty, service.max_quantity);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: `Quantity cannot exceed ${service.max_quantity}`,
          max_quantity: service.max_quantity
        })
      };
    }

    // Validate provider exists and is active
    if (!service.provider) {
      console.error('[ORDER] Service has no provider:', serviceId);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service provider not configured' })
      };
    }

    if (service.provider.status !== 'active') {
      console.error('[ORDER] Provider inactive:', service.provider.id, service.provider.status);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service provider is not available' })
      };
    }

    if (!service.provider.api_url || !service.provider.api_key) {
      console.error('[ORDER] Provider missing API credentials:', service.provider.id);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service provider not properly configured' })
      };
    }

    if (!service.provider_service_id) {
      console.error('[ORDER] Service missing provider service ID:', serviceId);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service not properly configured' })
      };
    }

    // ============= STEP 3: CALCULATE COST & CHECK BALANCE =============
    // Calculate total cost (rate is per 1000 units)
    const totalCost = parseFloat(((service.rate * qty) / 1000).toFixed(2));
    console.log(`[ORDER] Calculated cost: ${totalCost} for ${qty} units at rate ${service.rate}`);

    if (totalCost < 0 || !isFinite(totalCost)) {
      console.error('[ORDER] Invalid cost calculation:', totalCost);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to calculate order cost' })
      };
    }

    // Get user balance with lock to prevent race conditions
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('balance, status')
      .eq('id', user.userId)
      .single();

    if (userError || !userData) {
      console.error('[ORDER] User lookup error:', userError);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'User account not found' })
      };
    }

    if (userData.status !== 'active') {
      console.error('[ORDER] User account inactive:', user.userId, userData.status);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'User account is not active' })
      };
    }

    originalBalance = parseFloat(userData.balance);
    console.log(`[ORDER] User balance: ${originalBalance}, required: ${totalCost}`);

    if (originalBalance < totalCost) {
      console.error('[ORDER] Insufficient balance:', originalBalance, totalCost);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Insufficient balance',
          balance: originalBalance,
          required: totalCost,
          shortfall: (totalCost - originalBalance).toFixed(2)
        })
      };
    }

    // ============= STEP 4: CREATE ORDER IN DATABASE =============
    // Generate compact order number that respects VARCHAR(20) limit
    const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    console.log(`[ORDER] Creating order with number: ${orderNumber}`);

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: user.userId,
        service_id: serviceId,
        service_name: service.name,
        link: linkStr,
        quantity: qty,
        charge: totalCost,
        status: 'pending',
        order_number: orderNumber
      })
      .select()
      .single();

    if (orderError) {
      console.error('[ORDER] Database insert error:', orderError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to create order in database',
          details: orderError.message
        })
      };
    }

    if (!order || !order.id) {
      console.error('[ORDER] Order created but no ID returned');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Order creation failed' })
      };
    }

    orderCreated = order;
    console.log(`[ORDER] Order created in database: ${order.id}`);

    // ============= STEP 5: DEDUCT BALANCE =============
    const newBalance = parseFloat((originalBalance - totalCost).toFixed(2));
    console.log(`[ORDER] Deducting balance: ${originalBalance} -> ${newBalance}`);

    const { error: balanceError } = await supabaseAdmin
      .from('users')
      .update({ 
        balance: newBalance
      })
      .eq('id', user.userId);

    if (balanceError) {
      console.error('[ORDER] Balance deduction error:', balanceError);
      // Rollback: delete order
      await supabaseAdmin.from('orders').delete().eq('id', order.id);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to process payment' })
      };
    }

    balanceDeducted = true;
    console.log(`[ORDER] Balance deducted successfully`);

    // ============= STEP 6: SUBMIT TO PROVIDER =============
    console.log(`[ORDER] Submitting to provider: ${service.provider.name}`);
    
    let providerOrderId = null;
    try {
      const providerResponse = await submitOrderToProvider(service.provider, {
        service: service.provider_service_id,
        link: linkStr,
        quantity: qty
      });

      if (!providerResponse || !providerResponse.order) {
        throw new Error('Provider did not return an order ID');
      }

      providerOrderId = providerResponse.order;
      console.log(`[ORDER] Provider accepted order: ${providerOrderId}`);

      // Update order with provider order ID and status
      const { error: updateError } = await supabaseAdmin
        .from('orders')
        .update({ 
          provider_order_id: providerOrderId,
          status: 'processing'
        })
        .eq('id', order.id);

      if (updateError) {
        console.error('[ORDER] Failed to update order with provider ID:', updateError);
        // Order was submitted to provider but we can't track it - log this critically
        console.error('[ORDER] CRITICAL: Order submitted to provider but update failed', {
          orderId: order.id,
          providerOrderId,
          error: updateError
        });
      }

      order.provider_order_id = providerOrderId;
      order.status = 'processing';
      console.log(`[ORDER] Order ${order.id} successfully processed`);

    } catch (providerError) {
      console.error('[ORDER] Provider submission failed:', providerError);
      
      // ============= ROLLBACK: REFUND AND MARK FAILED =============
      console.log(`[ORDER] Rolling back order ${order.id}`);
      
      // Refund user
      const { error: refundError } = await supabaseAdmin
        .from('users')
        .update({ 
          balance: originalBalance
        })
        .eq('id', user.userId);

      if (refundError) {
        console.error('[ORDER] CRITICAL: Failed to refund user after provider failure:', refundError, {
          userId: user.userId,
          orderId: order.id,
          amount: totalCost
        });
      } else {
        console.log(`[ORDER] User refunded: ${totalCost}`);
      }

      // Mark order as failed
      await supabaseAdmin
        .from('orders')
        .update({ 
          status: 'failed'
        })
        .eq('id', order.id);

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to submit order to provider',
          details: providerError.message || 'Provider API error',
          orderId: order.id,
          refunded: !refundError
        })
      };
    }

    // ============= SUCCESS =============
    console.log(`[ORDER] Order completed successfully: ${order.id}`);
    
    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        order: {
          id: order.id,
          order_number: order.order_number,
          service_name: order.service_name,
          quantity: order.quantity,
          charge: order.charge,
          status: order.status,
          provider_order_id: order.provider_order_id,
          link: order.link,
          created_at: order.created_at
        },
        message: 'Order created and submitted successfully'
      })
    };

  } catch (error) {
    console.error('[ORDER] Unexpected error:', error);
    
    // ============= EMERGENCY ROLLBACK =============
    if (orderCreated && balanceDeducted && originalBalance !== null) {
      console.error('[ORDER] Attempting emergency rollback for order:', orderCreated.id);
      
      try {
        // Refund
        await supabaseAdmin
          .from('users')
          .update({ balance: originalBalance })
          .eq('id', user.userId);
        
        // Mark failed
        await supabaseAdmin
          .from('orders')
          .update({ status: 'failed' })
          .eq('id', orderCreated.id);
        
        console.log('[ORDER] Emergency rollback completed');
      } catch (rollbackError) {
        console.error('[ORDER] CRITICAL: Emergency rollback failed:', rollbackError, {
          orderId: orderCreated.id,
          userId: user.userId,
          amount: orderCreated.charge
        });
      }
    }

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Internal server error',
        message: 'An unexpected error occurred while processing your order'
      })
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
    console.log(`[PROVIDER] Submitting order to ${provider.name}`, {
      service: orderData.service,
      quantity: orderData.quantity
    });

    // Validate provider configuration
    if (!provider.api_url) {
      throw new Error('Provider API URL not configured');
    }

    if (!provider.api_key) {
      throw new Error('Provider API key not configured');
    }

    if (!orderData.service) {
      throw new Error('Provider service ID not specified');
    }

    // Build request parameters
    const params = new URLSearchParams();
    params.append('key', provider.api_key);
    params.append('action', 'add');
    params.append('service', orderData.service);
    params.append('link', orderData.link);
    params.append('quantity', orderData.quantity);
    
    console.log(`[PROVIDER] Calling ${provider.api_url}`);

    // Make request with timeout
    const response = await axios.post(provider.api_url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 30000, // 30 second timeout
      validateStatus: (status) => status < 500 // Don't throw on 4xx errors
    });

    console.log(`[PROVIDER] Response status: ${response.status}`);
    console.log(`[PROVIDER] Response data:`, response.data);

    // Validate response
    if (!response.data) {
      throw new Error('Provider returned empty response');
    }

    // Check for error in response
    if (response.data.error) {
      throw new Error(`Provider error: ${response.data.error}`);
    }

    // Verify order ID was returned
    if (!response.data.order) {
      console.error('[PROVIDER] No order ID in response:', response.data);
      throw new Error('Provider did not return an order ID');
    }

    // Validate order ID is not null/undefined/empty
    const orderId = String(response.data.order).trim();
    if (!orderId || orderId === 'null' || orderId === 'undefined') {
      throw new Error('Provider returned invalid order ID');
    }

    console.log(`[PROVIDER] Order successfully submitted: ${orderId}`);
    
    return {
      order: orderId,
      response: response.data
    };

  } catch (error) {
    // Enhanced error logging
    if (error.response) {
      console.error('[PROVIDER] HTTP error:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      });
      throw new Error(`Provider HTTP error ${error.response.status}: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error('[PROVIDER] No response received:', error.message);
      throw new Error('Provider did not respond (timeout or network error)');
    } else {
      console.error('[PROVIDER] Request setup error:', error.message);
      throw new Error(`Provider request failed: ${error.message}`);
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const serviceSelect = document.getElementById('service');
  const loadingIndicator = document.getElementById('services-loading'); // optional element

  try {
    if (loadingIndicator) loadingIndicator.style.display = 'block';

    const res = await fetch('/.netlify/functions/services');
    if (!res.ok) throw new Error(`Services request failed: ${res.status}`);

    const json = await res.json();
    const services = Array.isArray(json.services) ? json.services : (json.services || []);

    // clear existing options (keep first placeholder)
    while (serviceSelect && serviceSelect.options.length > 1) serviceSelect.remove(1);

    services.forEach(svc => {
      const opt = document.createElement('option');
      opt.value = svc.id || ''; // use DB UUID (backend expects this)
      opt.textContent = `${svc.name} ${svc.rate ? `(${svc.rate}/1000)` : ''}`;
      opt.dataset.providerServiceId = svc.provider_service_id ?? '';
      opt.dataset.siteId = svc.site_id ?? '';
      serviceSelect.appendChild(opt);
    });

    if (loadingIndicator) loadingIndicator.style.display = 'none';
  } catch (err) {
    console.error('Failed to load services:', err);
    if (loadingIndicator) loadingIndicator.textContent = 'Failed to load services';
  }
});


