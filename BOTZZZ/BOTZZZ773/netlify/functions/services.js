// Services API - Get, Create, Update, Delete Services
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

function calculateMarkup(providerRate, retailRate) {
  if (!Number.isFinite(providerRate) || !Number.isFinite(retailRate) || providerRate <= 0) {
    return null;
  }

  const markup = ((retailRate - providerRate) / providerRate) * 100;
  return Number(markup.toFixed(2));
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
    const client = isAdminUser ? supabaseAdmin : supabase;

    let query = client
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
      // Only expose services that have a public customer-facing identifier assigned
      query = query.not('public_id', 'is', null);
    }

    query = query.order('category', { ascending: true }).order('name', { ascending: true });

    const { data: services, error } = await query;

    if (error) {
      console.error('Get services error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch services' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ services })
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
      status
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
        status: status || 'active'
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
      provider_service_id
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
        status: 'inactive' // New duplicates start as inactive
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
