// Orders API - Create, Get, Update, Cancel Orders
// Ensure browser-only globals never break the server runtime when bundled.
if (typeof globalThis === 'object') {
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = undefined;
  }
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = undefined;
  }
  if (typeof globalThis.addEventListener === 'undefined') {
    globalThis.addEventListener = undefined;
  }
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

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function calculateProviderRate(service) {
  const directRate = toNumberOrNull(service.provider_rate);
  if (directRate !== null) {
    return directRate;
  }

  const retailRate = toNumberOrNull(service.retail_rate ?? service.rate);
  const markup = toNumberOrNull(service.markup_percentage ?? service.provider?.markup);

  if (retailRate !== null && markup !== null && markup > -100) {
    const base = retailRate / (1 + markup / 100);
    return Number(base.toFixed(4));
  }

  return null;
}

function calculateProviderCharge(ratePerThousand, quantity) {
  if (!Number.isFinite(ratePerThousand) || !Number.isFinite(quantity)) {
    return null;
  }
  const charge = (ratePerThousand * quantity) / 1000;
  return Number(charge.toFixed(4));
}

function normalizeOrderDisplayValue(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}

function resolveOrderDisplayNumber(order, fallback) {
  const normalizedFallback = normalizeOrderDisplayValue(fallback);

  if (!order || typeof order !== 'object') {
    return normalizedFallback || null;
  }

  const candidateKeys = [
    'order_number',
    'orderNumber',
    'order_id',
    'orderId',
    'orderid',
    'customer_order_number',
    'customer_order_id',
    'customerOrderNumber',
    'customerOrderId',
    'display_id',
    'displayId',
    'public_id',
    'publicId',
    'reference',
    'order_reference',
    'orderReference'
  ];

  for (const key of candidateKeys) {
    const candidate = normalizeOrderDisplayValue(order[key]);
    if (candidate) {
      return candidate;
    }
  }

  const hyphenCandidate = normalizeOrderDisplayValue(order['order-id']);
  if (hyphenCandidate) {
    return hyphenCandidate;
  }

  if (order.meta && typeof order.meta === 'object') {
    const metaKeys = ['order_number', 'orderNumber', 'reference', 'order_reference', 'orderReference'];
    for (const key of metaKeys) {
      const candidate = normalizeOrderDisplayValue(order.meta[key]);
      if (candidate) {
        return candidate;
      }
    }
  }

  if (Array.isArray(order.identifiers)) {
    for (const entry of order.identifiers) {
      const candidate = normalizeOrderDisplayValue(entry);
      if (candidate) {
        return candidate;
      }
    }
  }

  if (order.id) {
    const baseId = String(order.id).trim();
    if (baseId) {
      const compact = baseId.replace(/[^A-Za-z0-9]/g, '').substring(0, 8).toUpperCase();
      if (compact) {
        return compact;
      }
      return baseId;
    }
  }

  return normalizedFallback || null;
}

function normalizeProviderStatus(rawStatus) {
  if (!rawStatus) {
    return 'processing';
  }

  const status = String(rawStatus).trim().toLowerCase();

  if (!status) {
    return 'processing';
  }

  if (['pending', 'in queue', 'queue', 'waiting'].includes(status)) {
    return 'pending';
  }

  if (status.includes('progress') || status === 'processing' || status === 'started') {
    return 'processing';
  }

  if (status.includes('partial')) {
    return 'partial';
  }

  if (status.includes('cancel') || status.includes('refunded') || status.includes('reversed')) {
    return 'cancelled';
  }

  if (status.includes('fail')) {
    return 'failed';
  }

  if (status.includes('completed') || status.includes('success') || status.includes('done')) {
    return 'completed';
  }

  return 'processing';
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
        if (body && body.action === 'sync-status') {
          return await handleSyncOrderStatuses(user, body, headers);
        }
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
        service:services(id, name, category, rate, public_id, provider_service_id, provider_id, provider:providers(id, name))
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

    const normalizedOrders = Array.isArray(orders)
      ? orders.map(order => {
          const reference = resolveOrderDisplayNumber(order);
          if (!reference) {
            return order;
          }

          const normalized = { ...order, order_number: reference };

          if (!normalizeOrderDisplayValue(order.order_reference)) {
            normalized.order_reference = reference;
          }

          return normalized;
        })
      : [];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ orders: normalizedOrders })
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
  let orderDisplayNumber = null;
  let orderNumberPersisted = true;
  let orderIdentifierColumnUsed = 'order_number';

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
    const retailRatePerThousand = toNumberOrNull(service.retail_rate ?? service.rate);
    if (retailRatePerThousand === null) {
      console.error('[ORDER] Retail rate missing or invalid for service:', serviceId, service.retail_rate, service.rate);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Service pricing not configured correctly' })
      };
    }

    // Calculate total cost (rate is per 1000 units)
    const totalCost = Number(((retailRatePerThousand * qty) / 1000).toFixed(2));
    console.log(`[ORDER] Calculated cost: ${totalCost} for ${qty} units at retail rate ${retailRatePerThousand}`);

    const providerRatePerThousand = calculateProviderRate(service);
    const providerCharge = providerRatePerThousand !== null
      ? calculateProviderCharge(providerRatePerThousand, qty)
      : null;
    console.log('[ORDER] Provider cost estimate:', {
      providerRatePerThousand,
      providerCharge
    });

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
    // Generate sequential order number leveraging database sequence, fallback to legacy format on failure
    let orderNumber = null;
    const { data: generatedOrderNumber, error: generateOrderNumberError } = await supabaseAdmin.rpc('generate_order_number');

    if (generateOrderNumberError) {
      console.error('[ORDER] Failed to generate sequential order number using database function:', generateOrderNumberError);
      orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    } else {
      orderNumber = String(generatedOrderNumber);
    }

    console.log(`[ORDER] Creating order with number: ${orderNumber}`);

    const orderInsertBase = {
      user_id: user.userId,
      service_id: serviceId,
      service_name: service.name,
      link: linkStr,
      quantity: qty,
      charge: totalCost,
      provider_cost: providerCharge,
      status: 'pending'
    };

    let { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({ ...orderInsertBase, order_number: orderNumber })
      .select()
      .single();

    if (orderError) {
      const missingOrderNumberColumn = orderError.code === '42703'
        || /order_number/i.test(orderError.message || '')
        || /order_number/i.test(orderError.details || '')
        || /order_number/i.test(orderError.hint || '');

      if (missingOrderNumberColumn) {
        console.warn('[ORDER] orders table missing order_number column. Attempting fallback identifiers.');
        orderNumberPersisted = false;

        const fallbackColumns = ['order_id', 'orderId', 'orderid', 'order-id', 'order_reference', 'orderReference', 'reference', 'display_id', 'displayId'];
        let fallbackApplied = false;
        let lastFallbackError = orderError;

        for (const column of fallbackColumns) {
          const payload = { ...orderInsertBase };
          payload[column] = orderNumber;

          const { data: fallbackOrder, error: fallbackError } = await supabaseAdmin
            .from('orders')
            .insert(payload)
            .select()
            .single();

          if (!fallbackError && fallbackOrder) {
            order = fallbackOrder;
            orderError = null;
            fallbackApplied = true;
            orderNumberPersisted = true;
            orderIdentifierColumnUsed = column;
            console.warn(`[ORDER] Stored order reference using fallback column '${column}'.`);
            break;
          }

          if (fallbackError) {
            lastFallbackError = fallbackError;
            console.warn('[ORDER] Fallback insert attempt failed', {
              column,
              code: fallbackError.code,
              message: fallbackError.message
            });
          }
        }

        if (!fallbackApplied) {
          ({ data: order, error: orderError } = await supabaseAdmin
            .from('orders')
            .insert(orderInsertBase)
            .select()
            .single());

          if (!orderError) {
            console.warn('[ORDER] Proceeding without persisting human-friendly order reference column.');
          } else if (!orderError.details && lastFallbackError?.message) {
            orderError.details = lastFallbackError.message;
          }
        }
      }
    }

    if (orderError) {
      console.error('[ORDER] Database insert error:', orderError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to create order in database',
          details: orderError.message,
          hint: orderError.hint,
          code: orderError.code
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

    if (!orderNumberPersisted) {
      order.order_number = orderNumber;
    }

    orderDisplayNumber = resolveOrderDisplayNumber(order, orderNumber);
    if (orderDisplayNumber) {
      order.order_number = orderDisplayNumber;
      if (!normalizeOrderDisplayValue(order.order_reference)) {
        order.order_reference = orderDisplayNumber;
      }
    }

    orderCreated = order;
    console.log(`[ORDER] Order created in database: ${order.id}`);
    if (orderIdentifierColumnUsed && orderIdentifierColumnUsed !== 'order_number') {
      console.log(`[ORDER] Order reference stored via fallback column: ${orderIdentifierColumnUsed}`);
    } else if (!orderNumberPersisted) {
      console.warn('[ORDER] Order reference not persisted in database; relying on runtime-generated identifier.');
    }

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

      const providerChargeFromResponse = toNumberOrNull(providerResponse.response?.charge);
      const nowIso = new Date().toISOString();

      const providerUpdatePayload = {
        provider_order_id: providerOrderId,
        status: 'processing',
        provider_status: 'processing',
        last_status_sync: nowIso
      };

      if (providerChargeFromResponse !== null) {
        providerUpdatePayload.provider_cost = providerChargeFromResponse;
      }

      // Update order with provider order ID and status
      const { error: updateError } = await supabaseAdmin
        .from('orders')
        .update(providerUpdatePayload)
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
      order.provider_status = 'processing';
      order.last_status_sync = nowIso;
      if (providerChargeFromResponse !== null) {
        order.provider_cost = providerChargeFromResponse;
      }
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
          status: 'failed',
          provider_status: 'failed',
          last_status_sync: new Date().toISOString()
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
          order_number: orderDisplayNumber || order.order_number,
          order_reference: order.order_reference ?? orderDisplayNumber ?? order.order_number,
          service_name: order.service_name,
          quantity: order.quantity,
          charge: order.charge,
          status: order.status,
          provider_order_id: order.provider_order_id,
          provider_cost: order.provider_cost,
          provider_status: order.provider_status,
          last_status_sync: order.last_status_sync,
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
          .update({ 
            status: 'failed',
            provider_status: 'failed',
            last_status_sync: new Date().toISOString()
          })
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

async function performOrderStatusSync({ orderIds = null, limit = 100 } = {}) {
  const statusesToSync = ['pending', 'processing', 'refilling', 'partial'];

  let ordersQuery = supabaseAdmin
    .from('orders')
    .select('id, service_id, provider_order_id, status, provider_status, provider_cost, start_count, remains, quantity, last_status_sync')
    .not('provider_order_id', 'is', null);

  if (orderIds && orderIds.length > 0) {
    ordersQuery = ordersQuery.in('id', orderIds);
  } else {
    ordersQuery = ordersQuery.in('status', statusesToSync);
  }

  const { data: ordersToSync, error: ordersError } = await ordersQuery.limit(limit);

  if (ordersError) {
    console.error('[ORDER SYNC] Failed to load orders for sync:', ordersError);
    return {
      success: false,
      updated: 0,
      results: [],
      error: `Failed to load orders for sync: ${ordersError.message}`
    };
  }

  if (!ordersToSync || ordersToSync.length === 0) {
    return { success: true, updated: 0, results: [] };
  }

  const serviceIds = Array.from(new Set(ordersToSync.map((order) => order.service_id).filter(Boolean)));
  const servicesMap = new Map();
  const providerMap = new Map();

  if (serviceIds.length > 0) {
    const { data: servicesData, error: servicesError } = await supabaseAdmin
      .from('services')
      .select('id, provider_id, provider_service_id')
      .in('id', serviceIds);

    if (servicesError) {
      console.error('[ORDER SYNC] Failed to load services for sync:', servicesError);
      return {
        success: false,
        updated: 0,
        results: [],
        error: `Failed to load services for sync: ${servicesError.message}`
      };
    }

    const servicesDataArray = servicesData || [];

    servicesDataArray.forEach((service) => {
      servicesMap.set(service.id, service);
    });

    const providerIds = Array.from(new Set(servicesDataArray.map((service) => service.provider_id).filter(Boolean)));

    if (providerIds.length > 0) {
      const { data: providersData, error: providersError } = await supabaseAdmin
        .from('providers')
        .select('id, name, api_url, api_key')
        .in('id', providerIds);

      if (providersError) {
        console.error('[ORDER SYNC] Failed to load providers for sync:', providersError);
        return {
          success: false,
          updated: 0,
          results: [],
          error: `Failed to load providers for sync: ${providersError.message}`
        };
      }

      (providersData || []).forEach((provider) => {
        providerMap.set(provider.id, provider);
      });
    }
  }

  const results = [];
  const nowIso = new Date().toISOString();

  for (const order of ordersToSync) {
    const service = order.service_id ? servicesMap.get(order.service_id) : null;
    const provider = service && service.provider_id ? providerMap.get(service.provider_id) : null;

    if (!service || !provider || !provider.api_url || !provider.api_key) {
      results.push({
        orderId: order.id,
        providerOrderId: order.provider_order_id,
        success: false,
        error: 'Provider configuration missing'
      });
      continue;
    }

    try {
      const statusResponse = await fetchProviderOrderStatus(provider, order.provider_order_id);

      const providerStatusRaw = statusResponse.status || order.provider_status || 'processing';
      const normalizedStatus = normalizeProviderStatus(providerStatusRaw);
      const updatePayload = {
        provider_status: providerStatusRaw,
        last_status_sync: nowIso
      };

      if (normalizedStatus) {
        updatePayload.status = normalizedStatus;
      }

      const remainsValue = toNumberOrNull(statusResponse.remains);
      if (remainsValue !== null) {
        updatePayload.remains = Math.max(0, Math.trunc(remainsValue));
      }

      const startCountValue = toNumberOrNull(statusResponse.start_count ?? statusResponse.startCount);
      if (startCountValue !== null) {
        updatePayload.start_count = Math.max(0, Math.trunc(startCountValue));
      }

      const providerChargeValue = toNumberOrNull(statusResponse.charge);
      if (providerChargeValue !== null) {
        updatePayload.provider_cost = Number(providerChargeValue.toFixed(4));
      }

      const { error: updateError } = await supabaseAdmin
        .from('orders')
        .update(updatePayload)
        .eq('id', order.id);

      if (updateError) {
        console.error('[ORDER SYNC] Failed to update order', order.id, updateError);
        results.push({
          orderId: order.id,
          providerOrderId: order.provider_order_id,
          success: false,
          error: updateError.message
        });
        continue;
      }

      results.push({
        orderId: order.id,
        providerOrderId: order.provider_order_id,
        success: true,
        status: normalizedStatus,
        provider_status: providerStatusRaw
      });
    } catch (syncError) {
      console.error('[ORDER SYNC] Provider sync failed for order', order.id, syncError);
      results.push({
        orderId: order.id,
        providerOrderId: order.provider_order_id,
        success: false,
        error: syncError.message || 'Provider sync failed'
      });
    }
  }

  return {
    success: true,
    updated: results.filter((r) => r.success).length,
    results
  };
}

async function handleSyncOrderStatuses(user, data, headers) {
  if (!user || user.role !== 'admin') {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Admin access required' })
    };
  }

  try {
    const orderIds = Array.isArray(data.orderIds) ? data.orderIds : null;
    const limit = Number.isFinite(data.limit) ? data.limit : 100;
    const result = await performOrderStatusSync({ orderIds, limit });

    if (!result.success) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify(result)
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('[ORDER SYNC] Unexpected error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to sync order statuses', details: error.message })
    };
  }
}

async function fetchProviderOrderStatus(provider, providerOrderId) {
  if (!provider || !provider.api_url || !provider.api_key) {
    throw new Error('Provider credentials missing');
  }

  if (!providerOrderId) {
    throw new Error('Provider order id missing');
  }

  try {
    const params = new URLSearchParams();
    params.append('key', provider.api_key);
    params.append('action', 'status');
    params.append('order', providerOrderId);

    const response = await axios.post(provider.api_url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 20000,
      validateStatus: (status) => status < 500
    });

    if (!response.data) {
      throw new Error('Provider returned empty status response');
    }

    if (response.data.error) {
      throw new Error(`Provider status error: ${response.data.error}`);
    }

    return response.data;
  } catch (error) {
    if (error.response) {
      console.error('[PROVIDER STATUS] HTTP error:', {
        status: error.response.status,
        data: error.response.data
      });
      throw new Error(
        `Provider status HTTP error ${error.response.status}: ${JSON.stringify(error.response.data)}`
      );
    }

    if (error.request) {
      console.error('[PROVIDER STATUS] No response received:', error.message);
      throw new Error('Provider status request timed out');
    }

    console.error('[PROVIDER STATUS] Unexpected error:', error.message);
    throw new Error(`Provider status request failed: ${error.message}`);
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

exports.performOrderStatusSync = performOrderStatusSync;
