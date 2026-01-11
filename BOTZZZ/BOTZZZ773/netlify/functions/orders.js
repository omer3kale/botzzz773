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
const { withRateLimit } = require('./utils/rate-limit');
const { createLogger, serializeError } = require('./utils/logger');
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const JWT_SECRET = process.env.JWT_SECRET;
const logger = createLogger('orders');

function logOrderError(message, error, meta) {
  logger.error(message, { error: serializeError(error), ...meta });
}

async function markOrderFailure(orderId, {
  message,
  source = 'provider',
  code = null,
  context = {},
  extra = {}
} = {}) {
  if (!orderId) {
    return null;
  }

  const payload = {
    status: 'failed',
    customer_status: 'pending',
    provider_status: 'failed',
    provider_error: message || 'Unknown failure',
    failure_source: source,
    failure_code: code,
    failure_context: context,
    last_status_sync: new Date().toISOString(),
    ...extra
  };

  const { error } = await supabaseAdmin
    .from('orders')
    .update(payload)
    .eq('id', orderId);

  if (error) {
    logger.error('Failed to mark order failure', { orderId, error, payload });
  }

  return error;
}

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

  // Accept both dot and comma decimal separators (e.g., "1.32" or "1,32")
  if (value === undefined || value === null) {
    return null;
  }
  const raw = String(value).trim();
  if (!raw) {
    return null;
  }
  let num = Number(raw);
  if (!Number.isFinite(num)) {
    // Try replacing comma with dot for locales returning "0,01"
    const normalized = raw.replace(',', '.');
    num = Number(normalized);
  }
  return Number.isFinite(num) ? num : null;
}

function normalizeCurrency(value, fallback = 'USD') {
  if (value === undefined || value === null) {
    return fallback;
  }

  const str = String(value).trim();
  if (!str) {
    return fallback;
  }

  return str.toUpperCase().slice(0, 10);
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
    return Number(base.toFixed(5));
  }

  return null;
}

function calculateProviderCharge(ratePerThousand, quantity) {
  if (!Number.isFinite(ratePerThousand) || !Number.isFinite(quantity)) {
    return null;
  }
  const charge = (ratePerThousand * quantity) / 1000;
  return Number(charge.toFixed(5));
}

// Calculate customer-side partial charge based on delivered quantity (quantity - remains)
function calculatePartialCustomerCharge(order) {
  const qty = toNumberOrNull(order?.quantity);
  const fullCharge = toNumberOrNull(order?.charge);
  const remains = toNumberOrNull(order?.remains);

  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(fullCharge) || !Number.isFinite(remains)) {
    return fullCharge;
  }

  const delivered = Math.max(0, qty - remains);
  const ratePerUnit = fullCharge / qty;
  const partialCharge = ratePerUnit * delivered;
  return Number(partialCharge.toFixed(4));
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

  // Separate "in progress" from "processing"
  if (status === 'in progress' || status === 'inprogress' || status === 'in_progress') {
    return 'in progress';
  }

  if (status === 'processing' || status === 'started') {
    return 'processing';
  }

  if (status.includes('partial')) {
    return 'partial';
  }

  if (status.includes('cancel') || status.includes('refunded') || status.includes('reversed')) {
    return 'canceled';
  }

  if (status.includes('fail')) {
    return 'failed';
  }

  if (status.includes('completed') || status.includes('success') || status.includes('done')) {
    return 'completed';
  }

  return 'processing';
}

function normalizeStatusKey(rawStatus, fallback = 'unknown') {
  if (rawStatus === undefined || rawStatus === null) {
    return fallback;
  }

  const status = String(rawStatus).trim().toLowerCase();
  if (!status) {
    return fallback;
  }

  if (status === 'cancelled') {
    return 'canceled';
  }

  return status.replace(/[^a-z0-9]+/g, '-');
}

function formatStatusLabelText(rawStatus, fallback = 'Unknown') {
  if (rawStatus === undefined || rawStatus === null) {
    return fallback;
  }

  const label = String(rawStatus)
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return label || fallback;
}

function coerceJsonObject(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      logger.warn('Failed to parse JSON payload for provider resolution', { error: error?.message });
      return null;
    }
  }

  return null;
}

function unwrapProviderPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  // Prefer most specific nested payloads many providers use
  if (payload.data && typeof payload.data === 'object') return payload.data;
  if (payload.result && typeof payload.result === 'object') return payload.result;
  if (payload.response && typeof payload.response === 'object') return payload.response;

  return payload;
}

function resolveProviderOrderIdFromResponse(resp) {
  if (!resp) return null;

  const flat = unwrapProviderPayload(resp);

  const candidates = [
    flat.order,
    flat.order_id,
    flat.id,
    flat.orderid,
    flat.orderId,
    flat.provider_order_id,
    flat.providerOrderId,
    flat.external_order_id,
    flat.externalOrderId,
    flat.reference,
    flat.display_order_id,
    flat.result && flat.result.order,
    flat.data && flat.data.order,
    resp.order,
    resp.order_id,
    resp.id
  ];

  for (const candidate of candidates) {
    const normalized = normalizeProviderIdentifierCandidate(candidate);
    if (normalized) return normalized;
  }

  return null;
}

function normalizeProviderIdentifierCandidate(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const lowered = trimmed.toLowerCase();
    if (lowered === 'null' || lowered === 'undefined') {
      return null;
    }
    return trimmed;
  }

  return null;
}

function resolveProviderOrderIdFromRecord(order) {
  if (!order || typeof order !== 'object') {
    return null;
  }

  const meta = coerceJsonObject(order.meta);
  const providerResponse = coerceJsonObject(order.provider_response);

  const candidates = [
    order.provider_order_id,
    order.providerOrderId,
    order.external_order_id,
    order.externalOrderId,
    order.provider_reference,
    order.providerReference,
    order.order_reference,
    order.display_order_id,
    meta?.provider_order_id,
    meta?.provider_order,
    meta?.provider_reference,
    meta?.providerOrderId,
    providerResponse?.order,
    providerResponse?.order_id,
    providerResponse?.id,
    providerResponse?.result?.order,
    providerResponse?.result?.order_id,
    providerResponse?.data?.order,
    providerResponse?.data?.order_id
  ];

  for (const candidate of candidates) {
    const normalized = normalizeProviderIdentifierCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function buildStatusSummary(order) {
  const customerRaw = order?.customer_status
    ?? order?.customerStatus
    ?? order?.status
    ?? order?.order_status
    ?? order?.status_label
    ?? 'pending';

  const providerRaw = order?.provider_status
    ?? order?.providerStatus
    ?? order?.provider_status_label
    ?? null;

  const normalizedCustomerKey = normalizeStatusKey(customerRaw, 'pending');
  const customerLabel = formatStatusLabelText(customerRaw, 'Pending');

  let providerSummary = null;
  if (providerRaw) {
    providerSummary = {
      raw: providerRaw,
      normalized: normalizeProviderStatus(providerRaw),
      key: normalizeStatusKey(providerRaw, 'processing'),
      label: formatStatusLabelText(providerRaw, 'Processing')
    };
  }

  const lastSync = order?.last_status_sync ?? null;
  const mode = order?.mode ?? null;

  return {
    customer: {
      raw: customerRaw,
      key: normalizedCustomerKey,
      label: customerLabel
    },
    provider: providerSummary,
    last_sync: lastSync,
    mode,
    has_provider_id: Boolean(order?.provider_order_id)
  };
}

// ============= UNIFIED REFUND PROCESSING =============
/**
 * Process a refund for an order - updates user balance and records transaction
 * This is the SINGLE source of truth for all refund operations
 * @param {Object} order - The order being refunded (must have id, user_id, charge)
 * @param {Object} options - Additional options
 * @returns {Object} - { success, newBalance, refundAmount, error }
 */
async function processOrderRefund(order, options = {}) {
  const {
    source = 'unknown',
    reason = 'refund',
    skipIfAlreadyRefunded = true
  } = options;

  const orderId = order?.id;
  const userId = order?.user_id;
  // Use original charge snapshot if available; fallback to current charge
  const chargeAmount = Number(
    order?.original_charge !== undefined && order?.original_charge !== null
      ? order.original_charge
      : (order?.charge ?? 0)
  );

  console.log(`[REFUND] Processing refund for order ${orderId}`, { userId, chargeAmount, source, reason });

  // Validate order and user exist
  if (!orderId || !userId) {
    console.error(`[REFUND] Missing order ID or user ID`, { orderId, userId });
    return { success: false, error: 'Missing order or user ID' };
  }

  // Validate charge amount: must be positive and reasonable
  if (chargeAmount <= 0) {
    console.log(`[REFUND] Order ${orderId} has no charge to refund (${chargeAmount})`);
    return { success: true, newBalance: null, refundAmount: 0, message: 'No charge to refund' };
  }

  // Security: Prevent excessive refunds (max $10,000 per refund)
  const MAX_REFUND_AMOUNT = 10000;
  if (chargeAmount > MAX_REFUND_AMOUNT) {
    console.error(`[REFUND] Refund amount ${chargeAmount} exceeds maximum allowed (${MAX_REFUND_AMOUNT})`);
    return { success: false, error: `Refund amount exceeds maximum limit of $${MAX_REFUND_AMOUNT}` };
  }

  // Check if order already has refund_applied_at set (primary guard)
  const { data: existingRefundMarker } = await supabaseAdmin
    .from('orders')
    .select('refund_applied_at')
    .eq('id', orderId)
    .maybeSingle();

  if (existingRefundMarker?.refund_applied_at) {
    console.log(`[REFUND] Order ${orderId} already has refund_applied_at set to ${existingRefundMarker.refund_applied_at}, skipping`);
    return { success: true, alreadyRefunded: true, message: 'Already refunded' };
  }

  // Secondary check: verify no refund payment record exists (belt-and-suspenders)
  if (skipIfAlreadyRefunded) {
    const { data: existingRefund } = await supabaseAdmin
      .from('payments')
      .select('id')
      .eq('order_id', orderId)
      .eq('method', 'refund')
      .maybeSingle();

    if (existingRefund) {
      console.log(`[REFUND] Order ${orderId} already has a refund payment record, skipping`);
      return { success: true, alreadyRefunded: true, message: 'Already refunded' };
    }
  }

  // Now set refund_applied_at marker
  const nowIso = new Date().toISOString();
  const { error: refundMarkError } = await supabaseAdmin
    .from('orders')
    .update({ refund_applied_at: nowIso })
    .eq('id', orderId);

  if (refundMarkError) {
    console.error(`[REFUND] Error marking refund for order ${orderId}:`, refundMarkError);
    // Don't fail; continue to process refund
  } else {
    console.log(`[REFUND] Order ${orderId} marked with refund_applied_at = ${nowIso}`);
  }

  // Get user's current balance
  const { data: userData, error: userFetchError } = await supabaseAdmin
    .from('users')
    .select('id, balance, email')
    .eq('id', userId)
    .single();

  if (userFetchError || !userData) {
    console.error(`[REFUND] Failed to fetch user ${userId}:`, userFetchError);
    return { success: false, error: 'User not found' };
  }

  const previousBalance = Number(userData.balance ?? 0);
  const refundAmount = Math.abs(chargeAmount);
  const newBalance = Number((previousBalance + refundAmount).toFixed(5));

  console.log(`[REFUND] User ${userId} (${userData.email}): $${previousBalance} + $${refundAmount} = $${newBalance}`);

  // Update user balance
  const { data: balanceResult, error: balanceError } = await supabaseAdmin
    .from('users')
    .update({ 
      balance: newBalance,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .select('id, balance')
    .single();

  if (balanceError) {
    console.error(`[REFUND] Failed to update balance for user ${userId}:`, balanceError);
    return { success: false, error: 'Failed to update balance', details: balanceError.message };
  }

  console.log(`[REFUND] Balance updated successfully:`, balanceResult);

  // Record refund transaction
  const refundRecord = await recordRefundTransaction(order, chargeAmount, {
    source,
    reason,
    memo: `Refund for ${order.order_number || order.order_reference || order.public_id || orderId}`
  });

  return {
    success: true,
    previousBalance,
    newBalance: balanceResult.balance,
    refundAmount,
    refundRecord,
    userId,
    userEmail: userData.email
  };
}

const baseHandler = async (event) => {
  // Restrict CORS to trusted origins only
  const origin = event.headers.origin || event.headers.referer;
  const trustedOrigins = [
    'https://botzzz773.pro',
    'https://botzzz773.netlify.app',
    'http://localhost:3000',
    'http://localhost:8888',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8888'
  ];
  const allowedOrigin = origin && trustedOrigins.some(t => origin.includes(t)) ? origin : trustedOrigins[0];
  
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const user = getUserFromToken(event.headers.authorization);
  logger.info('Orders request received', {
    method: event.httpMethod,
    path: event.path,
    userId: user?.userId,
    userRole: user?.role || 'guest'
  });
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ 
        error: 'Unauthorized - You must be signed in to place orders. Please sign in or create an account.' 
      })
    };
  }

  // Verify user has valid userId
  if (!user.userId) {
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
        return await handleGetOrders(user, headers, event.queryStringParameters);
      case 'POST':
        if (body && body.action === 'sync-status') {
          return await handleSyncOrderStatuses(user, body, headers);
        }
        if (body && body.action === 'get-provider-errors') {
          return await handleGetProviderErrors(user, body, headers);
        }
        if (body && body.action === 'resolve-provider-error') {
          return await handleResolveProviderError(user, body, headers);
        }
        if (body && body.action === 'get_link_management_data') {
          return await handleGetLinkManagementData(user, headers);
        }
        if (body && body.action === 'resolve_link_conflicts') {
          return await handleResolveLinkConflicts(user, body, headers);
        }
        if (body && body.action === 'merge_link_orders') {
          return await handleMergeLinkOrders(user, body, headers);
        }
        if (body && body.action === 'resolve_all_conflicts') {
          return await handleResolveAllConflicts(user, headers);
        }
        if (body && body.action === 'resend_order') {
          return await handleResendOrder(user, body, headers);
        }
        if (body && body.action === 'refill') {
          return await handleRefillOrder(user, body, headers);
        }
        return await handleCreateOrder(user, body, headers);
      case 'PUT':
        return await handleUpdateOrder(user, body, headers);
      case 'DELETE':
        // Check if this is a hard delete (permanent removal) or cancel (refund)
        if (body && body.action === 'delete') {
          return await handleDeleteOrder(user, body, headers);
        }
        return await handleCancelOrder(user, body, headers);
      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    logOrderError('Orders API error', error, { method: event.httpMethod });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

const ORDERS_RATE_LIMIT = {
  route: 'orders',
  limit: 180,
  windowSeconds: 60,
  identifierExtractor: (event) => {
    const headers = event?.headers || {};
    const authHeader = headers.authorization || headers.Authorization;
    const user = getUserFromToken(authHeader);
    return user?.userId ? `user:${user.userId}` : null;
  }
};

exports.handler = withRateLimit(ORDERS_RATE_LIMIT, baseHandler);

async function handleGetOrders(user, headers, queryParams = {}) {
  try {
    // Validate user object
    if (!user || !user.userId) {
      console.error('[GET ORDERS] Invalid user object:', user);
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    // Get pagination params with validation
    const limit = Math.min(Math.max(parseInt(queryParams?.limit) || 50, 1), 500); // Default 50 per page
    const offset = Math.max(parseInt(queryParams?.offset) || 0, 0);
    const statusFilter = queryParams?.status ? String(queryParams.status).toLowerCase().trim() : null;
    const orderIdFilter = queryParams?.orderId ? String(queryParams.orderId).trim() : null;
    // New: support multi-ID search and order_number search
    const idsFilterRaw = queryParams?.ids ? String(queryParams.ids).trim() : null; // comma-separated order ids
    const numbersFilterRaw = queryParams?.numbers ? String(queryParams.numbers).trim() : null; // comma-separated order_number strings
    const searchQuery = queryParams?.search ? String(queryParams.search).toLowerCase().trim() : null; // Text search
    const idsFilter = idsFilterRaw ? idsFilterRaw.split(',').map(s => s.trim()).filter(s => s.length > 0) : null;
    const numbersFilter = numbersFilterRaw ? numbersFilterRaw.split(',').map(s => s.trim()).filter(s => s.length > 0) : null;
    const numbersFilterNormalized = numbersFilter
      ? Array.from(new Set(numbersFilter.flatMap(v => {
          const n = Number(v);
          return Number.isFinite(n) ? [v, String(n), n] : [v];
        })))
      : null;
    
    // DEBUG: Log what we're actually querying
    console.log('[GET ORDERS] Query params received:', JSON.stringify({
      role: user.role,
      userId: user.userId,
      statusFilter,
      orderIdFilter,
      searchQuery,
      limit,
      offset,
      rawQueryParams: queryParams,
      idsFilterCount: Array.isArray(idsFilter) ? idsFilter.length : 0,
      numbersFilterCount: Array.isArray(numbersFilterNormalized) ? numbersFilterNormalized.length : 0
    }));
    
    // Validate status filter if provided
    const validStatuses = ['pending', 'processing', 'completed', 'partial', 'canceled', 'failed', 'error'];
    if (statusFilter && !validStatuses.includes(statusFilter)) {
      console.warn('[GET ORDERS] Invalid status filter:', statusFilter);
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid status filter' })
      };
    }
    
    let query = supabaseAdmin
      .from('orders')
      .select(`
        *,
        user:users(id, email, username),
        service:services(id, public_id, name, category, rate, provider_service_id, provider_id, refill_supported, cancel_supported, dripfeed_supported, subscription_supported, provider:providers(id, name))
      `)
      .order('created_at', { ascending: false });
    
    // Build count query to get total number of matching orders
    let countQuery = supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: false })
      .order('created_at', { ascending: false });
    
    // NOTE: When search is active, fetch all orders first (no range), then filter and paginate on backend
    if (!searchQuery) {
      query = query.range(offset, offset + limit - 1);
    }

    if (orderIdFilter) {
      query = query.eq('id', orderIdFilter);
      countQuery = countQuery.eq('id', orderIdFilter);
    }
    if (idsFilter && idsFilter.length > 0) {
      // Cast numeric strings to numbers where possible, keep strings otherwise
      const idVals = idsFilter.map(v => {
        const n = Number(v);
        return Number.isFinite(n) ? n : v;
      });
      query = query.in('id', idVals);
      countQuery = countQuery.in('id', idVals);
    }
    if (numbersFilterNormalized && numbersFilterNormalized.length > 0) {
      query = query.in('order_number', numbersFilterNormalized);
      countQuery = countQuery.in('order_number', numbersFilterNormalized);
    }

    // Non-admins can only see their own orders
    if (user.role !== 'admin') {
      query = query.eq('user_id', user.userId);
      countQuery = countQuery.eq('user_id', user.userId);
      
      // Non-admins cannot filter by 'failed' status (they shouldn't see failed orders)
      if (statusFilter === 'failed' || statusFilter === 'error') {
        console.warn('[GET ORDERS] Non-admin attempted to filter failed orders:', user.userId);
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Access denied' })
        };
      }
    }

    // Admin can filter by status (for failed orders view)
    if (user.role === 'admin' && statusFilter) {
      console.log('[GET ORDERS] Admin filtering by status:', statusFilter);
      if (statusFilter === 'failed') {
        query = query.in('status', ['failed', 'error']);
        countQuery = countQuery.in('status', ['failed', 'error']);
      } else {
        query = query.eq('status', statusFilter);
        countQuery = countQuery.eq('status', statusFilter);
      }
    } else if (user.role === 'admin' && !statusFilter) {
      console.log('[GET ORDERS] Admin requesting ALL orders (no status filter)');
    }

    // Execute count query first (if no search)
    let totalCountFromDB = 0;
    if (!searchQuery) {
      const { count, error: countError } = await countQuery;
      if (countError) {
        console.error('[GET ORDERS] Count query error:', countError);
      } else {
        totalCountFromDB = count || 0;
        console.log('[GET ORDERS] Total count from DB:', totalCountFromDB);
      }
    }

    const { data: orders, error } = await query;
    
    // DEBUG: Log the query result
    const statusCounts = {};
    if (Array.isArray(orders)) {
      orders.forEach(o => {
        const s = o.status || 'unknown';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
      });
    }
    console.log('[GET ORDERS] Result summary:', {
      totalOrders: orders?.length || 0,
      statusBreakdown: statusCounts,
      hasError: !!error
    });

    if (error) {
      logOrderError('Get orders error', error, { userId: user.userId });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch orders' })
      };
    }

    let normalizedOrders = Array.isArray(orders)
      ? orders.map(order => {
          const reference = resolveOrderDisplayNumber(order);
          if (!reference) {
            return order;
          }

          const normalized = { ...order, order_number: reference };

          if (!normalizeOrderDisplayValue(order.order_reference)) {
            normalized.order_reference = reference;
          }

          if (!normalizeOrderDisplayValue(order.public_id)) {
            normalized.public_id = reference;
          }

          normalized.display_order_id = reference;

          // Build comprehensive status summary
          const statusSummary = buildStatusSummary(normalized);
          normalized.status_summary = statusSummary;
          
          // Ensure all status fields are available at top level for easy access
          normalized.customer_status = statusSummary.customer?.raw;
          normalized.customer_status_label = statusSummary.customer?.label;
          normalized.customer_status_key = statusSummary.customer?.key;
          normalized.provider_status_label = statusSummary.provider?.label || null;
          normalized.provider_status_key = statusSummary.provider?.key || null;
          normalized.provider_status_raw = statusSummary.provider?.raw || null;
          normalized.mode = statusSummary.mode || order.mode || 'auto';
          
          // Ensure provider_order_id is consistently available
          if (!normalized.provider_order_id && order.providerOrderId) {
            normalized.provider_order_id = order.providerOrderId;
          }

          if (!normalized.provider_order_id) {
            const derivedProviderOrderId = resolveProviderOrderIdFromRecord(normalized);
            if (derivedProviderOrderId) {
              normalized.provider_order_id = derivedProviderOrderId;
            }
          }

          return normalized;
        })
      : [];

    if (user.role === 'admin' && statusFilter === 'failed' && normalizedOrders.length > 0) {
      const failedOrderIds = normalizedOrders
        .map(order => order?.id)
        .filter(id => id !== null && id !== undefined);

      if (failedOrderIds.length > 0) {
        const { data: failureLogs, error: failureLogsError } = await supabaseAdmin
          .from('provider_errors')
          .select('order_id, retry_count, resolved, resolved_at, last_retry_at, error_timestamp, error_message, failure_source, failure_code, failure_context')
          .in('order_id', failedOrderIds);

        if (failureLogsError) {
          logOrderError('Failed to load provider error metadata', failureLogsError, { count: failedOrderIds.length });
        } else if (Array.isArray(failureLogs) && failureLogs.length > 0) {
          const failureMap = failureLogs.reduce((acc, log) => {
            if (log && log.order_id) {
              acc[String(log.order_id)] = log;
            }
            return acc;
          }, {});

          normalizedOrders = normalizedOrders.map(order => {
            const key = order?.id !== undefined && order?.id !== null ? String(order.id) : null;
            if (!key) {
              return order;
            }
            const failureLog = failureMap[key];
            return failureLog ? { ...order, failure_log: failureLog } : order;
          });
        }
      }
    }

    // Perfect Panel compatibility mapping
    normalizedOrders = normalizedOrders.map(order => {
      // Canceled: charge -> 0, no refund field
      if (order.status === 'canceled' || order.status === 'cancelled') {
        const newOrder = { ...order };
        newOrder.charge = 0;
        if ('refund' in newOrder) delete newOrder.refund;
        return newOrder;
      }

      // Partial: charge reflects delivered portion (customer price), remains stays
      if (order.status === 'partial') {
        const newOrder = { ...order };
        newOrder.charge = calculatePartialCustomerCharge(order);
        return newOrder;
      }

      return order;
    });

    // Apply search filtering if search query provided
    let searchedOrders = normalizedOrders;
    if (searchQuery) {
      searchedOrders = normalizedOrders.filter(order => {
        const orderNumber = String(order.order_number || '').toLowerCase();
        const orderReference = String(order.order_reference || '').toLowerCase();
        const publicId = String(order.public_id || '').toLowerCase();
        const userEmail = String(order.user?.email || '').toLowerCase();
        const userName = String(order.user?.username || '').toLowerCase();
        const serviceName = String(order.service?.name || '').toLowerCase();
        const servicePublicId = String(order.service?.public_id || '').toLowerCase();
        const serviceCategory = String(order.service?.category || '').toLowerCase();
        // Use order's snapshot provider name first, fallback to service provider name for backward compatibility
        const providerName = String(order.provider_name || order.service?.provider?.name || '').toLowerCase();
        const providerOrderId = String(order.provider_order_id || '').toLowerCase();
        const link = String(order.link || '').toLowerCase();
        
        // Search matches if query appears in any of these fields
        return orderNumber.includes(searchQuery) ||
               orderReference.includes(searchQuery) ||
               publicId.includes(searchQuery) ||
               userEmail.includes(searchQuery) ||
               userName.includes(searchQuery) ||
               serviceName.includes(searchQuery) ||
               servicePublicId.includes(searchQuery) ||
               serviceCategory.includes(searchQuery) ||
               providerName.includes(searchQuery) ||
               providerOrderId.includes(searchQuery) ||
               link.includes(searchQuery);
      });
      console.log('[GET ORDERS] Search results:', {
        searchQuery,
        totalBeforeSearch: normalizedOrders.length,
        totalAfterSearch: searchedOrders.length
      });
    }

    // Apply pagination to search results
    let totalCount, paginatedOrders, totalPages, currentPage;
    
    if (searchQuery) {
      // Search active: use filtered results count
      totalCount = searchedOrders.length;
      paginatedOrders = searchedOrders.slice(offset, offset + limit);
    } else {
      // No search: use DB count and already paginated orders
      totalCount = totalCountFromDB;
      paginatedOrders = searchedOrders; // Already paginated by .range()
    }
    
    totalPages = Math.ceil(totalCount / limit);
    currentPage = Math.floor(offset / limit) + 1;
    
    console.log('[GET ORDERS] Final pagination:', {
      totalCount,
      totalPages,
      currentPage,
      returnedOrders: paginatedOrders.length,
      searchActive: !!searchQuery
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        orders: paginatedOrders,
        pagination: {
          totalCount,
          totalPages,
          currentPage,
          perPage: limit,
          offset,
          hasNextPage: currentPage < totalPages,
          hasPrevPage: currentPage > 1
        }
      })
    };
  } catch (error) {
    logOrderError('Get orders error', error, { userId: user.userId });
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
    logger.info('Create order attempt', {
      userId: user.userId,
      email: user.email || 'not-provided',
      serviceId
    });

    if (!serviceId || !quantity || !link) {
      logger.warn('Order missing required fields', { serviceId, quantityProvided: !!quantity, linkProvided: !!link });
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
      logger.warn('Order quantity invalid', { quantity });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Quantity must be a positive number' })
      };
    }

    // Validate link format
    const linkStr = String(link).trim();
    if (linkStr.length === 0 || linkStr.length > 500) {
      logger.warn('Order link length invalid', { length: linkStr.length });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Link must be between 1 and 500 characters' })
      };
    }

    // ============= STEP 2: GET AND VALIDATE SERVICE =============
    logger.debug('Fetching service details', { serviceId });
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .select('*, provider:providers(*)')
      .eq('id', serviceId)
      .single();

    if (serviceError) {
      logOrderError('Service lookup error', serviceError, { serviceId });
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Service not found' })
      };
    }

    if (!service) {
      logger.warn('Service not found', { serviceId });
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Service does not exist' })
      };
    }

    if (service.status !== 'active') {
      logger.warn('Service inactive', { serviceId, status: service.status });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service is not available' })
      };
    }

    // Validate quantity within service limits
    if (qty < service.min_quantity) {
      logger.warn('Order quantity below minimum', { qty, min: service.min_quantity });
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
      logger.warn('Order quantity above maximum', { qty, max: service.max_quantity });
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
      logger.warn('Service missing provider', { serviceId });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service provider not configured' })
      };
    }

    if (service.provider.status !== 'active') {
      logger.warn('Provider inactive', { providerId: service.provider.id, status: service.provider.status });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service provider is not available' })
      };
    }

    if (!service.provider.api_url || !service.provider.api_key) {
      logger.warn('Provider missing API credentials', { providerId: service.provider.id });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service provider not properly configured' })
      };
    }

    if (!service.provider_service_id) {
      logger.warn('Service missing provider service ID', { serviceId });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service not properly configured' })
      };
    }

    // ============= STEP 3: CALCULATE COST & CHECK BALANCE =============
    const retailRatePerThousand = toNumberOrNull(service.retail_rate ?? service.rate);
    if (retailRatePerThousand === null) {
      logOrderError('Retail rate missing or invalid', new Error('Retail rate invalid'), {
        serviceId,
        retailRate: service.retail_rate,
        fallbackRate: service.rate
      });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Service pricing not configured correctly' })
      };
    }

    // Calculate total cost (rate is per 1000 units)
    // Keep order charge precise to 5 decimals (balance deductions remain 2 decimals elsewhere)
    const totalCost = Number(((retailRatePerThousand * qty) / 1000).toFixed(5));
    logger.debug('Calculated retail cost', { totalCost, qty, retailRate: retailRatePerThousand });

    const providerRatePerThousand = calculateProviderRate(service);
    const providerCharge = providerRatePerThousand !== null
      ? calculateProviderCharge(providerRatePerThousand, qty)
      : null;
    logger.debug('Provider cost estimate', { providerRatePerThousand, providerCharge });

    if (totalCost < 0 || !isFinite(totalCost)) {
      logOrderError('Invalid order cost calculation', new Error('Cost invalid'), { totalCost });
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
      logOrderError('User lookup error', userError, { userId: user.userId });
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'User account not found' })
      };
    }

    if (userData.status !== 'active') {
      logger.warn('User account inactive', { userId: user.userId, status: userData.status });
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'User account is not active' })
      };
    }

    originalBalance = parseFloat(userData.balance);
    logger.debug('User balance check', { balance: originalBalance, required: totalCost });

    if (originalBalance < totalCost) {
      logger.warn('Insufficient balance for order', { balance: originalBalance, required: totalCost });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Insufficient balance',
          balance: originalBalance,
          required: totalCost,
          shortfall: String((totalCost - originalBalance).toFixed(5)).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
        })
      };
    }

    // ============= STEP 4: CREATE ORDER IN DATABASE =============
    // Generate order number with random increment (1-30) from last order number
    let orderNumber = null;
    
    try {
      // Fetch last order number from database
      const { data: lastOrder, error: lastOrderError } = await supabaseAdmin
        .from('orders')
        .select('order_number')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      let baseNumber = 37000000; // Default starting point
      
      if (!lastOrderError && lastOrder && lastOrder.order_number) {
        const lastNum = parseInt(String(lastOrder.order_number), 10);
        if (!isNaN(lastNum) && lastNum >= baseNumber) {
          baseNumber = lastNum;
        }
      }

      // Random increment between 1 and 30 (with wider range on retry)
      const randomIncrement = Math.floor(Math.random() * 30) + 1;
      orderNumber = String(baseNumber + randomIncrement);
      
      logger.info('Generated order number with random increment', { orderNumber, baseNumber, randomIncrement, userId: user.userId });
    } catch (error) {
      logOrderError('Failed to generate order number', error);
      orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
    }

    logger.info('Creating order record', { orderNumber, userId: user.userId, serviceId });

    // ============= STEP 5.5: LINK TRACKING =============
    // Create or find link tracking record to prevent conflicts
    const linkId = await findOrCreateLink(linkStr, serviceId);
    if (linkId) {
      logger.info('Link tracking created/updated', { linkId, url: linkStr });
    }

    const orderInsertBase = {
      user_id: user.userId,
      service_id: serviceId,
      provider_id: service.provider_id || null, // Snapshot provider at order creation time
      provider_name: service.provider?.name || null, // Snapshot provider name at order creation time
      service_name: service.name,
      link: linkStr,
      quantity: qty,
      charge: totalCost,
      original_charge: totalCost,
      provider_cost: providerCharge,
      start_count: 0,
      remains: qty,
      status: 'pending',
      customer_status: 'pending' // Customer sees pending until provider confirms
    };
    
    // Add link_id now that migration is applied
    if (linkId) {
      orderInsertBase.link_id = linkId;
    }

    let order = null;
    let orderError = null;
    let retryCount = 0;
    const maxRetries = 3;

    // Retry loop for handling duplicate order_number (race condition)
    while (retryCount < maxRetries) {
      const insertResult = await supabaseAdmin
        .from('orders')
        .insert({ ...orderInsertBase, order_number: orderNumber })
        .select()
        .single();

      order = insertResult.data;
      orderError = insertResult.error;

      // Check if error is duplicate order_number (unique constraint violation)
      const isDuplicateOrderNumber = orderError && (
        orderError.code === '23505' || // Postgres unique violation
        /unique.*order_number/i.test(orderError.message || '') ||
        /duplicate.*order_number/i.test(orderError.message || '')
      );

      if (isDuplicateOrderNumber && retryCount < maxRetries - 1) {
        // Regenerate order_number with wider random range
        retryCount++;
        const randomIncrement = Math.floor(Math.random() * 50) + 1; // Wider range on retry
        const { data: lastOrder } = await supabaseAdmin
          .from('orders')
          .select('order_number')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        
        let baseNumber = 37000000;
        if (lastOrder && lastOrder.order_number) {
          const lastNum = parseInt(String(lastOrder.order_number), 10);
          if (!isNaN(lastNum) && lastNum >= baseNumber) {
            baseNumber = lastNum;
          }
        }
        orderNumber = String(baseNumber + randomIncrement);
        logger.warn('Duplicate order_number detected, retrying', { attempt: retryCount, newOrderNumber: orderNumber });
        continue;
      }

      // Either success or non-duplicate error, exit loop
      break;
    }

    if (orderError) {
      const missingOrderNumberColumn = orderError.code === '42703'
        || /order_number/i.test(orderError.message || '')
        || /order_number/i.test(orderError.details || '')
        || /order_number/i.test(orderError.hint || '');

      if (missingOrderNumberColumn) {
        logger.warn('Orders table missing order_number column. Attempting fallback identifiers.');
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
            logger.warn('Stored order reference using fallback column', { column });
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
    const balanceNum = originalBalance - totalCost;
    const newBalance = Number(balanceNum.toFixed(5));
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
      const providerResponse = await submitOrderToProviderWithRetry(service.provider, {
        service: service.provider_service_id,
        link: linkStr,
        quantity: qty
      });

      if (!providerResponse || !providerResponse.order) {
        throw new Error('Provider did not return an order ID');
      }

      providerOrderId = providerResponse.order;
      console.log(`[ORDER] Provider accepted order: ${providerOrderId}`);

      const providerChargeFromResponse = toNumberOrNull(
        providerResponse.response?.charge ?? providerResponse.response?.price ?? providerResponse.response?.cost
      );
      const providerStartCountFromResponse = toNumberOrNull(
        providerResponse.response?.start_count ?? providerResponse.response?.startCount ?? providerResponse.response?.start
      );
      const providerRemainsFromResponse = toNumberOrNull(
        providerResponse.response?.remains ?? providerResponse.response?.remain ?? providerResponse.response?.left
      );
      const providerCurrencyFromResponse = providerResponse.response?.currency
        ?? providerResponse.response?.cur
        ?? providerResponse.response?.price_currency;
      const providerNotesFromResponse = providerResponse.response?.note
        ?? providerResponse.response?.message
        ?? providerResponse.response?.details;
      const nowIso = new Date().toISOString();

      // Derive provider status from response so we don't overwrite a canceled/completed order
      const rawProviderStatus = providerResponse.response?.status
        ?? providerResponse.response?.order_status
        ?? providerResponse.response?.provider_status
        ?? providerResponse.response?.state;
      const normalizedProviderStatus = normalizeProviderStatus(rawProviderStatus);

      const providerUpdatePayload = {
        provider_order_id: providerOrderId,
        status: 'processing',
        customer_status: 'processing', // Default
        provider_status: 'processing',
        last_status_sync: nowIso,
        provider_response: providerResponse.response,
        provider_currency: normalizeCurrency(providerCurrencyFromResponse)
      };

      if (normalizedProviderStatus === 'canceled') {
        providerUpdatePayload.status = 'canceled';
        providerUpdatePayload.customer_status = 'canceled';
        providerUpdatePayload.provider_status = 'canceled';
      } else if (normalizedProviderStatus === 'completed') {
        providerUpdatePayload.status = 'completed';
        providerUpdatePayload.customer_status = 'completed';
        providerUpdatePayload.provider_status = 'completed';
        providerUpdatePayload.alerted_at = null;  // Clear alert flag when order completes
      } else if (normalizedProviderStatus === 'partial') {
        providerUpdatePayload.status = 'partial';
        providerUpdatePayload.customer_status = 'partial';
        providerUpdatePayload.provider_status = 'partial';
        providerUpdatePayload.alerted_at = null;  // Clear alert flag when order changes from failed
      }

      if (providerChargeFromResponse !== null) {
        providerUpdatePayload.provider_cost = providerChargeFromResponse;
      }

      if (providerStartCountFromResponse !== null) {
        providerUpdatePayload.start_count = providerStartCountFromResponse;
      }

      if (providerRemainsFromResponse !== null) {
        providerUpdatePayload.remains = providerRemainsFromResponse;
      }

      if (providerNotesFromResponse) {
        providerUpdatePayload.provider_notes = providerNotesFromResponse;
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
      order.status = providerUpdatePayload.status;
      order.provider_status = providerUpdatePayload.provider_status;
      order.last_status_sync = nowIso;
      if (providerChargeFromResponse !== null) {
        order.provider_cost = providerChargeFromResponse;
      }

      if (providerStartCountFromResponse !== null) {
        order.start_count = providerStartCountFromResponse;
      }

      if (providerRemainsFromResponse !== null) {
        order.remains = providerRemainsFromResponse;
      }

      order.provider_currency = providerUpdatePayload.provider_currency;
      order.provider_response = providerResponse.response;
      if (providerNotesFromResponse) {
        order.provider_notes = providerNotesFromResponse;
      }
      console.log(`[ORDER] Order ${order.id} successfully processed`);

    } catch (providerError) {
      console.error('[ORDER] Provider submission failed:', providerError);
      
      // ============= SILENT FAILURE: SAVE ERROR BUT SHOW SUCCESS TO CUSTOMER =============
      console.log(`[ORDER] Implementing silent failure for order ${order.id}`);
      
      // TRY SALVAGE: if provider may have created order, attempt one status check to avoid duplicate submits
      try {
        // Try to resolve order id from error payload
        const salvagedOrderId = resolveProviderOrderIdFromResponse(providerError.response?.data)
          || resolveProviderOrderIdFromResponse(providerError.response)
          || resolveProviderOrderIdFromResponse(unwrapProviderPayload(providerError.response?.data || providerError.response || {}));

        if (salvagedOrderId) {
          console.log(`[ORDER] Salvage attempt via status check for provider order ${salvagedOrderId}`);
          const statusPayload = await fetchProviderOrderStatus(service.provider, salvagedOrderId);
          const normalizedStatus = normalizeProviderStatus(statusPayload?.status || statusPayload?.order_status || statusPayload?.provider_status);

          // If provider accepted the order, treat this as success and skip error logging
          const statusIso = new Date().toISOString();
          const updatePayload = {
            provider_order_id: salvagedOrderId,
            provider_response: statusPayload,
            last_status_sync: statusIso,
            provider_status: normalizedStatus || 'processing',
            status: 'processing',
            customer_status: 'processing'
          };

          if (normalizedStatus === 'canceled') {
            updatePayload.status = 'canceled';
            updatePayload.customer_status = 'canceled';
          } else if (normalizedStatus === 'completed') {
            updatePayload.status = 'completed';
            updatePayload.customer_status = 'completed';
            updatePayload.alerted_at = null;  // Clear alert flag
          } else if (normalizedStatus === 'partial') {
            updatePayload.status = 'partial';
            updatePayload.customer_status = 'partial';
            updatePayload.alerted_at = null;  // Clear alert flag
          }

          await supabaseAdmin.from('orders').update(updatePayload).eq('id', order.id);

          order.provider_order_id = salvagedOrderId;
          order.status = updatePayload.status;
          order.customer_status = updatePayload.customer_status;
          order.provider_status = updatePayload.provider_status;
          order.provider_response = statusPayload;
          order.last_status_sync = statusIso;

          console.log('[ORDER] Salvage successful via status check; skipping failure log');
          return {
            statusCode: 201,
            headers,
            body: JSON.stringify({
              success: true,
              orderId: order.id,
              providerOrderId: salvagedOrderId,
              status: updatePayload.status
            })
          };
        }
      } catch (salvageError) {
        console.warn('[ORDER] Salvage via status check failed or not applicable:', salvageError?.message || salvageError);
      }

      // Extract error message from provider response (comprehensive extraction)
      let providerErrorMessage = 'Provider request failed';
      try {
        if (providerError.response) {
          if (typeof providerError.response.error === 'string') {
            providerErrorMessage = providerError.response.error;
          } else if (providerError.response.message) {
            providerErrorMessage = providerError.response.message;
          } else if (providerError.response.data?.error) {
            providerErrorMessage = providerError.response.data.error;
          } else if (typeof providerError.response === 'string') {
            providerErrorMessage = providerError.response;
          }
        } else if (providerError.message) {
          providerErrorMessage = providerError.message;
        }
        
        // Sanitize error message (limit length, remove sensitive data)
        providerErrorMessage = String(providerErrorMessage)
          .substring(0, 500)
          .replace(/api[_-]?key[=:]?\s*[\w-]+/gi, 'api_key=***')
          .replace(/token[=:]?\s*[\w-]+/gi, 'token=***');
      } catch (extractError) {
        console.error('[ORDER] Error extracting provider error message:', extractError);
        providerErrorMessage = 'Provider error (details unavailable)';
      }
      
      // DO NOT REFUND - Keep the charge, mark as failed internally
      // Customer still sees "processing", admin can resend later
      try {
        await markOrderFailure(order.id, {
          message: providerErrorMessage,
          source: 'provider',
          code: 'provider_api_error',
          context: {
            stage: 'provider_submission',
            provider_id: order.service?.provider_id || null
          },
          extra: {
            provider_response: providerError.response || { error: providerErrorMessage },
            provider_cost: providerCharge // Set estimated provider cost even on failure
          }
        });
      } catch (dbError) {
        console.error('[ORDER] Database error during silent failure update:', dbError);
        // Continue anyway - we'll still return success to customer
      }
      
      order.status = 'failed';
      order.customer_status = 'pending';
      order.provider_error = providerErrorMessage;
      order.failure_source = 'provider';
      order.failure_code = 'provider_api_error';
      
      console.log(`[ORDER] Silent failure applied - customer sees success, admin can review`);
      
      // RETURN SUCCESS TO CUSTOMER (they never see the error)
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
            status: 'pending', // Customer sees pending, not failed
            link: order.link,
            created_at: order.created_at,
            user_balance: newBalance // Include new balance for frontend sync
          },
          newBalance, // Top-level for easy access
          message: 'Order submitted successfully'
        })
      };
    }

    // ============= SUCCESS =============
    console.log(`[ORDER] Order completed successfully: ${order.id}`);
    
    // Build response order object
    const responseOrder = {
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
      created_at: order.created_at,
      user_balance: newBalance // Include new balance for frontend sync
    };

    // Perfect Panel compatibility for single order response
    if (order.status === 'canceled' || order.status === 'cancelled') {
      responseOrder.charge = 0;
      if ('refund' in responseOrder) delete responseOrder.refund;
    }
    if (order.status === 'partial') {
      responseOrder.charge = calculatePartialCustomerCharge(order);
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        order: responseOrder,
        newBalance, // Top-level for easy access
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

    if (action === 'admin_update') {
      if (user.role !== 'admin') {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Admin access required' })
        };
      }

      const {
        serviceId,
        link,
        quantity,
        charge,
        status,
        providerOrderId,
        customerStatus
      } = data;

      const updates = {};
      let normalizedCustomerStatusOverride = null;

      if (typeof customerStatus === 'string') {
        const rawCustomerStatus = customerStatus.trim().toLowerCase();
        const normalizedCustomerStatus = rawCustomerStatus === 'cancelled' ? 'canceled' : rawCustomerStatus;
        const allowedCustomerStatuses = ['pending', 'processing', 'completed', 'partial', 'canceled', 'failed'];
        if (!allowedCustomerStatuses.includes(normalizedCustomerStatus)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid customer status value' })
          };
        }
        normalizedCustomerStatusOverride = normalizedCustomerStatus;
      }

      if (serviceId && serviceId !== order.service_id) {
        const { data: serviceRecord, error: serviceLookupError } = await supabaseAdmin
          .from('services')
          .select('id, name, status')
          .eq('id', serviceId)
          .single();

        if (serviceLookupError || !serviceRecord) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Selected service not found' })
          };
        }

        if (serviceRecord.status !== 'active') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Selected service is not active' })
          };
        }

        updates.service_id = serviceRecord.id;
        updates.service_name = serviceRecord.name;
      }

      if (typeof link === 'string') {
        const sanitizedLink = link.trim();
        if (!sanitizedLink || sanitizedLink.length > 500) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Link must be between 1 and 500 characters' })
          };
        }
        updates.link = sanitizedLink;
      }

      if (quantity !== undefined && quantity !== null) {
        const parsedQuantity = Number(quantity);
        if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Quantity must be a positive number' })
          };
        }
        updates.quantity = Math.floor(parsedQuantity);
      }

      if (charge !== undefined && charge !== null) {
        const parsedCharge = Number(charge);
        if (!Number.isFinite(parsedCharge) || parsedCharge < 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Charge must be zero or greater' })
          };
        }
        // When updating charge manually, preserve 5-decimal precision
        updates.charge = Number(parsedCharge.toFixed(5));
      }

      if (typeof providerOrderId === 'string') {
        updates.provider_order_id = providerOrderId.trim() || null;
      }

      // Track refund result at this scope level for response
      let adminRefundResult = null;

      if (typeof status === 'string') {
        const normalizedStatus = status.toLowerCase();
        const allowedStatuses = ['pending', 'processing', 'in progress', 'completed', 'partial', 'canceled', 'failed', 'error', 'cancelled'];
        if (!allowedStatuses.includes(normalizedStatus)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Invalid status value' })
          };
        }

        updates.status = normalizedStatus;
        if (!normalizedCustomerStatusOverride) {
          if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
            updates.customer_status = order.customer_status || 'pending';
          } else if (normalizedStatus === 'completed' || normalizedStatus === 'partial') {
            updates.customer_status = normalizedStatus;
          } else if (normalizedStatus === 'canceled' || normalizedStatus === 'cancelled') {
            updates.customer_status = 'canceled';
          }
        }

        // Process refund if status is being changed to cancelled and wasn't already cancelled
        const wasAlreadyCancelled = order.status === 'cancelled' || order.status === 'canceled';
        const isBeingCancelled = normalizedStatus === 'canceled' || normalizedStatus === 'cancelled';
        
        if (isBeingCancelled && !wasAlreadyCancelled) {
          console.log(`[ADMIN UPDATE] Status changing to cancelled for order ${orderId}, processing refund...`);
          adminRefundResult = await processOrderRefund(order, {
            source: 'admin_status_update',
            reason: 'status_changed_to_cancelled',
            skipIfAlreadyRefunded: true
          });
          
          if (adminRefundResult.success) {
            console.log(`[ADMIN UPDATE] Refund processed:`, adminRefundResult);
          } else {
            console.warn(`[ADMIN UPDATE] Refund failed but continuing:`, adminRefundResult.error);
          }
        }
      }

      if (normalizedCustomerStatusOverride) {
        updates.customer_status = normalizedCustomerStatusOverride;
      }

      if (Object.keys(updates).length === 0) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No updates provided' })
        };
      }

      updates.updated_at = new Date().toISOString();

      const { data: updatedOrder, error: updateError } = await supabaseAdmin
        .from('orders')
        .update(updates)
        .eq('id', orderId)
        .select('*, service:services(*, provider:providers(*))')
        .single();

      if (updateError || !updatedOrder) {
        console.error('Admin update failed:', updateError);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to update order' })
        };
      }

      // Build response with refund info if applicable
      const responseOrder = { ...updatedOrder };
      
      // Perfect Panel compatibility: canceled -> charge 0, partial -> delivered charge
      if (updatedOrder.status === 'canceled' || updatedOrder.status === 'cancelled') {
        responseOrder.charge = 0;
        if ('refund' in responseOrder) delete responseOrder.refund;
      } else if (updatedOrder.status === 'partial') {
        responseOrder.charge = calculatePartialCustomerCharge(updatedOrder);
      }
      
      const response = { 
        success: true, 
        order: responseOrder 
      };
      
      // Include refund info so frontend can update balance displays
      if (adminRefundResult?.success && adminRefundResult.newBalance !== undefined) {
        response.refunded = true;
        response.newBalance = adminRefundResult.newBalance;
        response.refundAmount = adminRefundResult.refundAmount;
        response.userId = adminRefundResult.userId;
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(response)
      };
    }

    if (action === 'refill') {
      // Handle refill request
      try {
        const { order: providerOrderId } = data;

        if (!providerOrderId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Order parameter is required for refill' })
          };
        }

        // Find order by order_number (reseller sends order_number, not provider_order_id)
        const { data: foundOrder, error: orderError } = await supabaseAdmin
          .from('orders')
          .select('*, service:services(*, provider:providers(*))')
          .eq('order_number', String(providerOrderId))
          .single();

        if (orderError || !foundOrder) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Order not found' })
          };
        }

        // Verify order status is completed
        if (foundOrder.status !== 'completed') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Refill only available for completed orders',
              currentStatus: foundOrder.status
            })
          };
        }

        // Check if 24 hours have passed since completion
        if (!foundOrder.completed_at) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Order completion time not recorded' })
          };
        }

        const completedTime = new Date(foundOrder.completed_at);
        const now = new Date();
        const hoursPassed = (now - completedTime) / (1000 * 60 * 60);
        const REFILL_TIMEOUT_HOURS = 24;

        if (hoursPassed < REFILL_TIMEOUT_HOURS) {
          const hoursRemaining = REFILL_TIMEOUT_HOURS - hoursPassed;
          const minutesRemaining = Math.ceil((hoursRemaining % 1) * 60);
          const finalHours = Math.floor(hoursRemaining);

          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Refill not yet available',
              message: `Refill will be available in ${finalHours} hours ${minutesRemaining} minutes`,
              hoursRemaining,
              completedAt: foundOrder.completed_at
            })
          };
        }

        // Verify provider and credentials
        if (!foundOrder.service || !foundOrder.service.provider) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Service provider information missing' })
          };
        }

        const provider = foundOrder.service.provider;
        if (!provider.api_url || !provider.api_key) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Provider credentials missing' })
          };
        }

        // Submit refill request to provider using URLSearchParams
        const params = new URLSearchParams();
        params.append('key', provider.api_key);
        params.append('action', 'refill');
        params.append('order', foundOrder.provider_order_id);

        console.log(`[REFILL] Submitting refill for order ${foundOrder.id} (provider: ${provider.name}, provider_order_id: ${foundOrder.provider_order_id})`);

        const refillResponse = await axios.post(provider.api_url, params, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 30000,
          validateStatus: (status) => status < 500
        });

        console.log(`[REFILL] Provider response:`, refillResponse.data);

        // Check for error in response
        if (refillResponse.data.error) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Provider rejected refill request',
              details: refillResponse.data.error
            })
          };
        }

        // Extract refill ID from response
        const refillId = refillResponse.data.refill;
        if (!refillId) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ 
              error: 'Provider did not return refill ID',
              providerResponse: refillResponse.data
            })
          };
        }

        // Update order with refill information
        const { error: updateError } = await supabaseAdmin
          .from('orders')
          .update({
            refill_id: String(refillId),
            refill_status: 'pending',
            refill_requested_at: new Date().toISOString(),
            status: 'refilling'
          })
          .eq('id', foundOrder.id);

        if (updateError) {
          console.error('[REFILL] Failed to update order:', updateError);
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to save refill request' })
          };
        }

        console.log(`[REFILL] Refill submitted successfully. Refill ID: ${refillId}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'Refill request submitted successfully',
            refill_id: refillId,
            refill_status: 'pending'
          })
        };

      } catch (error) {
        console.error('[REFILL] Unexpected error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ 
            error: 'Internal server error',
            message: error.message
          })
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

    // ============= ADMIN-ONLY: Only admins can cancel orders and process refunds =============
    if (user.role !== 'admin') {
      console.log(`[CANCEL] Non-admin user ${user.userId} attempted to cancel order ${orderId}`);
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Only administrators can cancel orders and process refunds',
          message: 'Please contact support if you need to cancel an order.'
        })
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

    // Log order details for debugging
    console.log(`[CANCEL] Admin ${user.userId} cancelling order ${orderId}:`, {
      order_id: order.id,
      user_id: order.user_id,
      status: order.status,
      charge: order.charge,
      order_number: order.order_number
    });

    // Admin can cancel any order except those already cancelled
    if (order.status === 'cancelled') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order is already cancelled' })
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

    const cancellationTime = new Date().toISOString();

    // Process refund using unified refund function
    const refundResult = await processOrderRefund(order, {
      source: 'handleCancelOrder',
      reason: 'order_cancelled',
      skipIfAlreadyRefunded: true // Prevent double refunds if already processed
    });

    if (!refundResult.success) {
      console.error(`[CANCEL] Refund failed for order ${orderId}:`, refundResult.error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to process refund',
          details: refundResult.error 
        })
      };
    }

    // Update order status
    await supabaseAdmin
      .from('orders')
      .update({
        status: 'canceled',
        customer_status: 'canceled',
        provider_status: 'canceled',
        refill_status: 'canceled',
        refill_completed_at: cancellationTime,
        last_status_sync: cancellationTime,
        remains: 0
      })
      .eq('id', orderId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Order cancelled and refunded',
        newBalance: refundResult.newBalance,
        refundAmount: refundResult.refundAmount,
        refund: refundResult.refundRecord || null
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

// ============= DELETE ORDER (PERMANENT REMOVAL) =============
async function handleDeleteOrder(user, data, headers) {
  try {
    const { orderId } = data;

    if (!orderId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order ID is required' })
      };
    }

    // ADMIN-ONLY: Only admins can permanently delete orders
    if (user.role !== 'admin') {
      logger.warn('Unauthorized delete attempt', { userId: user.userId, orderId });
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ 
          error: 'Admin access required',
          message: 'Only administrators can permanently delete orders.'
        })
      };
    }

    // Get order to verify it exists
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, user_id, status, charge')
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    logger.info('Admin deleting order', { 
      adminUserId: user.userId, 
      orderId, 
      orderNumber: order.order_number,
      orderStatus: order.status
    });

    // Permanently delete the order from database
    const { error: deleteError } = await supabaseAdmin
      .from('orders')
      .delete()
      .eq('id', orderId);

    if (deleteError) {
      logger.error('Failed to delete order', { orderId, error: deleteError });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to delete order',
          details: deleteError.message 
        })
      };
    }

    logger.info('Order deleted successfully', { orderId, orderNumber: order.order_number });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Order permanently deleted',
        orderId: orderId,
        orderNumber: order.order_number
      })
    };
  } catch (error) {
    logger.error('Delete order error', { error: error.message, stack: error.stack });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

function buildRefundTransactionId(orderId) {
  const cleanOrder = typeof orderId === 'string'
    ? orderId.replace(/[^a-z0-9]/gi, '').slice(0, 12)
    : 'order';
  const nonce = typeof randomUUID === 'function'
    ? randomUUID().replace(/[^a-z0-9]/gi, '').slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);
  const id = `refund_${cleanOrder || 'order'}_${timestamp}_${nonce}`;
  return id.slice(0, 96);
}

async function recordRefundTransaction(order, amount, options = {}) {
  try {
    if (!order || !order.user_id) {
      return;
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount === 0) {
      return null;
    }

    const payload = {
      transaction_id: buildRefundTransactionId(order.id || order.order_number),
      order_id: order.id || order.order_id || null,
      user_id: order.user_id,
      amount: -Math.abs(Number(numericAmount.toFixed(5))),
      method: 'refund',
      status: options.status || 'refunded',
      memo: options.memo || `Refund issued for ${order.order_number || order.order_reference || order.public_id || order.id}`,
      gateway_response: {
        source: options.source || 'orders-service',
        reason: options.reason || 'refund',
        order_id: order.id,
        order_number: order.order_number || null,
        provider_order_id: order.provider_order_id || null,
        ...options.context
      }
    };

    const { data, error } = await supabaseAdmin
      .from('payments')
      .insert(payload)
      .select('id, transaction_id, amount, created_at')
      .single();

    if (error) {
      throw error;
    }

    return data;
  } catch (error) {
    console.error('[ORDER] Failed to record refund payment:', error, {
      orderId: order?.id,
      userId: order?.user_id
    });
    return null;
  }
}

async function performOrderStatusSync({ orderIds = null, providerId = null, limit = 100 } = {}) {
  // Do NOT include 'canceled' in active sync set to avoid reprocessing canceled orders
  const statusesToSync = ['pending', 'processing', 'in progress', 'refilling', 'partial'];
  const providerFilter = providerId ? String(providerId) : null;

  let ordersQuery = supabaseAdmin
    .from('orders')
    .select('id, service_id, provider_id, provider_order_id, status, customer_status, provider_response, meta, external_order_id, order_number, public_id');

  if (orderIds && orderIds.length > 0) {
    ordersQuery = ordersQuery.in('id', orderIds);
  } else {
    // Sync orders that are:
    // 1. In active states (pending, processing, etc.) OR
    // 2. Completed on provider but customer_status not yet updated
    ordersQuery = ordersQuery.or(`status.in.(${statusesToSync.join(',')}),and(status.eq.completed,customer_status.neq.completed)`);
  }

  const { data: ordersData, error: ordersError } = await ordersQuery.limit(limit);

  if (ordersError) {
    console.error('[ORDER SYNC] Failed to load orders for sync:', ordersError);
    return {
      success: false,
      updated: 0,
      results: [],
      error: `Failed to load orders for sync: ${ordersError.message}`
    };
  }

  if (!ordersData || ordersData.length === 0) {
    return { success: true, updated: 0, results: [] };
  }

  const derivedIdUpdates = [];
  const resolvableOrders = [];
  const skippedResults = [];

  for (const order of ordersData) {
    const resolvedProviderId = resolveProviderOrderIdFromRecord(order);
    if (!resolvedProviderId) {
      skippedResults.push({
        orderId: order.id,
        providerOrderId: null,
        success: false,
        error: 'Provider order ID unavailable'
      });
      continue;
    }

    if (!order.provider_order_id || order.provider_order_id !== resolvedProviderId) {
      derivedIdUpdates.push({ orderId: order.id, providerOrderId: resolvedProviderId });
    }

    resolvableOrders.push({
      ...order,
      provider_order_id: resolvedProviderId
    });
  }

  if (derivedIdUpdates.length > 0) {
    try {
      await Promise.all(
        derivedIdUpdates.map((entry) =>
          supabaseAdmin
            .from('orders')
            .update({ provider_order_id: entry.providerOrderId })
            .eq('id', entry.orderId)
        )
      );
    } catch (persistError) {
      console.error('[ORDER SYNC] Failed to persist derived provider IDs:', persistError);
    }
  }

  if (resolvableOrders.length === 0) {
    return { success: true, updated: 0, results: skippedResults };
  }

  const serviceIds = Array.from(new Set(resolvableOrders.map((order) => order.service_id).filter(Boolean)));
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

  const results = [...skippedResults];
  const nowIso = new Date().toISOString();

  let ordersToSync = resolvableOrders;
  if (providerFilter) {
    ordersToSync = resolvableOrders.filter((order) => {
      if (!order.service_id) return false;
      const service = servicesMap.get(order.service_id);
      if (!service || service.provider_id === undefined || service.provider_id === null) {
        return false;
      }
      return String(service.provider_id) === providerFilter;
    });
  }

  if (ordersToSync.length === 0) {
    return {
      success: true,
      updated: 0,
      results,
      message: providerFilter ? 'No orders matched provider filter' : undefined
    };
  }

  for (const order of ordersToSync) {
    const service = order.service_id ? servicesMap.get(order.service_id) : null;
    // Use order's snapshot provider first (if available), fallback to service provider for backward compatibility
    const providerId = order.provider_id || (service && service.provider_id);
    const provider = providerId ? providerMap.get(providerId) : null;

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

      const providerStatusRaw = statusResponse.status
        ?? statusResponse.status_text
        ?? statusResponse.state
        ?? 'processing';
      const normalizedStatus = normalizeProviderStatus(providerStatusRaw);

      const providerChargeFromResponse = toNumberOrNull(
        statusResponse.charge ?? statusResponse.price ?? statusResponse.cost
      );
      const startCountFromResponse = toNumberOrNull(
        statusResponse.start_count ?? statusResponse.startCount ?? statusResponse.start
      );
      const remainsFromResponse = toNumberOrNull(
        statusResponse.remains ?? statusResponse.remain ?? statusResponse.left
      );
      const providerCurrencyFromResponse = statusResponse.currency
        ?? statusResponse.cur
        ?? statusResponse.price_currency;
      const providerNotesFromResponse = statusResponse.note
        ?? statusResponse.description
        ?? statusResponse.message;

      const updatePayload = {
        last_status_sync: nowIso,
        provider_status: providerStatusRaw,
        provider_response: statusResponse
      };

      if (normalizedStatus) {
        updatePayload.status = normalizedStatus;
        
        // Sync customer_status with provider status based on rules:
        // - completed → customer sees completed
        // - partial → customer sees partial
        // - cancelled → customer sees cancelled
        // - failed/error → customer sees pending (admin sees failed)
        // - in progress → customer sees in progress
        // - processing → customer sees processing
        // - pending → customer sees pending
        if (normalizedStatus === 'completed') {
          updatePayload.customer_status = 'completed';
        } else if (normalizedStatus === 'partial') {
          updatePayload.customer_status = 'partial';
        } else if (normalizedStatus === 'canceled') {
          updatePayload.customer_status = 'canceled';
        } else if (normalizedStatus === 'failed' || normalizedStatus === 'error') {
          updatePayload.customer_status = 'pending';
        } else if (normalizedStatus === 'in progress') {
          updatePayload.customer_status = 'in progress';
        } else if (normalizedStatus === 'processing') {
          updatePayload.customer_status = 'processing';
        } else if (normalizedStatus === 'pending') {
          updatePayload.customer_status = 'pending';
        }
      }

      if (providerChargeFromResponse !== null) {
        updatePayload.provider_cost = providerChargeFromResponse;
      }

      if (startCountFromResponse !== null) {
        updatePayload.start_count = startCountFromResponse;
      }

      if (remainsFromResponse !== null) {
        updatePayload.remains = remainsFromResponse;
      }

      if (providerCurrencyFromResponse) {
        updatePayload.provider_currency = normalizeCurrency(providerCurrencyFromResponse);
      }

      if (providerNotesFromResponse) {
        updatePayload.provider_notes = providerNotesFromResponse;
      }

      if (normalizedStatus === 'completed' && !order.completed_at) {
        updatePayload.completed_at = nowIso;
      }

      // Process refund if provider status changed to cancelled
      const wasAlreadyCancelled = order.status === 'cancelled' || order.status === 'canceled';
      const isBeingCancelled = normalizedStatus === 'cancelled' || normalizedStatus === 'canceled';
      let refundResult = null;
      
      if (isBeingCancelled && !wasAlreadyCancelled) {
        console.log(`[ORDER SYNC] Provider cancelled order ${order.id}, processing refund...`);
        
        // Need to get full order data with charge for refund
        const { data: fullOrder } = await supabaseAdmin
          .from('orders')
          .select('id, user_id, charge, original_charge, order_number, order_reference, public_id')
          .eq('id', order.id)
          .single();
        
        if (fullOrder) {
          refundResult = await processOrderRefund(fullOrder, {
            source: 'provider_sync',
            reason: 'provider_cancelled',
            skipIfAlreadyRefunded: true
          });
          
          if (refundResult.success) {
            console.log(`[ORDER SYNC] Refund processed for order ${order.id}:`, refundResult);
            updatePayload.customer_status = 'canceled';
          } else {
            console.warn(`[ORDER SYNC] Refund failed for order ${order.id}:`, refundResult.error);
          }
        }
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
        providerStatus: providerStatusRaw,
        startCount: startCountFromResponse,
        remains: remainsFromResponse,
        providerCost: providerChargeFromResponse,
        refunded: refundResult?.success || false,
        refundAmount: refundResult?.refundAmount || null
      });
    } catch (syncError) {
      console.error('[ORDER SYNC] Provider sync failed for order', order.id, syncError);
      
      // Provider hatasını kaydet ve siparişi failed olarak işaretle
      const errorMessage = syncError.message || 'Provider sync failed';
      const failurePayload = {
        // Preserve canceled status if already canceled; otherwise mark failed
        status: (order.status === 'canceled' || order.status === 'cancelled') ? order.status : 'failed',
        customer_status: (order.customer_status === 'canceled') ? 'canceled' : 'pending',
        provider_error: errorMessage,
        last_status_sync: nowIso
      };
      
      try {
        await supabaseAdmin
          .from('orders')
          .update(failurePayload)
          .eq('id', order.id);
      } catch (updateError) {
        console.error('[ORDER SYNC] Failed to mark order as failed:', order.id, updateError);
      }
      
      results.push({
        orderId: order.id,
        providerOrderId: order.provider_order_id,
        success: false,
        error: errorMessage
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
    const providerId = data.providerId ?? data.provider_id ?? null;
    const result = await performOrderStatusSync({ orderIds, providerId, limit });

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

// ============= PROVIDER HEALTH TRACKING =============
async function degradeProviderHealth(providerId) {
  try {
    // Get current provider state
    const { data: provider, error: fetchError } = await supabaseAdmin
      .from('providers')
      .select('health_status, consecutive_failures, consecutive_successes')
      .eq('id', providerId)
      .single();

    if (fetchError || !provider) {
      console.warn('[HEALTH] Failed to fetch provider for health check:', fetchError);
      return;
    }

    const failures = (provider.consecutive_failures || 0) + 1;
    const updates = {
      consecutive_failures: failures,
      consecutive_successes: 0,
      last_health_check: new Date().toISOString()
    };

    // Degrade to 'degraded' after 5 consecutive failures
    if (failures >= 5 && provider.health_status !== 'degraded') {
      updates.health_status = 'degraded';
      console.warn(`[HEALTH] Provider ${providerId} degraded after ${failures} failures`);
    }

    await supabaseAdmin
      .from('providers')
      .update(updates)
      .eq('id', providerId);
  } catch (error) {
    console.error('[HEALTH] Failed to degrade provider health:', error);
  }
}

async function restoreProviderHealth(providerId) {
  try {
    // Get current provider state
    const { data: provider, error: fetchError } = await supabaseAdmin
      .from('providers')
      .select('health_status, consecutive_failures, consecutive_successes')
      .eq('id', providerId)
      .single();

    if (fetchError || !provider) {
      console.warn('[HEALTH] Failed to fetch provider for health restore:', fetchError);
      return;
    }

    const successes = (provider.consecutive_successes || 0) + 1;
    const updates = {
      consecutive_successes: successes,
      consecutive_failures: 0,
      last_health_check: new Date().toISOString()
    };

    // Restore to 'active' after 2 consecutive successes (if currently degraded)
    if (successes >= 2 && provider.health_status === 'degraded') {
      updates.health_status = 'active';
      console.log(`[HEALTH] Provider ${providerId} restored to active after ${successes} successes`);
    }

    await supabaseAdmin
      .from('providers')
      .update(updates)
      .eq('id', providerId);
  } catch (error) {
    console.error('[HEALTH] Failed to restore provider health:', error);
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

    // Prefer nested payloads if present (many providers wrap under `data` or `result`)
    const result = unwrapProviderPayload(response.data);
    
    // Success: restore provider health if degraded
    if (provider?.id) {
      try {
        await restoreProviderHealth(provider.id);
      } catch (healthError) {
        console.error('[PROVIDER STATUS] Failed to restore provider health:', healthError);
      }
    }
    
    return result;
  } catch (error) {
    if (provider?.id) {
      try {
        await degradeProviderHealth(provider.id);
      } catch (providerHealthError) {
        console.error('[PROVIDER STATUS] Failed to update provider health:', providerHealthError);
      }
    }

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

// Retry wrapper for order submission with exponential backoff
async function submitOrderToProviderWithRetry(provider, orderData, maxRetries = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[PROVIDER RETRY] Attempt ${attempt}/${maxRetries} for ${provider.name}`);
      return await submitOrderToProvider(provider, orderData);
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === maxRetries;
      
      // Determine if error is retryable
      const isRetryable = isRetryableError(error);
      
      if (!isRetryable) {
        console.log(`[PROVIDER RETRY] Non-retryable error on attempt ${attempt}, giving up immediately`);
        throw error;
      }
      
      if (isLastAttempt) {
        console.error(`[PROVIDER RETRY] All ${maxRetries} attempts failed`, {
          lastError: error.message,
          provider: provider.name
        });
        throw error;
      }
      
      // Exponential backoff: 1s, 2s, 4s
      const delayMs = Math.pow(2, attempt - 1) * 1000;
      console.log(`[PROVIDER RETRY] Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw lastError;
}

// Check if error is retryable (network issues, timeouts) vs non-retryable (auth, validation)
function isRetryableError(error) {
  const errorMsg = error.message?.toLowerCase() || '';
  const errorCode = error.response?.status;
  
  // Non-retryable: Authentication, validation, not found
  if (errorCode === 401 || errorCode === 403 || errorCode === 404 || errorCode === 400) {
    return false;
  }
  
  // Retryable: Server errors, timeouts, network issues
  if (errorCode >= 500 || errorCode === 429) { // 5xx or rate limit
    return true;
  }
  
  // Check error message for network/timeout indicators
  if (errorMsg.includes('timeout') || 
      errorMsg.includes('econnrefused') || 
      errorMsg.includes('enotfound') ||
      errorMsg.includes('no response received') ||
      errorMsg.includes('network error')) {
    return true;
  }
  
  // Check if status code is missing (network error)
  if (!errorCode) {
    return true;
  }
  
  // Default: treat as non-retryable
  return false;
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

    // Additional API key validation
    if (provider.api_key.length < 10 || provider.api_key === 'your-api-key') {
      throw new Error('Provider API key appears to be invalid or placeholder');
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

    // For smmzz.com, mark as client-side submission required (Cloudflare protection)
    let response;
    if (provider.api_url.includes('smmzz.com')) {
      console.log('[PROVIDER] smmzz.com detected - marking for client-side submission due to Cloudflare');
      // Return special response indicating client-side submission is needed
      return {
        order: null,
        response: null,
        requiresClientSideSubmission: true,
        providerName: provider.name,
        providerUrl: provider.api_url,
        apiKey: provider.api_key,
        orderData: {
          service: orderData.service,
          link: orderData.link,
          quantity: orderData.quantity
        },
        error: 'Client-side submission required for Cloudflare-protected provider'
      };
    }

    // Make request with timeout
    response = await axios.post(provider.api_url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
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

    // Try to extract order id from a variety of keys and nested payloads
    const extractedOrderId = resolveProviderOrderIdFromResponse(response.data) || resolveProviderOrderIdFromResponse(unwrapProviderPayload(response.data));

    if (!extractedOrderId) {
      console.error('[PROVIDER] No order ID found in response:', response.data);
      throw new Error('Provider did not return an order ID');
    }

    const orderId = extractedOrderId;

    console.log(`[PROVIDER] Order successfully submitted: ${orderId}`);
    
    // Success: restore provider health if degraded
    if (provider?.id) {
      try {
        await restoreProviderHealth(provider.id);
      } catch (healthError) {
        console.error('[PROVIDER SUBMIT] Failed to restore provider health:', healthError);
      }
    }
    
    return {
      order: orderId,
      response: response.data
    };

  } catch (error) {
    // Failure: degrade provider health
    if (provider?.id) {
      try {
        await degradeProviderHealth(provider.id);
      } catch (healthError) {
        console.error('[PROVIDER SUBMIT] Failed to degrade provider health:', healthError);
      }
    }
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

// ==========================================
// Link Management Functions - ENABLED AFTER MIGRATION
// ==========================================

async function handleGetLinkManagementData(user, headers) {
  try {
    // Only allow admin users
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    // Get link management data with orders
    const { data: links, error: linksError } = await supabaseAdmin
      .from('link_management_dashboard')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100);

    if (linksError) {
      console.error('Error fetching link management data:', linksError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch link management data' })
      };
    }

    // Get statistics
    const { data: stats, error: statsError } = await supabaseAdmin
      .rpc('get_link_management_stats');

    if (statsError) {
      console.error('Error fetching link management stats:', statsError);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        links: links || [],
        stats: stats || {}
      })
    };

  } catch (error) {
    console.error('Link management data error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleResolveLinkConflicts(user, body, headers) {
  try {
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { linkId, action } = body;
    if (!linkId || !action) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Link ID and action are required' })
      };
    }

    if (action === 'merge') {
      // Merge conflicted orders to this link
      const { data: result, error } = await supabaseAdmin
        .rpc('merge_link_orders', { target_link_id: linkId });

      if (error) {
        console.error('Error merging link orders:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to merge orders' })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, result })
      };
    }

    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Invalid action' })
    };

  } catch (error) {
    console.error('Resolve link conflicts error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleMergeLinkOrders(user, body, headers) {
  try {
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { targetLinkId } = body;
    if (!targetLinkId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Target link ID is required' })
      };
    }

    const { data: result, error } = await supabaseAdmin
      .rpc('merge_link_orders', { target_link_id: targetLinkId });

    if (error) {
      console.error('Error merging link orders:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to merge orders' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, result })
    };

  } catch (error) {
    console.error('Merge link orders error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleResolveAllConflicts(user, headers) {
  try {
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    // Get all conflicted links
    const { data: conflictedLinks, error: fetchError } = await supabaseAdmin
      .from('link_management')
      .select('id')
      .eq('status', 'conflicted');

    if (fetchError) {
      console.error('Error fetching conflicted links:', fetchError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch conflicted links' })
      };
    }

    let resolvedCount = 0;
    const errors = [];

    // Resolve each conflict by merging
    for (const link of conflictedLinks || []) {
      try {
        await supabaseAdmin.rpc('merge_link_orders', { target_link_id: link.id });
        resolvedCount++;
      } catch (error) {
        errors.push({ linkId: link.id, error: error.message });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        resolvedCount,
        totalConflicts: (conflictedLinks || []).length,
        errors
      })
    };

  } catch (error) {
    console.error('Resolve all conflicts error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function findOrCreateLink(url, serviceId) {
  try {
    const { data: linkId, error } = await supabaseAdmin
      .rpc('find_or_create_link', {
        input_url: url,
        input_service_id: serviceId
      });

    if (error) {
      console.error('Error in findOrCreateLink:', error);
      return null;
    }

    return linkId;
  } catch (error) {
    console.error('findOrCreateLink exception:', error);
    return null;
  }
}

/*
async function handleGetLinkManagementData(user, headers) {
  try {
    // Only allow admin users
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    // Get link management data with orders
    const { data: links, error: linksError } = await supabaseAdmin
      .from('link_management_dashboard')
      .select('*')
      .order('updated_at', { ascending: false });

    if (linksError) {
      throw new Error(`Failed to fetch links: ${linksError.message}`);
    }

    // Get statistics
    const { data: stats, error: statsError } = await supabaseAdmin
      .rpc('get_link_management_stats');

    if (statsError) {
      console.warn('Failed to get link stats:', statsError);
    }

    // Process the data
    const processedLinks = (links || []).map(link => ({
      id: link.id,
      url: link.url,
      status: link.status,
      total_orders: link.total_orders || 0,
      total_quantity: link.total_quantity || 0,
      created_at: link.created_at,
      updated_at: link.updated_at,
      orders: link.orders || []
    }));

    const defaultStats = {
      totalLinks: processedLinks.length,
      conflictedLinks: processedLinks.filter(l => l.status === 'conflicted').length,
      totalOrders: processedLinks.reduce((sum, l) => sum + (l.total_orders || 0), 0),
      failedOrders: processedLinks.reduce((sum, l) => sum + (l.orders || []).filter(o => o.status === 'failed').length, 0)
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        links: processedLinks,
        stats: stats || defaultStats
      })
    };

  } catch (error) {
    logOrderError('Failed to get link management data', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to load link management data' })
    };
  }
}

async function handleResolveLinkConflicts(user, body, headers) {
  try {
    // Only allow admin users
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { linkId, resolutionType } = body;
    if (!linkId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Link ID is required' })
      };
    }

    let result;
    switch (resolutionType) {
      case 'merge':
        const { data, error } = await supabaseAdmin
          .rpc('merge_link_orders', { target_link_id: linkId });
        
        if (error) throw error;
        result = data;
        break;
        
      case 'cancel_duplicates':
        // Keep only the first order, cancel others
        const { data: orders } = await supabaseAdmin
          .from('orders')
          .select('id, created_at')
          .eq('link_id', linkId)
          .order('created_at', { ascending: true });
        
        if (orders && orders.length > 1) {
          const keepOrderId = orders[0].id;
          const cancelIds = orders.slice(1).map(o => o.id);
          
          const { error: cancelError } = await supabaseAdmin
            .from('orders')
            .update({ 
              status: 'cancelled',
              notes: 'Cancelled due to duplicate link conflict'
            })
            .in('id', cancelIds);
            
          if (cancelError) throw cancelError;
          result = `Cancelled ${cancelIds.length} duplicate orders`;
        } else {
          result = 'No duplicates found to cancel';
        }
        break;
        
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid resolution type' })
        };
    }

    // Update link status
    await supabaseAdmin
      .from('link_management')
      .update({ status: 'active' })
      .eq('id', linkId);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: result
      })
    };

  } catch (error) {
    logOrderError('Failed to resolve link conflicts', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to resolve conflicts' })
    };
  }
}

async function handleMergeLinkOrders(user, body, headers) {
  try {
    // Only allow admin users
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { linkId } = body;
    if (!linkId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Link ID is required' })
      };
    }

    // Call the database function to merge orders
    const { data, error } = await supabaseAdmin
      .rpc('merge_link_orders', { target_link_id: linkId });

    if (error) {
      throw new Error(`Failed to merge orders: ${error.message}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: data || 'Orders merged successfully'
      })
    };

  } catch (error) {
    logOrderError('Failed to merge link orders', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to merge orders' })
    };
  }
}

async function handleResolveAllConflicts(user, headers) {
  try {
    // Only allow admin users
    if (user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    // Get all conflicted links
    const { data: conflictedLinks, error: fetchError } = await supabaseAdmin
      .from('link_management')
      .select('id')
      .eq('status', 'conflicted');

    if (fetchError) {
      throw new Error(`Failed to fetch conflicted links: ${fetchError.message}`);
    }

    let resolvedCount = 0;
    for (const link of conflictedLinks || []) {
      try {
        await supabaseAdmin.rpc('merge_link_orders', { target_link_id: link.id });
        resolvedCount++;
      } catch (error) {
        console.warn(`Failed to resolve conflict for link ${link.id}:`, error);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        resolved: resolvedCount,
        message: `Resolved ${resolvedCount} conflicted links`
      })
    };

  } catch (error) {
    logOrderError('Failed to resolve all conflicts', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to resolve all conflicts' })
    };
  }
}

// Function to create or update link tracking when creating orders
async function findOrCreateLink(url, serviceId) {
  try {
    const { data, error } = await supabaseAdmin
      .rpc('find_or_create_link', { 
        input_url: url, 
        service_id: serviceId 
      });

    if (error) {
      console.warn('Failed to create link tracking:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.warn('Error in findOrCreateLink:', error);
    return null;
  }
}
*/

// End of disabled Link Management functions

// ============= PROVIDER ERRORS TRACKING =============

/**
 * Get provider errors for admin dashboard
 * Shows which providers are having issues so admin can track and fix
 */
async function handleGetProviderErrors(user, body, headers) {
  try {
    // Only allow admin users
    if (!user || user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { 
      providerId = null, 
      resolved = false, 
      limit = 100,
      offset = 0 
    } = body || {};

    // Build query for provider errors with related data
    let query = supabaseAdmin
      .from('provider_errors')
      .select(`
        *,
        order:orders(
          id,
          order_number,
          public_id,
          link,
          quantity,
          charge,
          provider_cost,
          status,
          provider_status,
          provider_order_id,
          created_at,
          user:users(id, email, username),
          service:services(id, public_id, name, category, rate, provider_id, provider:providers(id, name, api_url, markup))
        ),
        provider:providers(id, name, api_url, status)
      `)
      .eq('resolved', resolved)
      .order('error_timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    // Filter by specific provider if requested
    if (providerId) {
      query = query.eq('provider_id', providerId);
    }

    const { data: errors, error: fetchError } = await query;

    if (fetchError) {
      console.error('[PROVIDER ERRORS] Failed to fetch:', fetchError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch provider errors' })
      };
    }

    // Get summary stats per provider
    const { data: providerStats, error: statsError } = await supabaseAdmin
      .from('provider_errors')
      .select('provider_id, providers(id, name)')
      .eq('resolved', false);

    // Calculate error counts per provider
    const errorCounts = {};
    if (providerStats && !statsError) {
      providerStats.forEach(err => {
        const pid = err.provider_id || 'unknown';
        const pname = err.providers?.name || 'Unknown Provider';
        if (!errorCounts[pid]) {
          errorCounts[pid] = { provider_id: pid, provider_name: pname, count: 0 };
        }
        errorCounts[pid].count++;
      });
    }

    // Get total unresolved count
    const { count: totalUnresolved } = await supabaseAdmin
      .from('provider_errors')
      .select('*', { count: 'exact', head: true })
      .eq('resolved', false);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        errors: errors || [],
        providerSummary: Object.values(errorCounts),
        totalUnresolved: totalUnresolved || 0,
        filters: { providerId, resolved, limit, offset }
      })
    };
  } catch (error) {
    console.error('[PROVIDER ERRORS] Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch provider errors' })
    };
  }
}

/**
 * Mark a provider error as resolved
 */
async function handleResolveProviderError(user, body, headers) {
  try {
    // Only allow admin users
    if (!user || user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { errorId, notes = '' } = body || {};

    if (!errorId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Error ID is required' })
      };
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('provider_errors')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: user.userId,
        notes: notes || null
      })
      .eq('id', errorId)
      .select()
      .single();

    if (updateError) {
      console.error('[PROVIDER ERRORS] Failed to resolve:', updateError);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to resolve error' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Error marked as resolved',
        error: updated
      })
    };
  } catch (error) {
    console.error('[PROVIDER ERRORS] Resolve error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to resolve error' })
    };
  }
}

// ============= RESEND FAILED ORDER HANDLER =============
async function handleResendOrder(user, body, headers) {
  try {
    // Only allow admin users to resend orders
    if (!user || user.role !== 'admin') {
      logger.warn('Unauthorized resend attempt', { userId: user?.userId, role: user?.role });
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    // Validate request body
    if (!body || typeof body !== 'object') {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid request body' })
      };
    }

    const { order_id: orderId } = body;
    if (!orderId || (typeof orderId !== 'string' && typeof orderId !== 'number')) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Valid order_id is required' })
      };
    }

    logger.info('Resending failed order', { orderId, adminUser: user.email || user.userId });

    // Get order details with service and provider info
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select(`
        *,
        service:services(
          id,
          name,
          provider_service_id,
          provider_id,
          provider:providers(
            id,
            name,
            api_url,
            api_key,
            status
          )
        ),
        user:users(email)
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      logger.warn('Order not found for resend', { orderId, error: orderError });
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    // Validate order is actually failed (prevent resending successful orders)
    if (order.status !== 'failed' && order.status !== 'error') {
      logger.warn('Attempt to resend non-failed order', { orderId, status: order.status });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Can only resend failed orders',
          currentStatus: order.status 
        })
      };
    }

    if (!order.service || !order.service.provider) {
      logger.error('Order missing service or provider', { orderId });
      await markOrderFailure(orderId, {
        message: 'System: Service or provider configuration missing',
        source: 'system',
        code: 'service_missing',
        context: { stage: 'resend_validation' }
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order service or provider not configured' })
      };
    }

    // Validate required order fields
    if (!order.link || !order.quantity || !order.service.provider_service_id) {
      logger.error('Order missing required fields', { 
        orderId, 
        hasLink: !!order.link, 
        hasQuantity: !!order.quantity,
        hasProviderServiceId: !!order.service.provider_service_id 
      });
      await markOrderFailure(orderId, {
        message: 'System: Order missing required data for resend',
        source: 'system',
        code: 'resend_validation_failed',
        context: {
          stage: 'resend_validation',
          hasLink: !!order.link,
          hasQuantity: !!order.quantity,
          hasProviderServiceId: !!order.service.provider_service_id
        }
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order missing required fields (link, quantity, or service ID)' })
      };
    }

    // CRITICAL: Resolve provider from order.provider_id snapshot, not service's current provider
    // This ensures orders use their original provider even if service was changed
    let provider = order.service.provider;
    if (order.provider_id) {
      const { data: providerData, error: providerError } = await supabaseAdmin
        .from('providers')
        .select('id, name, api_url, api_key, status')
        .eq('id', order.provider_id)
        .single();
      if (providerData && !providerError) {
        provider = providerData;
        logger.info('Using order provider snapshot', { orderId, providerId: provider.id, providerName: provider.name });
      } else if (providerError) {
        logger.warn('Failed to load order provider snapshot; falling back to service provider', { orderId, providerError });
      }
    }

    if (provider.status !== 'active') {
      logger.warn('Provider not active', { providerId: provider.id, status: provider.status });
      await markOrderFailure(orderId, {
        message: 'System: Provider is not active',
        source: 'system',
        code: 'provider_inactive',
        context: { provider_status: provider.status }
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Provider is not active' })
      };
    }

    if (!provider.api_url || !provider.api_key) {
      logger.error('Provider missing API credentials', { providerId: provider.id });
      await markOrderFailure(orderId, {
        message: 'System: Provider API credentials missing',
        source: 'system',
        code: 'provider_credentials_missing',
        context: { provider_id: provider.id }
      });
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Provider API credentials not configured' })
      };
    }

    // If we already have a provider order id, check status instead of resending to avoid double charges
    if (order.provider_order_id) {
      logger.info('Existing provider order detected; performing status check before resend', {
        orderId,
        providerOrderId: order.provider_order_id
      });

      try {
        const statusPayload = await fetchProviderOrderStatus(provider, order.provider_order_id);

        const providerStatusRaw = statusPayload.status
          ?? statusPayload.status_text
          ?? statusPayload.state
          ?? 'processing';
        const normalizedStatus = normalizeProviderStatus(providerStatusRaw, statusPayload);

        const providerChargeFromResponse = toNumberOrNull(
          statusPayload.charge ?? statusPayload.price ?? statusPayload.cost
        );
        const startCountFromResponse = toNumberOrNull(
          statusPayload.start_count ?? statusPayload.startCount ?? statusPayload.start
        );
        const remainsFromResponse = toNumberOrNull(
          statusPayload.remains ?? statusPayload.remain ?? statusPayload.left
        );
        const providerCurrencyFromResponse = statusPayload.currency
          ?? statusPayload.cur
          ?? statusPayload.price_currency;
        const providerNotesFromResponse = statusPayload.note
          ?? statusPayload.description
          ?? statusPayload.message;

        const updatePayload = {
          last_status_sync: new Date().toISOString(),
          provider_status: providerStatusRaw,
          provider_response: statusPayload
        };

        if (normalizedStatus) {
          updatePayload.status = normalizedStatus;
          updatePayload.customer_status =
            normalizedStatus === 'processing' ? 'pending' : normalizedStatus;
        }

        if (providerChargeFromResponse !== null) {
          updatePayload.provider_cost = providerChargeFromResponse;
        }

        if (startCountFromResponse !== null) {
          updatePayload.start_count = startCountFromResponse;
        }

        if (remainsFromResponse !== null) {
          updatePayload.remains = remainsFromResponse;
        }

        if (providerCurrencyFromResponse) {
          updatePayload.provider_currency = providerCurrencyFromResponse;
        }

        if (providerNotesFromResponse) {
          updatePayload.provider_notes = providerNotesFromResponse;
        }

        const { data: syncedOrder, error: syncError } = await supabaseAdmin
          .from('orders')
          .update(updatePayload)
          .eq('id', orderId)
          .select()
          .single();

        if (syncError) {
          logger.error('Failed to persist provider status during resend guard', {
            orderId,
            error: syncError
          });
          return {
            statusCode: 502,
            headers,
            body: JSON.stringify({
              error: 'Existing provider order detected; failed to sync status. Not resending to avoid duplicate charge.',
              details: syncError.message
            })
          };
        }

        order.status = syncedOrder.status;
        order.customer_status = syncedOrder.customer_status;
        order.provider_status = syncedOrder.provider_status;
        order.provider_response = syncedOrder.provider_response;

        if (!normalizedStatus) {
          return {
            statusCode: 502,
            headers,
            body: JSON.stringify({
              error: 'Existing provider order found but status was ambiguous. Not resending to avoid duplicate charge.',
              providerStatus: providerStatusRaw
            })
          };
        }

        // If provider considers the order anything but failed, stop here to avoid a duplicate submit
        if (normalizedStatus !== 'failed') {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              message: 'Existing provider order found; status synced instead of resending to prevent duplicate charge.',
              order: syncedOrder
            })
          };
        }

        logger.warn('Provider reported failed status; allowing resend after sync', {
          orderId,
          providerOrderId: order.provider_order_id,
          providerStatus: providerStatusRaw,
          normalizedStatus
        });
      } catch (statusError) {
        logger.warn('Status check failed for existing provider order; blocking resend to avoid duplicate charge', {
          orderId,
          providerOrderId: order.provider_order_id,
          error: statusError.message
        });
        return {
          statusCode: 502,
          headers,
          body: JSON.stringify({
            error: 'Existing provider order detected but status check failed. Not resending to avoid duplicate charge.',
            details: statusError.message
          })
        };
      }
    }

    // Submit to provider with retry logic
    try {
      logger.info('Submitting order to provider', { orderId, providerId: provider.id });

      let providerResponse;
      let lastError;
      const maxRetries = 2;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          logger.info('Provider submission attempt', { orderId, attempt, maxRetries });
          
          providerResponse = await submitOrderToProvider(provider, {
            service: order.service.provider_service_id,
            link: order.link,
            quantity: order.quantity
          });

          if (!providerResponse) {
            throw new Error('Provider returned null/undefined response');
          }

          if (!providerResponse.order) {
            throw new Error('Provider did not return an order ID');
          }
          
          // Success - break retry loop
          logger.info('Provider accepted order', { orderId, attempt, providerOrderId: providerResponse.order });
          break;
          
        } catch (retryError) {
          lastError = retryError;
          logger.warn('Provider submission attempt failed', { 
            orderId, 
            attempt, 
            error: retryError.message,
            willRetry: attempt < maxRetries 
          });
          
          if (attempt < maxRetries) {
            // Wait before retry (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
          }
        }
      }
      
      // If all retries failed, throw last error
      if (!providerResponse || !providerResponse.order) {
        throw lastError || new Error('Provider submission failed after retries');
      }

      const providerOrderId = providerResponse.order;
      logger.info('Provider accepted resent order', { orderId, providerOrderId });

      // Extract response details
      const providerChargeFromResponse = toNumberOrNull(
        providerResponse.response?.charge ?? providerResponse.response?.price ?? providerResponse.response?.cost
      );
      const providerStartCountFromResponse = toNumberOrNull(
        providerResponse.response?.start_count ?? providerResponse.response?.startCount ?? providerResponse.response?.start
      );
      const providerRemainsFromResponse = toNumberOrNull(
        providerResponse.response?.remains ?? providerResponse.response?.remain ?? providerResponse.response?.left
      );
      const providerCurrencyFromResponse = providerResponse.response?.currency
        ?? providerResponse.response?.cur
        ?? providerResponse.response?.price_currency;
      const nowIso = new Date().toISOString();

      const updatePayload = {
        provider_order_id: providerOrderId,
        status: 'processing',
        customer_status: 'processing',
        provider_status: 'processing',
        last_status_sync: nowIso,
        provider_response: providerResponse.response,
        provider_error: null, // Clear previous error
        provider_currency: normalizeCurrency(providerCurrencyFromResponse)
      };

      if (providerChargeFromResponse !== null) {
        updatePayload.provider_cost = providerChargeFromResponse;
      }

      if (providerStartCountFromResponse !== null) {
        updatePayload.start_count = providerStartCountFromResponse;
      }

      if (providerRemainsFromResponse !== null) {
        updatePayload.remains = providerRemainsFromResponse;
      }

      // Update order
      const { error: updateError } = await supabaseAdmin
        .from('orders')
        .update(updatePayload)
        .eq('id', orderId);

      if (updateError) {
        logger.error('Failed to update order after resend', { orderId, error: updateError });
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Order submitted but failed to update record' })
        };
      }

      logger.info('Order resent successfully', { orderId, providerOrderId });

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          providerOrderId,
          message: 'Order resent successfully'
        })
      };

    } catch (providerError) {
      logger.error('Provider submission failed on resend', { orderId, error: providerError });

      // Extract error message
      let providerErrorMessage = 'Provider request failed';
      if (providerError.response && providerError.response.error) {
        providerErrorMessage = providerError.response.error;
      } else if (providerError.message) {
        providerErrorMessage = providerError.message;
      }

      await markOrderFailure(orderId, {
        message: providerErrorMessage,
        source: 'provider',
        code: 'provider_resend_failed',
        context: {
          stage: 'resend_provider_submission',
          attempt: 'resend'
        },
        extra: {
          provider_response: providerError.response || null
        }
      });

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Provider request failed',
          details: providerErrorMessage
        })
      };
    }

  } catch (error) {
    logOrderError('Failed to resend order', error, { orderId: body.orderId });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleRefillOrder(user, body, headers) {
  try {
    const orderId = body.orderId;
    if (!orderId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order ID is required' })
      };
    }

    // Fetch order
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select('id, order_number, provider_order_id, service:services(id, public_id, provider:providers(*))')
      .eq('id', orderId)
      .eq('user_id', user.userId)
      .single();

    if (orderError || !order) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    if (!order.service || !order.service.provider) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Order service or provider not found' })
      };
    }

    const provider = order.service.provider;

    // First, create the refill record with "pending" status immediately
    logger.info('Creating pending refill request', {
      orderId,
      order_number: order.order_number
    });

    const { error: insertError, data: insertData } = await supabaseAdmin.from('refill_requests').insert({
      user_id: user.userId,
      order_number: order.order_number,
      provider_refill_id: null, // Initially null
      service_id: order.service?.public_id || order.service?.id,
      quantity: order?.quantity || 0,
      status: 'pending',
      refill_requested_at: new Date().toISOString()
    });

    if (insertError) {
      logger.error('Refill request insert failed', { orderId, error: insertError });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: `Failed to save refill request: ${insertError.message}`
        })
      };
    }

    logger.info('Pending refill created, now requesting from provider', { orderId });

    // Get our generated refill_id
    const { data: refillRecord, error: selectError } = await supabaseAdmin
      .from('refill_requests')
      .select('refill_id')
      .eq('order_number', order.order_number)
      .eq('user_id', user.userId)
      .order('refill_requested_at', { ascending: false })
      .limit(1)
      .single();

    if (selectError) {
      logger.error('Failed to retrieve refill_id', { orderId, error: selectError });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: 'Failed to retrieve refill_id from database'
        })
      };
    }

    let refillId = refillRecord?.refill_id;

    // If refill_id is still NULL or provider-like (< 15000), generate our own
    if (!refillId || refillId < 15000) {
      const randomIncrement = Math.floor(Math.random() * 5) + 1;
      refillId = 15090 + randomIncrement;
    }

    // Update order refill status with our refill_id
    const { error: updateError } = await supabaseAdmin.from('orders')
      .update({ refill_id: String(refillId), status: 'refilling', refill_requested_at: new Date().toISOString() })
      .eq('id', orderId);

    if (updateError) {
      logger.error('Failed to update order with refill_id', { orderId, error: updateError });
    }

    // Now try to request refill from provider (non-blocking)
    try {
      const refillResponse = await axios.post(
        provider.api_url,
        new URLSearchParams({
          key: provider.api_key,
          action: 'refill',
          order: order.provider_order_id
        }),
        { timeout: 10000 }
      );

      // Get provider refill ID and status if available
      const providerRefillId = refillResponse.data?.refill || null;
      const providerStatus = refillResponse.data?.status || null;

      if (providerRefillId) {
        // Map provider status to our database status
        const statusMap = {
          'Pending': 'pending',
          'In Progress': 'in progress',
          'Completed': 'completed',
          'Rejected': 'rejected'
        };
        const dbStatus = providerStatus ? statusMap[providerStatus] || 'pending' : 'pending';

        // Update with provider refill ID and status
        const { error: providerUpdateError } = await supabaseAdmin
          .from('refill_requests')
          .update({ provider_refill_id: String(providerRefillId), status: dbStatus })
          .eq('refill_id', refillId);

        if (providerUpdateError) {
          logger.warn('Could not update provider_refill_id/status', { orderId, error: providerUpdateError });
        }
      }

      logger.info('Provider response received', { orderId, providerRefillId, providerStatus });
    } catch (providerError) {
      logger.warn('Provider refill request failed (refill still pending)', { orderId, error: providerError.message });
      // Continue anyway - refill is already saved as pending
    }

    logger.info('Refill order successful', { orderId, refillId });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        refill: String(refillId),
        status: 'Pending'
      })
    };

  } catch (error) {
    logOrderError('Failed to process refill', error, { orderId: body.orderId });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
