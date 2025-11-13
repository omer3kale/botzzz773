
// Services API - Get, Create, Update, Delete Services
const { supabase, supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const JWT_SECRET = process.env.JWT_SECRET;
const PUBLIC_ID_BASE = 7000;
const hasServiceRoleKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

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
    console.error('Failed to fetch max public ID:', error);
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
      console.error('Failed to assign public ID for service', update.id, error);
    }
  }

  return services;
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
  
  try {
    const body = JSON.parse(event.body || '{}');

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
    console.error('Services API error:', error);
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
    const audienceParam = (queryParams.audience || queryParams.scope || '').toLowerCase();
    const forceCustomerScope = audienceParam === 'customer';

    const isAdminUser = user && user.role === 'admin' && !forceCustomerScope;

    const queryClient = isAdminUser
      ? (hasServiceRoleKey ? supabaseAdmin : supabase)
      : supabase;

    if (isAdminUser && !hasServiceRoleKey) {
      console.warn('[SERVICES] Service role key missing. Admin queries will use anon client.');
    }

    let query = queryClient
      .from('services')
      .select(`
        *,
        provider:providers!inner(id, name, status, markup)
      `);

    if (!isAdminUser) {
      // For customer scope (default) only show services explicitly active and from active providers
      query = query
        .eq('status', 'active')
        .eq('provider.status', 'active');
    }

    query = query
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    const { data: services, error } = await query;

    if (error) {
      console.error('Get services error:', error);
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

    if (isAdminUser) {
      normalizedServices = await ensurePublicIdsForAdmin(normalizedServices);
    } else {
      normalizedServices = normalizedServices.filter(service => {
        const numeric = toNumberOrNull(service?.public_id ?? service?.publicId);
        if (numeric !== null) {
          service.public_id = numeric;
          return true;
        }
        return false;
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ services: normalizedServices })
    };
  } catch (error) {
    console.error('Get services error:', error);
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
      console.error('[SERVICES] Failed to load providers for fallback:', error);
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
          console.warn('[SERVICES] Provider returned unexpected format', provider.name);
          continue;
        }

        const providerServices = response.data
          .map((service) => normalizeProviderService(provider, service))
          .filter(Boolean);

        allServices.push(...providerServices);
      } catch (providerError) {
        console.error('[SERVICES] Failed to fetch services from provider', provider.name, providerError.message);
      }
    }

  return allServices.filter((service) => service.status === 'active');
  } catch (fallbackError) {
    console.error('[SERVICES] Fallback provider load failed:', fallbackError);
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
      publicId
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
        public_id: resolvedPublicId
      })
      .select()
      .single();

    if (error) {
      console.error('Create service error:', error);
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
    console.error('Create service error:', error);
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
      publicId
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
      console.error('Update service error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to update service' })
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
    console.error('Update service error:', error);
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
      console.error('Delete service error:', error);
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
    console.error('Delete service error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleCreateCategory(data, headers) {
  try {
    const { name, description, icon } = data;

    // For now, categories are just stored as metadata
    // You can create a categories table later if needed
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        message: `Category "${name}" created successfully`,
        category: { name, description, icon }
      })
    };
  } catch (error) {
    console.error('Create category error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create category' })
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
        public_id: newPublicId
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
    console.error('Duplicate service error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to duplicate service' })
    };
  }
}
