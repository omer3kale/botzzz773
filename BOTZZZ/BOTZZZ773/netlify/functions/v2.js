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

// Simple in-memory rate limiter (resets on function cold start)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 120; // 120 requests per minute (2 per second average)

// Fallback in-memory rate limiting (for backwards compatibility during DB issues)
function checkRateLimit(userId) {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  
  // Reset if window expired
  if (now > userLimit.resetAt) {
    userLimit.count = 0;
    userLimit.resetAt = now + RATE_LIMIT_WINDOW;
  }
  
  userLimit.count++;
  rateLimitMap.set(userId, userLimit);
  
  return userLimit.count <= MAX_REQUESTS_PER_WINDOW;
}

// Persistent rate limiting using Supabase
async function checkRateLimitPersistent(userId) {
  const now = new Date();
  const oneMinuteAgo = new Date(now - 60000); // 1 minute ago

  try {
    // Get request count from database for last minute
    const { data: requests, error: queryError } = await supabaseAdmin
      .from('rate_limit_log')
      .select('id')
      .eq('user_id', userId)
      .gte('created_at', oneMinuteAgo.toISOString());

    if (queryError) {
      console.error('[API v2] Rate limit check failed:', queryError);
      // Fall back to in-memory check if DB is down
      return checkRateLimit(userId);
    }

    const requestCount = requests ? requests.length : 0;

    // Log this request asynchronously (don't wait for it)
    supabaseAdmin
      .from('rate_limit_log')
      .insert({ user_id: userId, created_at: now.toISOString() })
      .catch(err => console.error('[API v2] Failed to log rate limit:', err));

    // Check if limit exceeded (120 requests per minute)
    if (requestCount >= 120) {
      console.warn(`[API v2] Rate limit exceeded: user=${userId}, requests=${requestCount}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[API v2] Rate limit check error:', error);
    // Fall back to in-memory check on error
    return checkRateLimit(userId);
  }
}

// Comprehensive audit logging
async function auditLog(userId, eventType, details, severity = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = {
    user_id: userId || null,
    event_type: eventType,
    details: JSON.stringify(details),
    severity: severity, // 'info', 'warning', 'critical'
    created_at: timestamp
  };

  try {
    // Log to database asynchronously (don't block request)
    supabaseAdmin
      .from('audit_log')
      .insert([logEntry])
      .catch(err => console.error('[API v2] Audit log insert failed:', err));
  } catch (error) {
    console.error('[API v2] Audit log error:', error);
  }

  // Also log to stdout for serverless log aggregation
  const logLevel = severity === 'critical' ? 'error' : severity === 'warning' ? 'warn' : 'log';
  console[logLevel](`[AUDIT] ${timestamp} | user=${userId} | type=${eventType} |`, details);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, HEAD',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod === 'HEAD') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Enforce request size limit (10KB max)
  const bodyLength = (event.body || '').length;
  const MAX_BODY_SIZE = 10240; // 10KB
  if (bodyLength > MAX_BODY_SIZE) {
    console.warn(`[API v2] Request body exceeds size limit: ${bodyLength} bytes`);
    return {
      statusCode: 413,
      headers,
      body: JSON.stringify({ error: 'Request body too large. Maximum 10KB allowed.' })
    };
  }

  try {
    let params;
    
    if (event.httpMethod === 'GET') {
      // Allow basic GET usage for provider connectivity checks (some panels ping with GET)
      params = event.queryStringParameters || {};
      console.log('[API v2] GET request:', { action: params.action, hasKey: !!params.key });
    } else {
      // Support both JSON and URL-encoded form data (for Perfect Panel compatibility)
      const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
      
      console.log('[API v2] Request received:', {
        method: event.httpMethod,
        contentType: contentType,
        origin: event.headers.origin || event.headers.Origin || 'unknown',
        bodyLength: (event.body || '').length
      });
      
      if (contentType.includes('application/x-www-form-urlencoded')) {
        // Parse URL-encoded form data
        const querystring = require('querystring');
        params = querystring.parse(event.body || '');
        console.log('[API v2] Parsed URL-encoded params:', { action: params.action, hasKey: !!params.key });
      } else {
        // Parse JSON
        params = JSON.parse(event.body || '{}');
        console.log('[API v2] Parsed JSON params:', { action: params.action, hasKey: !!params.key });
      }
    }
    
    const { key, action, ...otherParams } = params;

    // Perfect Panel Compatibility: Default to services list when no action specified
    // This allows provider testing via browser (GET) or automated tools (POST)
    if (!action || action === 'services') {
      console.log('[API v2] Returning services list (provider discovery mode)');
      return await handleServices(null, headers);
    }

    // Validate API key for other actions (add, status, balance, refill)
    if (!key) {
      console.warn('[API v2] Request attempted without API key');
      await auditLog(null, 'auth_failure_missing_key', { action, method: event.httpMethod }, 'warning');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    const user = await getUserFromApiKey(key);
    if (!user) {
      console.warn('[API v2] Request with invalid API key attempted');
      await auditLog(null, 'auth_failure_invalid_key', { action, keyPrefix: key.substring(0, 6), method: event.httpMethod }, 'warning');
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    if (user.status !== 'active') {
      console.warn(`[API v2] Request from inactive account: user=${user.id}`);
      await auditLog(user.id, 'auth_failure_inactive_account', { action, status: user.status }, 'warning');
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Forbidden' })
      };
    }

    // Rate limiting check (persistent via Supabase, with in-memory fallback)
    if (!await checkRateLimitPersistent(user.id)) {
      await auditLog(user.id, 'rate_limit_exceeded', { action }, 'warning');
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: 'Rate limit exceeded. Maximum 120 requests per minute.' })
      };
    }

    // Route to appropriate handler based on action
    switch (action) {
      case 'services':
        return await handleServices(user, headers);
      case 'add':
        return await handleAddOrder(user, otherParams, headers);
      case 'status':
        return await handleOrderStatus(user, otherParams, headers);
      case 'balance':
        return await handleBalance(user, headers);
      case 'refill':
        return await handleRefill(user, otherParams, headers);
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

// Convert UUID to numeric ID (consistent hash)
function uuidToNumericId(uuid) {
  // Remove hyphens and take first 8 characters
  const hex = uuid.replace(/-/g, '').substring(0, 8);
  // Convert to integer (max safe integer in JS is 9007199254740991)
  const numericId = parseInt(hex, 16);
  return numericId;
}

// Find service UUID by numeric ID (reverse lookup)
async function findServiceByNumericId(numericId) {
  try {
    // Get all services and find matching numeric ID
    const { data: services } = await supabaseAdmin
      .from('services')
      .select('id')
      .eq('status', 'active');
    
    if (!services) return null;
    
    for (const service of services) {
      if (uuidToNumericId(service.id) === parseInt(numericId, 10)) {
        return service.id;
      }
    }
    return null;
  } catch (error) {
    console.error('[API v2] Error finding service by numeric ID:', error);
    return null;
  }
}

// Get services list
async function handleServices(user, headers) {
  try {
    const { data: services, error } = await supabaseAdmin
      .from('services')
      .select('*')
      .eq('status', 'active')
      .order('category', { ascending: true });

    if (error) {
      console.error('[API v2] Services query error:', error);
      // Return empty array instead of error for reliability (graceful degradation)
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify([])
      };
    }

    // Validate services array
    if (!Array.isArray(services)) {
      console.error('[API v2] Services response is not an array:', typeof services);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify([])
      };
    }

    // Format services in standard SMM panel format with strict validation
    const formattedServices = services
      .filter(service => {
        // Filter out invalid services
        if (!service.id || !service.name || service.rate === undefined) {
          console.warn(`[API v2] Skipping invalid service:`, service);
          return false;
        }
        return true;
      })
      .map(service => {
        try {
          const rate = parseFloat(service.rate);
          const minQty = parseInt(service.min_quantity || 1, 10);
          const maxQty = parseInt(service.max_quantity || 1000, 10);

          if (isNaN(rate) || isNaN(minQty) || isNaN(maxQty)) {
            console.warn(`[API v2] Service has invalid numeric values:`, { service: service.id, rate, minQty, maxQty });
            return null;
          }

          // Dual compatibility: support both UUID (pre-migration) and numeric (post-migration)
          // If service.id is already a number, use it directly
          // If it's a UUID string, convert to numeric for SMM panel compatibility
          let serviceId;
          if (typeof service.id === 'number') {
            serviceId = service.id; // Post-migration: already numeric
          } else if (typeof service.id === 'string' && /^[0-9]+$/.test(service.id)) {
            serviceId = parseInt(service.id, 10); // String number
          } else {
            serviceId = uuidToNumericId(service.id); // Pre-migration: UUID
          }

          return {
            service: serviceId,
            name: String(service.name || 'Unnamed Service').substring(0, 100),
            type: String(service.type || 'Default').substring(0, 50),
            category: String(service.category || 'General').substring(0, 50),
            rate: rate.toFixed(2),
            min: minQty.toString(),
            max: maxQty.toString(),
            refill: service.refill !== false, // Default to true
            cancel: service.cancel !== false  // Default to true
          };
        } catch (formatError) {
          console.error(`[API v2] Error formatting service ${service.id}:`, formatError);
          return null;
        }
      })
      .filter(s => s !== null); // Remove null entries

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(formattedServices)
    };
  } catch (error) {
    console.error('Services error:', error);
    // Return empty array on error for reliability
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify([])
    };
  }
}

// Add new order
async function handleAddOrder(user, params, headers) {
  try {
    const { service, link, quantity, runs, interval } = params;

    // Extract idempotency key from headers (case-insensitive)
    const idempotencyKey = headers['x-idempotency-key'] || headers['X-Idempotency-Key'];
    
    // If idempotency key provided, check for existing order with same key
    if (idempotencyKey) {
      const { data: existingOrder } = await supabaseAdmin
        .from('orders')
        .select('*')
        .eq('user_id', user.id)
        .eq('idempotency_key', idempotencyKey)
        .single();

      if (existingOrder) {
        console.log(`[API v2] Duplicate request detected via idempotency key: user=${user.id}, key=${idempotencyKey}`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            order: existingOrder.id,
            charge: existingOrder.charge,
            status: existingOrder.status,
            message: 'Order already exists (duplicate request prevented)'
          })
        };
      }
    }

    // Validate required parameters
    if (!service || !link || !quantity) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service, link, and quantity are required' })
      };
    }

    // Dual compatibility: Accept both UUID (pre-migration) and numeric ID (post-migration)
    let actualServiceId = service;
    
    // Check if it's a numeric ID (post-migration or hash-converted)
    const serviceIdNum = parseInt(service, 10);
    if (!isNaN(serviceIdNum) && serviceIdNum > 0) {
      // Try direct numeric lookup first (post-migration)
      const { data: numericService } = await supabaseAdmin
        .from('services')
        .select('id')
        .eq('id', serviceIdNum)
        .eq('status', 'active')
        .single();
      
      if (numericService) {
        actualServiceId = numericService.id; // Found by numeric ID
      } else {
        // Fallback: try reverse hash lookup (pre-migration with hash)
        actualServiceId = await findServiceByNumericId(serviceIdNum);
        if (!actualServiceId) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Service not found' })
          };
        }
      }
    }
    // else: it's already a UUID, use as-is (pre-migration direct UUID)

    // Validate quantity is a positive integer
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Quantity must be a positive integer' })
      };
    }

    // Validate link is a proper URL
    let linkUrl;
    try {
      linkUrl = new URL(link);
      // Ensure it's http or https
      if (!linkUrl.protocol.match(/^https?:$/)) {
        throw new Error('Invalid protocol');
      }
    } catch (urlError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid URL format for link' })
      };
    }

    // Optional: Validate runs and interval if provided
    if (runs !== undefined) {
      const runsNum = parseInt(runs, 10);
      if (isNaN(runsNum) || runsNum < 1) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Runs must be a positive integer' })
        };
      }
    }

    if (interval !== undefined) {
      const intervalNum = parseInt(interval, 10);
      if (isNaN(intervalNum) || intervalNum < 1 || intervalNum > 1440) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Interval must be between 1 and 1440 minutes' })
        };
      }
    }

    // Get service details using the actual UUID
    const { data: serviceData, error: serviceError } = await supabaseAdmin
      .from('services')
      .select('*, provider:providers(*)')
      .eq('id', actualServiceId)
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
    const totalCost = (serviceData.rate * qty).toFixed(2);

    // Validate total cost is reasonable (prevent accidental massive orders)
    if (parseFloat(totalCost) > 10000) {
      console.warn(`[API v2] Suspicious large order attempt: user=${user.id}, service=${actualServiceId}, qty=${qty}, cost=${totalCost}`);
      await auditLog(user.id, 'suspicious_large_order', { service: actualServiceId, quantity: qty, cost: totalCost }, 'critical');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order amount exceeds maximum limit' })
      };
    }

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
        service_id: actualServiceId,
        service_name: serviceData.name,
        link: link,
        quantity: quantity,
        charge: totalCost,
        status: 'pending',
        customer_status: 'processing',
        provider_status: null,
        order_number: `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
        idempotency_key: idempotencyKey || null
      })
      .select()
      .single();

    if (orderError) {
      console.error(`[API v2] Order creation failed: user=${user.id}`, orderError);
      await auditLog(user.id, 'order_creation_failed', { service: actualServiceId, error: orderError.message }, 'critical');
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
              status: 'processing',
              provider_status: 'processing'
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

    // Validate order ID is provided
    if (!order) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order ID is required' })
      };
    }

    // Validate order ID is numeric
    const orderId = parseInt(order, 10);
    if (isNaN(orderId) || orderId <= 0) {
      await auditLog(user.id, 'invalid_order_id_status', { providedId: order }, 'warning');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid order ID' })
      };
    }

    const { data: orderData, error } = await supabaseAdmin
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (error || !orderData) {
      console.warn(`[API v2] Status check on non-existent order: user=${user.id}, order=${orderId}`);
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    // Validate required fields exist
    if (!orderData.status || orderData.charge === undefined || orderData.charge === null) {
      console.error(`[API v2] Order missing required fields: order=${orderId}`, { status: orderData.status, charge: orderData.charge });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Internal server error' })
      };
    }

    // Normalize numeric fields to strings
    const charge = parseFloat(orderData.charge).toFixed(2);
    const startCount = String(orderData.start_count || '0');
    const remains = String(orderData.remains || '0');

    // Validate status is valid enum value
    const validStatuses = ['pending', 'processing', 'completed', 'partial', 'failed', 'refilling', 'refunded'];
    const status = (orderData.status || 'unknown').toLowerCase();
    if (!validStatuses.includes(status)) {
      console.warn(`[API v2] Invalid status value: order=${orderId}, status=${status}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        charge: charge,
        start_count: startCount,
        status: status.charAt(0).toUpperCase() + status.slice(1),
        remains: remains,
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

    // Validate order ID is provided
    if (!order) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order ID is required' })
      };
    }

    // Validate order ID is numeric
    const orderId = parseInt(order, 10);
    if (isNaN(orderId) || orderId <= 0) {
      await auditLog(user.id, 'invalid_order_id_refill', { providedId: order }, 'warning');
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid order ID' })
      };
    }

    // Get order and verify ownership
    const { data: orderData, error } = await supabaseAdmin
      .from('orders')
      .select('*, service:services(*, provider:providers(*))')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (error || !orderData) {
      console.warn(`[API v2] Refill attempt on non-existent order: user=${user.id}, order=${orderId}`);
      await auditLog(user.id, 'refill_nonexistent_order', { orderId }, 'warning');
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    // Verify order has provider order ID (was submitted to provider)
    if (!orderData.provider_order_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'This order cannot be refilled' })
      };
    }

    // Check if order is already in a refill process
    if (orderData.status === 'refilling') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order is already being refilled' })
      };
    }

    // Submit refill to provider if available
    if (orderData.service && orderData.service.provider && orderData.service.provider.api_url && orderData.service.provider.api_key) {
      try {
        const axios = require('axios');
        const providerParams = new URLSearchParams();
        providerParams.append('key', orderData.service.provider.api_key);
        providerParams.append('action', 'refill');
        providerParams.append('order', orderData.provider_order_id);

        const providerResponse = await axios.post(orderData.service.provider.api_url, providerParams, {
          timeout: 10000 // 10 second timeout
        });

        // Validate provider response format
        if (!providerResponse.data || !providerResponse.data.refill) {
          console.error(`[API v2] Invalid provider refill response: order=${orderId}`, providerResponse.data);
          return {
            statusCode: 502,
            headers,
            body: JSON.stringify({ error: 'Provider returned invalid response' })
          };
        }

        // Update order with refill info
        await supabaseAdmin
          .from('orders')
          .update({ 
            status: 'refilling',
            refill_id: providerResponse.data.refill
          })
          .eq('id', orderId);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ refill: providerResponse.data.refill })
        };
      } catch (providerError) {
        console.error(`[API v2] Provider refill error: order=${orderId}`, providerError.message);
        return {
          statusCode: 502,
          headers,
          body: JSON.stringify({ error: 'Provider request failed. Please try again later.' })
        };
      }
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Refill is not available for this order' })
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
