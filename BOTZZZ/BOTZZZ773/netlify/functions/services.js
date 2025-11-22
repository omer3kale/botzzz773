
// Services API - Get, Create, Update, Delete Services
const { supabase, supabaseAdmin } = require('./utils/supabase');
const { withRateLimit } = require('./utils/rate-limit');
const { createLogger, serializeError } = require('./utils/logger');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const JWT_SECRET = process.env.JWT_SECRET;
const logger = createLogger('services');
const PUBLIC_ID_BASE = 7000;
const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

function logServiceError(message, error, meta) {
  logger.error(message, { error: serializeError(error), ...meta });
}

function normalizeProviderIdentifiers(service) {
  const rawServiceId = service?.provider_service_id
    ?? service?.provider_serviceID
    ?? service?.providerServiceId
    ?? service?.provider?.service_id
    ?? service?.provider?.serviceId
    ?? service?.provider?.serviceID
    ?? service?.provider_service_reference
    ?? service?.provider_reference
    ?? service?.providerServiceReference
    ?? null;

  const normalizedServiceId = rawServiceId === undefined || rawServiceId === null
    ? ''
    : String(rawServiceId).trim();

  const rawProviderOrderId = service?.provider_order_id
    ?? service?.providerOrderId
    ?? service?.provider_order
    ?? service?.meta?.provider_order_id
    ?? service?.meta?.providerOrderId
    ?? service?.provider?.order_id
    ?? service?.provider?.orderId
    ?? null;

  const normalizedProviderOrderId = rawProviderOrderId === undefined || rawProviderOrderId === null || rawProviderOrderId === ''
    ? normalizedServiceId
    : String(rawProviderOrderId).trim();

  return {
    providerServiceId: normalizedServiceId,
    providerOrderId: normalizedProviderOrderId
  };
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

  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function calculateMarkup(providerRate, retailRate) {
  if (!Number.isFinite(providerRate) || !Number.isFinite(retailRate) || providerRate <= 0) {
    return null;
  }

  const markup = ((retailRate - providerRate) / providerRate) * 100;
  return Number(markup.toFixed(2));
}

function toBooleanFlag(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value > 0;
  }

  const str = String(value).trim().toLowerCase();
  if (!str) {
    return false;
  }

  return ['1', 'true', 'yes', 'y', 'on', 'available'].includes(str);
}

function normalizeAverageTime(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const str = String(value).trim();
  return str.length > 0 ? str.slice(0, 100) : null;
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

function sanitizeSlugValue(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }

  const str = String(value).trim().toLowerCase();
  if (!str) {
    return fallback;
  }

  const sanitized = str
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized || fallback;
}

function isValidUuid(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed);
}

async function fetchDistinctCategoryNamesFromServices(queryClient) {
  try {
    const { data, error } = await queryClient
      .from('services')
      .select('category')
      .not('category', 'is', null)
      .neq('category', '')
      .order('category', { ascending: true });

    if (error) {
      throw error;
    }

    const seen = new Map();
    data.forEach(row => {
      const rawName = row?.category;
      if (!rawName) {
        return;
      }

      const trimmedName = String(rawName).trim();
      if (!trimmedName) {
        return;
      }

      const slug = sanitizeSlugValue(trimmedName, `category-${seen.size + 1}`);
      if (!slug || seen.has(slug)) {
        return;
      }

      seen.set(slug, {
        name: trimmedName,
        slug
      });
    });

    return Array.from(seen.values());
  } catch (error) {
    logServiceError('Fetch legacy service categories failed', error);
    return [];
  }
}

async function hydrateCategoriesFromExistingServices({ canInsert }) {
  const serviceQueryClient = canInsert ? supabaseAdmin : supabase;
  const distinctCategories = await fetchDistinctCategoryNamesFromServices(serviceQueryClient);

  if (!Array.isArray(distinctCategories) || distinctCategories.length === 0) {
    return { categories: [] };
  }

  const normalizedPayload = distinctCategories.map((category, index) => ({
    name: category.name,
    slug: category.slug,
    description: 'Imported from existing services',
    icon: 'fas fa-folder',
    display_order: index + 1,
    status: 'active'
  }));

  if (canInsert) {
    try {
      const { error } = await supabaseAdmin
        .from('service_categories')
        .upsert(normalizedPayload, { onConflict: 'slug' });

      if (error) {
        throw error;
      }

      return { inserted: true };
    } catch (error) {
      logServiceError('Hydrate categories insert error', error);
      return {
        categories: normalizedPayload.map(item => ({
          ...item,
          id: null,
          is_derived: true
        }))
      };
    }
  }

  return {
    categories: normalizedPayload.map(item => ({
      ...item,
      id: null,
      is_derived: true
    }))
  };
}

async function fetchMaxExistingPublicId() {
  try {
    const { data, error } = await supabaseAdmin
      .from('services')
      .select('public_id')
      .not('public_id', 'is', null)
      .order('public_id', { ascending: false })
      .limit(1);

    if (error) {
      throw error;
    }

    if (Array.isArray(data) && data.length > 0) {
      const numeric = toNumberOrNull(data[0]?.public_id);
      if (numeric !== null) {
        return Math.max(PUBLIC_ID_BASE - 1, numeric);
      }
    }

    return PUBLIC_ID_BASE - 1;
  } catch (error) {
    logServiceError('Failed to fetch max public ID', error);
    return PUBLIC_ID_BASE - 1;
  }
}

async function generateNextPublicId() {
  const maxId = await fetchMaxExistingPublicId();
  return maxId + 1;
}

async function ensurePublicIdsForAdmin(services = []) {
  if (!Array.isArray(services) || services.length === 0) {
    return services;
  }

  const needsAssignment = services.some(service => {
    const numeric = toNumberOrNull(service?.public_id);
    return numeric === null || numeric < PUBLIC_ID_BASE;
  });

  let maxPublicId = services.reduce((max, service) => {
    const numeric = toNumberOrNull(service?.public_id);
    return numeric !== null ? Math.max(max, numeric) : max;
  }, PUBLIC_ID_BASE - 1);

  if (!needsAssignment) {
    services.forEach(service => {
      const numeric = toNumberOrNull(service?.public_id);
      if (numeric !== null) {
        service.public_id = numeric;
      }
    });
    return services;
  }

  if (maxPublicId < PUBLIC_ID_BASE - 1) {
    maxPublicId = await fetchMaxExistingPublicId();
  }

  const updates = [];

  services.forEach(service => {
    const numeric = toNumberOrNull(service?.public_id);
    if (numeric === null || numeric < PUBLIC_ID_BASE) {
      maxPublicId = Math.max(maxPublicId, PUBLIC_ID_BASE - 1) + 1;
      service.public_id = maxPublicId;
      updates.push({ id: service.id, public_id: maxPublicId });
    } else {
      service.public_id = numeric;
    }
  });

  for (const update of updates) {
    const { error } = await supabaseAdmin
      .from('services')
      .update({ public_id: update.public_id })
      .eq('id', update.id);

    if (error) {
      logServiceError('Failed to assign public ID for service', error, { serviceId: update.id });
    }
  }

  return services;
}

const baseHandler = async (event) => {
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
  
  try {
    const body = JSON.parse(event.body || '{}');
    logger.info('Services request received', {
      method: event.httpMethod,
      path: event.path,
      userRole: user?.role || 'guest'
    });

    switch (event.httpMethod) {
      case 'GET':
        return await handleGetServices(event, user, headers);
      case 'POST':
        return await handleCreateService(user, body, headers);
      case 'PUT':
        return await handleUpdateService(user, body, headers);
      case 'DELETE':
        return await handleDeleteService(user, body, headers);
      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    logServiceError('Services API error', error, { method: event.httpMethod });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleGetServices(event, user, headers) {
  try {
    const queryParams = event?.queryStringParameters || {};
    
    // Check if requesting categories list
    if (queryParams.type === 'categories') {
      return await handleGetCategories(headers, user, queryParams);
    }
    
    const audienceParam = (queryParams.audience || queryParams.scope || '').toLowerCase();
    const wantsCustomerScope = audienceParam === 'customer';
    const wantsAdminScope = audienceParam === 'admin';
    const isAdminUser = user && user.role === 'admin';

    if (wantsAdminScope && !isAdminUser) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin scope requires administrator access' })
      };
    }

    const useAdminScope = isAdminUser && !wantsCustomerScope;
    const responseScope = useAdminScope ? 'admin' : 'customer';

    const queryClient = useAdminScope
      ? (hasServiceRoleKey ? supabaseAdmin : supabase)
      : supabase;

    if (useAdminScope && !hasServiceRoleKey) {
      logger.warn('Service role key missing. Admin queries will use anon client.');
    }

    let query = queryClient
      .from('services')
      .select(`
        *,
        provider:providers(id, name, status, markup)
      `);

    if (!useAdminScope) {
      // Customer scope: show ALL admin-curated services (unlimited)
      query = query
        .eq('status', 'active')
        .eq('admin_approved', true)
        .eq('customer_portal_enabled', true)
        .eq('provider.status', 'active')
        .order('customer_portal_slot', { ascending: true, nullsLast: true })
        .order('category', { ascending: true })
        .order('name', { ascending: true });
    } else {
      query = query
        .order('category', { ascending: true })
        .order('name', { ascending: true });
    }

    const { data: services, error } = await query;

    if (error) {
      logServiceError('Get services error', error);
      const errorPayload = { error: 'Failed to fetch services' };
      if (!error.message) {
        errorPayload.reason = String(error);
      }
      if (error.message) {
        errorPayload.reason = error.message;
      }
      if (error.details) {
        errorPayload.details = error.details;
      }
      if (error.hint) {
        errorPayload.hint = error.hint;
      }

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify(errorPayload)
      };
    }

    let normalizedServices = Array.isArray(services) ? services : [];

    if (useAdminScope) {
      normalizedServices = await ensurePublicIdsForAdmin(normalizedServices);
    } else {
      normalizedServices = normalizedServices
        .filter(service => {
          const numericPublicId = toNumberOrNull(service?.public_id ?? service?.publicId);
          if (numericPublicId === null) {
            return false;
          }

          service.public_id = numericPublicId;

          const status = String(service?.status || '').toLowerCase();
          const adminApproved = toBooleanFlag(service?.admin_approved ?? service?.adminApproved);
          const portalEnabled = toBooleanFlag(service?.customer_portal_enabled ?? service?.customerPortalEnabled);
          const portalSlotValue = toNumberOrNull(service?.customer_portal_slot ?? service?.customerPortalSlot);
          const providerStatus = String(service?.provider?.status || '').toLowerCase();
          const providerHealthy = !service?.provider || providerStatus === 'active';

          if (portalSlotValue !== null) {
            service.customer_portal_slot = portalSlotValue;
          }

          return (
            status === 'active' &&
            adminApproved &&
            portalEnabled &&
            providerHealthy
          );
        })
        .sort((a, b) => {
          const slotA = toNumberOrNull(a?.customer_portal_slot) ?? Number.MAX_SAFE_INTEGER;
          const slotB = toNumberOrNull(b?.customer_portal_slot) ?? Number.MAX_SAFE_INTEGER;
          if (slotA !== slotB) {
            return slotA - slotB;
          }

          const categoryA = String(a?.category || '').toLowerCase();
          const categoryB = String(b?.category || '').toLowerCase();
          if (categoryA !== categoryB) {
            return categoryA.localeCompare(categoryB);
          }

          const nameA = String(a?.name || '');
          const nameB = String(b?.name || '');
          return nameA.localeCompare(nameB);
        });
    }

    const servicesWithProviderIds = normalizedServices.map(service => {
      const clone = { ...service };
      const { providerServiceId, providerOrderId } = normalizeProviderIdentifiers(service);
      clone.provider_service_id = providerServiceId;
      clone.provider_order_id = providerOrderId;
      return clone;
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ scope: responseScope, services: servicesWithProviderIds })
    };
  } catch (error) {
    logServiceError('Get services error', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function fetchServicesFromProviders() {
  try {
    const { data: providers, error } = await supabaseAdmin
      .from('providers')
      .select('*')
      .eq('status', 'active');

    if (error) {
      logServiceError('Failed to load providers for fallback', error);
      return [];
    }

    if (!Array.isArray(providers) || !providers.length) {
      return [];
    }

    const allServices = [];

    for (const provider of providers) {
      if (!provider?.api_url || !provider?.api_key) {
        continue;
      }

      try {
        const params = new URLSearchParams();
        params.append('key', provider.api_key);
        params.append('action', 'services');

        const response = await axios.post(provider.api_url, params, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 20000
        });

        if (!Array.isArray(response.data)) {
          logger.warn('Provider returned unexpected format', { provider: provider.name });
          continue;
        }

        const providerServices = response.data
          .map((service) => normalizeProviderService(provider, service))
          .filter(Boolean);

        allServices.push(...providerServices);
      } catch (providerError) {
        logServiceError('Failed to fetch services from provider', providerError, { provider: provider.name });
      }
    }

    return allServices.filter((service) => service.status === 'active');
  } catch (fallbackError) {
    logServiceError('Fallback provider load failed', fallbackError);
    return [];
  }
}

function normalizeProviderService(provider, rawService) {
  if (!rawService || typeof rawService !== 'object') {
    return null;
  }

  const toNumber = (value, fallback = null) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const minQuantity = toNumber(rawService.min) ?? toNumber(rawService.min_order) ?? 1;
  const maxQuantity = toNumber(rawService.max) ?? toNumber(rawService.max_order) ?? 100000;
  const rate = toNumber(rawService.rate ?? rawService.price, 0);

  const rawStatus = rawService.status ? String(rawService.status).toLowerCase() : 'active';
  const normalizedStatus = ['active', 'enabled', 'running'].includes(rawStatus) ? 'active' : 'inactive';

  const averageTime = normalizeAverageTime(
    rawService.average_time ?? rawService.avg_time ?? rawService.time ?? rawService.expected_time
  );

  const currency = normalizeCurrency(
    rawService.currency ?? rawService.price_currency ?? rawService.rate_currency ?? rawService.cur
  );

  return {
    id: `${provider.id || provider.name}:${rawService.service || rawService.id || rawService.name}`,
    provider_id: provider.id || null,
    provider_service_id: String(rawService.service ?? rawService.id ?? rawService.name ?? ''),
    name: String(rawService.name || rawService.service || 'Untitled Service'),
    category: String(rawService.category || 'General'),
    type: String(rawService.type || 'default'),
    rate,
    provider_rate: toNumber(rawService.rate),
    retail_rate: rate,
    markup_percentage: provider.markup,
    min_quantity: minQuantity,
    max_quantity: maxQuantity,
    description: String(rawService.description || rawService.desc || ''),
    status: normalizedStatus,
    currency,
    average_time: averageTime,
    refill_supported: toBooleanFlag(rawService.refill ?? rawService.refill_support ?? rawService.needs_refill),
    cancel_supported: toBooleanFlag(rawService.cancel ?? rawService.cancel_support ?? rawService.cancellable),
    dripfeed_supported: toBooleanFlag(rawService.dripfeed ?? rawService.drip_feed ?? rawService.drip),
    subscription_supported: toBooleanFlag(rawService.subscription ?? rawService.subscriptions ?? rawService.subscription_supported),
    provider_metadata: rawService,
    provider: {
      id: provider.id,
      name: provider.name,
      status: provider.status,
      markup: provider.markup
    }
  };
}

async function handleCreateService(user, data, headers) {
  try {
    // Only admins can create services
    if (!user || user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { action } = data;

    // Handle different create actions
    if (action === 'create-category') {
      return await handleCreateCategory(data, headers);
    }

    if (action === 'update-category') {
      return await handleUpdateCategory(data, headers);
    }

    if (action === 'delete-category') {
      return await handleDeleteCategory(data, headers);
    }

    if (action === 'duplicate') {
      return await handleDuplicateService(data, headers);
    }

    const {
      providerId,
      providerServiceId,
      name,
      category,
      description,
      rate,
      price,
  provider_rate,
      providerRate,
      retail_rate,
      retailRate,
      markup_percentage,
      markupPercentage,
      min_quantity,
      minOrder,
      max_quantity,
      maxOrder,
      type,
      status,
      public_id,
      publicId,
      average_time: average_time_field,
      averageTime,
      currency: currencyField,
      refill_supported,
      refillSupported,
      cancel_supported,
      cancelSupported,
      dripfeed_supported,
      dripfeedSupported,
      subscription_supported,
      subscriptionSupported,
      admin_approved,
      adminApproved,
      admin_visibility_notes,
      adminVisibilityNotes,
      customer_portal_enabled,
      customerPortalEnabled,
      customer_portal_slot,
      customerPortalSlot,
      customer_portal_notes,
      customerPortalNotes
    } = data;

    if (!name || !category) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    const providerRateInput = provider_rate ?? providerRate;
    const retailRateInput = retail_rate ?? retailRate ?? rate ?? price;
    const fallbackRetailInput = rate ?? price ?? 0;

    const numericProviderRate = toNumberOrNull(providerRateInput);
    const numericRetailRate = toNumberOrNull(retailRateInput);
    const numericFallbackRetail = toNumberOrNull(fallbackRetailInput) ?? 0;

    const resolvedRetailRate = numericRetailRate ?? numericFallbackRetail;
    const manualMarkup = toNumberOrNull(markup_percentage ?? markupPercentage);
    const resolvedMarkup = manualMarkup ?? calculateMarkup(numericProviderRate, resolvedRetailRate);

    const minQty = min_quantity ?? minOrder ?? 10;
    const maxQty = max_quantity ?? maxOrder ?? 100000;

    const normalizedAverageTime = normalizeAverageTime(average_time_field ?? averageTime);
    const normalizedCurrency = normalizeCurrency(currencyField);
    const normalizedRefillFlag = toBooleanFlag(refill_supported ?? refillSupported);
    const normalizedCancelFlag = toBooleanFlag(cancel_supported ?? cancelSupported);
    const normalizedDripfeedFlag = toBooleanFlag(dripfeed_supported ?? dripfeedSupported);
    const normalizedSubscriptionFlag = toBooleanFlag(subscription_supported ?? subscriptionSupported);
  const adminApprovalRaw = admin_approved ?? adminApproved;
  const adminApprovedFlag = adminApprovalRaw !== undefined ? toBooleanFlag(adminApprovalRaw) : false;
  const adminVisibilityNotesValue = admin_visibility_notes ?? adminVisibilityNotes ?? null;
  const adminApprovedAtValue = adminApprovedFlag ? new Date().toISOString() : null;
  const adminApprovedByValue = adminApprovedFlag ? (user.userId || null) : null;
  const customerPortalEnabledRaw = customer_portal_enabled ?? customerPortalEnabled;
  const customerPortalEnabledFlag = customerPortalEnabledRaw !== undefined ? toBooleanFlag(customerPortalEnabledRaw) : false;
  const customerPortalSlotValue = toNumberOrNull(customer_portal_slot ?? customerPortalSlot);
  const customerPortalNotesValue = customer_portal_notes ?? customerPortalNotes ?? null;

    let resolvedPublicId = toNumberOrNull(public_id ?? publicId);
    if (resolvedPublicId === null || resolvedPublicId < PUBLIC_ID_BASE) {
      resolvedPublicId = await generateNextPublicId();
    }
    resolvedPublicId = Math.trunc(resolvedPublicId);

    const { data: service, error } = await supabaseAdmin
      .from('services')
      .insert({
        provider_id: providerId || null,
        provider_service_id: providerServiceId || null,
        name,
        category,
        description: description || '',
        rate: resolvedRetailRate,
        provider_rate: numericProviderRate,
        retail_rate: resolvedRetailRate,
        markup_percentage: resolvedMarkup,
        min_quantity: minQty,
        max_quantity: maxQty,
        type: type || 'service',
        status: status || 'active',
        public_id: resolvedPublicId,
        average_time: normalizedAverageTime,
        currency: normalizedCurrency,
        refill_supported: normalizedRefillFlag,
        cancel_supported: normalizedCancelFlag,
        dripfeed_supported: normalizedDripfeedFlag,
        subscription_supported: normalizedSubscriptionFlag,
        admin_approved: adminApprovedFlag,
        admin_approved_at: adminApprovedAtValue,
        admin_approved_by: adminApprovedByValue,
        admin_visibility_notes: adminVisibilityNotesValue,
        customer_portal_enabled: customerPortalEnabledFlag,
        customer_portal_slot: customerPortalSlotValue,
        customer_portal_notes: customerPortalNotesValue
      })
      .select()
      .single();

    if (error) {
      logServiceError('Create service validation error', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create service' })
      };
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        service
      })
    };
  } catch (error) {
    logServiceError('Create service error', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleUpdateService(user, data, headers) {
  try {
    // Only admins can update services
    if (!user || user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const {
      serviceId,
      name,
      category,
      rate,
      price,
      provider_rate,
      providerRate,
      retail_rate,
      retailRate,
      markup_percentage,
      markupPercentage,
      min_quantity,
      max_quantity,
      description,
      status,
      type,
      providerId,
      provider_id,
      providerServiceId,
      provider_service_id,
      public_id,
      publicId,
      average_time: average_time_field,
      averageTime,
      currency: currencyField,
      refill_supported,
      refillSupported,
      cancel_supported,
      cancelSupported,
      dripfeed_supported,
      dripfeedSupported,
      subscription_supported,
      subscriptionSupported,
      admin_approved,
      adminApproved,
      admin_visibility_notes,
      adminVisibilityNotes,
      customer_portal_enabled,
      customerPortalEnabled,
      customer_portal_slot,
      customerPortalSlot,
      customer_portal_notes,
      customerPortalNotes
    } = data;

    if (!serviceId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service ID is required' })
      };
    }

    // Build update object with proper field names
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (min_quantity !== undefined) updates.min_quantity = min_quantity;
    if (max_quantity !== undefined) updates.max_quantity = max_quantity;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (type !== undefined) updates.type = type;

    const hasAverageTimeField = Object.prototype.hasOwnProperty.call(data, 'average_time') ||
      Object.prototype.hasOwnProperty.call(data, 'averageTime');
    if (hasAverageTimeField) {
      updates.average_time = normalizeAverageTime(average_time_field ?? averageTime);
    }

    const hasCurrencyField = Object.prototype.hasOwnProperty.call(data, 'currency');
    if (hasCurrencyField) {
      updates.currency = normalizeCurrency(currencyField);
    }

    const hasRefillField = Object.prototype.hasOwnProperty.call(data, 'refill_supported') ||
      Object.prototype.hasOwnProperty.call(data, 'refillSupported');
    if (hasRefillField) {
      updates.refill_supported = toBooleanFlag(refill_supported ?? refillSupported);
    }

    const hasCancelField = Object.prototype.hasOwnProperty.call(data, 'cancel_supported') ||
      Object.prototype.hasOwnProperty.call(data, 'cancelSupported');
    if (hasCancelField) {
      updates.cancel_supported = toBooleanFlag(cancel_supported ?? cancelSupported);
    }

    const hasDripfeedField = Object.prototype.hasOwnProperty.call(data, 'dripfeed_supported') ||
      Object.prototype.hasOwnProperty.call(data, 'dripfeedSupported');
    if (hasDripfeedField) {
      updates.dripfeed_supported = toBooleanFlag(dripfeed_supported ?? dripfeedSupported);
    }

    const hasSubscriptionField = Object.prototype.hasOwnProperty.call(data, 'subscription_supported') ||
      Object.prototype.hasOwnProperty.call(data, 'subscriptionSupported');
    if (hasSubscriptionField) {
      updates.subscription_supported = toBooleanFlag(subscription_supported ?? subscriptionSupported);
    }

    const hasAdminVisibilityNotesField = Object.prototype.hasOwnProperty.call(data, 'admin_visibility_notes') ||
      Object.prototype.hasOwnProperty.call(data, 'adminVisibilityNotes');
    if (hasAdminVisibilityNotesField) {
      const noteValue = admin_visibility_notes ?? adminVisibilityNotes;
      updates.admin_visibility_notes = noteValue === undefined ? null : noteValue;
    }

    const hasAdminApprovedField = Object.prototype.hasOwnProperty.call(data, 'admin_approved') ||
      Object.prototype.hasOwnProperty.call(data, 'adminApproved');
    if (hasAdminApprovedField) {
      const approvedFlag = toBooleanFlag(admin_approved ?? adminApproved);
      updates.admin_approved = approvedFlag;
      if (approvedFlag) {
        updates.admin_approved_at = new Date().toISOString();
        updates.admin_approved_by = user.userId || null;
      } else {
        updates.admin_approved_at = null;
        updates.admin_approved_by = null;
      }
    }

    const hasCustomerPortalEnabledField = Object.prototype.hasOwnProperty.call(data, 'customer_portal_enabled') ||
      Object.prototype.hasOwnProperty.call(data, 'customerPortalEnabled');
    if (hasCustomerPortalEnabledField) {
      updates.customer_portal_enabled = toBooleanFlag(customer_portal_enabled ?? customerPortalEnabled);
    }

    const hasCustomerPortalSlotField = Object.prototype.hasOwnProperty.call(data, 'customer_portal_slot') ||
      Object.prototype.hasOwnProperty.call(data, 'customerPortalSlot');
    if (hasCustomerPortalSlotField) {
      const slotValue = toNumberOrNull(customer_portal_slot ?? customerPortalSlot);
      updates.customer_portal_slot = slotValue;
    }

    const hasCustomerPortalNotesField = Object.prototype.hasOwnProperty.call(data, 'customer_portal_notes') ||
      Object.prototype.hasOwnProperty.call(data, 'customerPortalNotes');
    if (hasCustomerPortalNotesField) {
      const portalNoteValue = customer_portal_notes ?? customerPortalNotes;
      updates.customer_portal_notes = portalNoteValue === undefined ? null : portalNoteValue;
    }

    const hasProviderRateField = Object.prototype.hasOwnProperty.call(data, 'provider_rate') ||
      Object.prototype.hasOwnProperty.call(data, 'providerRate');
    const hasRetailRateField = Object.prototype.hasOwnProperty.call(data, 'retail_rate') ||
      Object.prototype.hasOwnProperty.call(data, 'retailRate') ||
      Object.prototype.hasOwnProperty.call(data, 'rate') ||
      Object.prototype.hasOwnProperty.call(data, 'price');
    const hasMarkupField = Object.prototype.hasOwnProperty.call(data, 'markup_percentage') ||
      Object.prototype.hasOwnProperty.call(data, 'markupPercentage');

    const providerRateInput = provider_rate ?? providerRate;
    const retailRateInput = retail_rate ?? retailRate ?? rate ?? price;
    const fallbackRetailInput = rate ?? price;

    const numericProviderRate = toNumberOrNull(providerRateInput);
    const numericRetailRate = toNumberOrNull(retailRateInput);
    const numericFallbackRetail = toNumberOrNull(fallbackRetailInput);

    const resolvedRetailRate = numericRetailRate ?? numericFallbackRetail;
    if (resolvedRetailRate !== null) {
      updates.rate = resolvedRetailRate;
      updates.retail_rate = resolvedRetailRate;
    } else if (hasRetailRateField) {
      updates.rate = null;
      updates.retail_rate = null;
    }

    if (numericProviderRate !== null) {
      updates.provider_rate = numericProviderRate;
    } else if (hasProviderRateField) {
      updates.provider_rate = null;
    }

    let shouldUpdateMarkup = false;
    let resolvedMarkup = null;

    if (hasMarkupField) {
      resolvedMarkup = toNumberOrNull(markup_percentage ?? markupPercentage);
      shouldUpdateMarkup = true;
    } else {
      const autoMarkup = calculateMarkup(numericProviderRate, resolvedRetailRate);
      if (autoMarkup !== null) {
        resolvedMarkup = autoMarkup;
        shouldUpdateMarkup = true;
      }
    }

    if (shouldUpdateMarkup) {
      updates.markup_percentage = resolvedMarkup;
    }

    const resolvedProviderId = providerId !== undefined ? providerId : provider_id;
    if (resolvedProviderId !== undefined) {
      updates.provider_id = resolvedProviderId || null;
    }

    const resolvedProviderServiceId = providerServiceId !== undefined ? providerServiceId : provider_service_id;
    if (resolvedProviderServiceId !== undefined) {
      updates.provider_service_id = resolvedProviderServiceId || null;
    }

    const hasPublicIdField = Object.prototype.hasOwnProperty.call(data, 'public_id') ||
      Object.prototype.hasOwnProperty.call(data, 'publicId');

    if (hasPublicIdField) {
      const incomingPublicId = toNumberOrNull(public_id ?? publicId);
      if (incomingPublicId !== null && incomingPublicId >= PUBLIC_ID_BASE) {
        updates.public_id = Math.trunc(incomingPublicId);
      }
    }

    const { data: service, error } = await supabaseAdmin
      .from('services')
      .update(updates)
      .eq('id', serviceId)
      .select()
      .single();

    if (error) {
      logServiceError('Update service validation error', error, { serviceId: body.id });
      const payload = { error: 'Failed to update service' };
      try {
        if (error && typeof error === 'object') {
          if (error.message) payload.message = error.message;
          if (error.details) payload.details = error.details;
          if (error.hint) payload.hint = error.hint;
          if (error.code) payload.code = error.code;
        } else if (error) {
          payload.details = String(error);
        }
      } catch (e) {
        payload.details = 'Failed to serialize error';
      }

      return {
        statusCode: 500,
        headers,
        body: JSON.stringify(payload)
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        service
      })
    };
  } catch (error) {
    logServiceError('Update service error', error, { serviceId: body?.id });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleDeleteService(user, data, headers) {
  try {
    // Only admins can delete services
    if (!user || user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { serviceId } = data;

    if (!serviceId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service ID is required' })
      };
    }

    const { error } = await supabaseAdmin
      .from('services')
      .delete()
      .eq('id', serviceId);

    if (error) {
      logServiceError('Delete service validation error', error, { serviceId: body.id });
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to delete service' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    logServiceError('Delete service error', error, { serviceId: body?.id });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleGetCategories(headers, user, queryParams = {}) {
  try {
    const isAdminUser = user?.role === 'admin';
    const requestedStatusRaw = (queryParams.status || '').toString().trim().toLowerCase();
    const wantsInactiveOnly = requestedStatusRaw === 'inactive';
    const wantsAllStatuses = requestedStatusRaw === 'all' || (!requestedStatusRaw && isAdminUser);
    const allowDerivedForRequest = !wantsInactiveOnly;
    const canBypassRls = isAdminUser && hasServiceRoleKey;

    const queryClient = canBypassRls ? supabaseAdmin : supabase;

    if (isAdminUser && !hasServiceRoleKey) {
      logger.warn('Service role key missing. Category admin queries limited to active items.');
    }

    const runCategoriesQuery = () => {
      let query = queryClient
        .from('service_categories')
        .select('*')
        .order('display_order', { ascending: true })
        .order('name', { ascending: true });

      if (!canBypassRls || (!wantsAllStatuses && !wantsInactiveOnly)) {
        query = query.eq('status', 'active');
      } else if (wantsInactiveOnly) {
        query = query.eq('status', 'inactive');
      }

      return query;
    };

    const { data, error } = await runCategoriesQuery();
    let categories = Array.isArray(data) ? data : [];
    const tableMissing = error && String(error.code) === '42P01';

    if (tableMissing) {
      logServiceError('service_categories table missing, attempting hydration', error);
    } else if (error && !tableMissing) {
      throw error;
    }

    const needsHydration = (!Array.isArray(categories) || categories.length === 0) && allowDerivedForRequest;

    if (needsHydration) {
      const hydration = await hydrateCategoriesFromExistingServices({ canInsert: canBypassRls });

      if (hydration.inserted) {
        const retry = await runCategoriesQuery();
        categories = Array.isArray(retry.data) ? retry.data : [];
      } else if (Array.isArray(hydration.categories) && hydration.categories.length > 0) {
        categories = hydration.categories;
      }
    } else if (!allowDerivedForRequest && (!Array.isArray(categories) || categories.length === 0)) {
      categories = [];
    }

    if (!Array.isArray(categories)) {
      categories = [];
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        categories
      })
    };
  } catch (error) {
    logServiceError('Get categories error', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch categories' })
    };
  }
}

async function handleCreateCategory(data, headers) {
  try {
    const {
      name,
      description,
      icon,
      slug: slugInput,
      status,
      display_order,
      displayOrder,
      parent_id,
      parentId
    } = data;

    const trimmedName = name?.trim();

    if (!trimmedName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Category name is required' })
      };
    }

    const slugSource = slugInput?.trim() || trimmedName;
    const slug = sanitizeSlugValue(slugSource, `category-${Date.now()}`);
    const sanitizedDescription = description?.trim() || null;
    const sanitizedIcon = icon?.trim() || 'fas fa-folder';
    const displayOrderValue = toNumberOrNull(display_order ?? displayOrder);
    const normalizedStatus = (status || 'active').toString().trim().toLowerCase();
    const statusValue = normalizedStatus === 'inactive' ? 'inactive' : 'active';
    const parentIdentifier = parent_id ?? parentId;
    const parentIdValue = isValidUuid(parentIdentifier) ? parentIdentifier.trim() : null;

    const categoryPayload = {
      name: trimmedName,
      slug,
      description: sanitizedDescription,
      icon: sanitizedIcon,
      status: statusValue
    };

    if (displayOrderValue !== null) {
      categoryPayload.display_order = Math.max(1, Math.trunc(displayOrderValue));
    }

    if (parentIdValue) {
      categoryPayload.parent_id = parentIdValue;
    }

    const { data: category, error } = await supabaseAdmin
      .from('service_categories')
      .insert(categoryPayload)
      .select()
      .single();

    if (error) {
      logServiceError('Create category database error', error, { categoryName: trimmedName });
      if (error.code === '23505') {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Category with this name already exists' })
        };
      }
      throw error;
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Category "${trimmedName}" created successfully`,
        category
      })
    };
  } catch (error) {
    logServiceError('Create category error', error, { categoryName: data?.name });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create category' })
    };
  }
}

async function handleUpdateCategory(data, headers) {
  try {
    const categoryId = data?.categoryId || data?.id || null;
    const slugIdentifierSource = data?.categorySlug || (!categoryId ? data?.slug : null) || null;
    const slugIdentifier = slugIdentifierSource
      ? sanitizeSlugValue(slugIdentifierSource, slugIdentifierSource)
      : null;

    if (!categoryId && !slugIdentifier) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Category identifier (id or slug) is required' })
      };
    }

    const updates = {};

    if (Object.prototype.hasOwnProperty.call(data, 'name')) {
      const trimmedName = data.name?.toString().trim();
      if (!trimmedName) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Category name cannot be empty' })
        };
      }
      updates.name = trimmedName;
      if (!Object.prototype.hasOwnProperty.call(data, 'slug') && !Object.prototype.hasOwnProperty.call(data, 'newSlug')) {
        const derivedSlug = sanitizeSlugValue(trimmedName, '');
        if (derivedSlug) {
          updates.slug = derivedSlug;
        }
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'slug') || Object.prototype.hasOwnProperty.call(data, 'newSlug')) {
      const rawSlug = Object.prototype.hasOwnProperty.call(data, 'slug') ? data.slug : data.newSlug;
      const sanitized = sanitizeSlugValue(rawSlug, `category-${Date.now()}`);
      if (sanitized) {
        updates.slug = sanitized;
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'description')) {
      const descriptionValue = data.description?.toString().trim() || null;
      updates.description = descriptionValue;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'icon')) {
      updates.icon = data.icon?.toString().trim() || 'fas fa-folder';
    }

    const displayOrderInput = data.display_order ?? data.displayOrder;
    if (displayOrderInput !== undefined) {
      const displayOrderValue = toNumberOrNull(displayOrderInput);
      if (displayOrderValue !== null) {
        updates.display_order = Math.max(1, Math.trunc(displayOrderValue));
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'status')) {
      const normalizedStatus = (data.status || '').toString().trim().toLowerCase();
      if (['active', 'inactive'].includes(normalizedStatus)) {
        updates.status = normalizedStatus;
      }
    }

    if (Object.prototype.hasOwnProperty.call(data, 'parent_id') || Object.prototype.hasOwnProperty.call(data, 'parentId')) {
      const parentValue = data.parent_id ?? data.parentId;
      if (!parentValue) {
        updates.parent_id = null;
      } else if (isValidUuid(parentValue)) {
        updates.parent_id = parentValue.trim();
      }
    }

    if (Object.keys(updates).length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No category changes provided' })
      };
    }

    let updateQuery = supabaseAdmin
      .from('service_categories')
      .update(updates)
      .select()
      .maybeSingle();

    if (categoryId) {
      updateQuery = updateQuery.eq('id', categoryId);
    } else if (slugIdentifier) {
      updateQuery = updateQuery.eq('slug', slugIdentifier);
    }

    const { data: category, error } = await updateQuery;

    if (error || !category) {
      logServiceError('Update category database error', error, { categoryId, slug: slugIdentifier });
      const statusCode = error?.code === 'PGRST116' ? 404 : 500;
      return {
        statusCode,
        headers,
        body: JSON.stringify({ error: statusCode === 404 ? 'Category not found' : 'Failed to update category' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, category })
    };
  } catch (error) {
    logServiceError('Update category error', error, { categoryId: data?.categoryId, slug: data?.slug });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to update category' })
    };
  }
}

async function handleDeleteCategory(data, headers) {
  try {
    const categoryId = data?.categoryId || data?.id || null;
    const slugIdentifierSource = data?.categorySlug || (!categoryId ? data?.slug : null) || null;
    const slugIdentifier = slugIdentifierSource
      ? sanitizeSlugValue(slugIdentifierSource, slugIdentifierSource)
      : null;

    if (!categoryId && !slugIdentifier) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Category identifier (id or slug) is required' })
      };
    }

    const hardDeleteFlag = toBooleanFlag(
      data?.hard_delete ??
      data?.hardDelete ??
      data?.permanent ??
      data?.force ??
      (data?.mode && String(data.mode).toLowerCase() === 'hard')
    );

    let mutationQuery = supabaseAdmin
      .from('service_categories');

    if (hardDeleteFlag) {
      mutationQuery = mutationQuery.delete();
    } else {
      mutationQuery = mutationQuery.update({ status: 'inactive' });
    }

    mutationQuery = mutationQuery.select().maybeSingle();

    if (categoryId) {
      mutationQuery = mutationQuery.eq('id', categoryId);
    } else if (slugIdentifier) {
      mutationQuery = mutationQuery.eq('slug', slugIdentifier);
    }

    const { data: category, error } = await mutationQuery;

    if (error || !category) {
      logServiceError('Delete category database error', error, { categoryId, slug: slugIdentifier });
      const statusCode = error?.code === 'PGRST116' ? 404 : 500;
      return {
        statusCode,
        headers,
        body: JSON.stringify({ error: statusCode === 404 ? 'Category not found' : 'Failed to delete category' })
      };
    }

    const message = hardDeleteFlag ? 'Category permanently deleted' : 'Category archived successfully';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message, category })
    };
  } catch (error) {
    logServiceError('Delete category error', error, { categoryId: data?.categoryId, slug: data?.slug });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to delete category' })
    };
  }
}

async function handleDuplicateService(data, headers) {
  try {
    const { serviceId } = data;

    // Get the original service
    const { data: originalService, error: fetchError } = await supabaseAdmin
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .single();

    if (fetchError || !originalService) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Service not found' })
      };
    }

    const newPublicId = await generateNextPublicId();

    // Create duplicate with modified name
    const { data: newService, error: insertError } = await supabaseAdmin
      .from('services')
      .insert({
        provider_id: originalService.provider_id,
        provider_service_id: originalService.provider_service_id,
        provider_order_id: originalService.provider_order_id,
        name: `${originalService.name} (Copy)`,
        category: originalService.category,
        description: originalService.description,
        rate: originalService.rate,
        provider_rate: originalService.provider_rate,
        retail_rate: originalService.retail_rate,
        markup_percentage: originalService.markup_percentage,
        min_quantity: originalService.min_quantity,
        max_quantity: originalService.max_quantity,
        type: originalService.type,
        status: 'inactive', // New duplicates start as inactive
        public_id: newPublicId,
        currency: originalService.currency,
        average_time: originalService.average_time,
        refill_supported: originalService.refill_supported,
        cancel_supported: originalService.cancel_supported,
        dripfeed_supported: originalService.dripfeed_supported,
        subscription_supported: originalService.subscription_supported,
        provider_metadata: originalService.provider_metadata
      })
      .select()
      .single();

    if (insertError) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to duplicate service' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        service: newService
      })
    };
  } catch (error) {
    logServiceError('Duplicate service error', error, { serviceId: body?.serviceId });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to duplicate service' })
    };
  }
}


const SERVICES_RATE_LIMIT = {
  route: 'services',
  limit: 300,
  windowSeconds: 60,
  identifierExtractor: (event) => {
    const headers = event?.headers || {};
    const authHeader = headers.Authorization || headers.authorization;
    const user = getUserFromToken(authHeader);
    return user?.userId ? `user:${user.userId}` : null;
  }
};

exports.handler = withRateLimit(SERVICES_RATE_LIMIT, baseHandler);

