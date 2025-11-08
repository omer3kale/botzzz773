// Services API - Get, Create, Update, Delete Services
const { supabase, supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const JWT_SECRET = process.env.JWT_SECRET;

function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const user = getUserFromToken(event.headers.authorization);
  try {
    const body = JSON.parse(event.body || '{}');

    switch (event.httpMethod) {
      case 'GET': return await handleGetServices(user, headers);
      case 'POST': return await handleCreateService(user, body, headers);
      case 'PUT': return await handleUpdateService(user, body, headers);
      case 'DELETE': return await handleDeleteService(user, body, headers);
      default:
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
  } catch (error) {
    console.error('Services API error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};

async function handleGetServices(user, headers) {
  try {
    const isAdmin = user && user.role === 'admin';
    const client = isAdmin ? supabaseAdmin : supabase;

    let query = client
      .from('services')
      .select(`*, provider:providers(id, name, status, markup)`);

    if (!isAdmin) query = query.eq('status', 'active');

    query = query.order('category', { ascending: true }).order('name', { ascending: true });

    const { data: services, error } = await query;
    if (error) {
      console.error('Get services error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch services' }) };
    }

    // 🔹 Site özel ID ekleme (sadece rakam)
    const startingId = 2231;
    const servicesWithCustomId = services.map((service, index) => ({
      ...service,
      site_id: startingId + index
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ services: servicesWithCustomId }) };
  } catch (error) {
    console.error('Get services error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

async function handleCreateService(user, data, headers) {
  try {
    if (!user || user.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };

    const { action } = data;
    if (action === 'create-category') return await handleCreateCategory(data, headers);
    if (action === 'duplicate') return await handleDuplicateService(data, headers);

    const {
      providerId, providerServiceId, name, category, description,
      rate, price, min_quantity, minOrder, max_quantity, maxOrder,
      type, status
    } = data;

    if (!name || !category) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };

    const servicePrice = rate || price || 0;
    const minQty = min_quantity || minOrder || 10;
    const maxQty = max_quantity || maxOrder || 100000;

    const { data: service, error } = await supabaseAdmin
      .from('services')
      .insert({
        provider_id: providerId || null,
        provider_service_id: providerServiceId || null,
        name,
        category,
        description: description || '',
        rate: servicePrice,
        min_quantity: minQty,
        max_quantity: maxQty,
        type: type || 'service',
        status: status || 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Create service error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create service' }) };
    }

    return { statusCode: 201, headers, body: JSON.stringify({ success: true, service }) };
  } catch (error) {
    console.error('Create service error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

async function handleUpdateService(user, data, headers) {
  try {
    if (!user || user.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };

    const {
      serviceId, name, category, rate, price, min_quantity, max_quantity,
      description, status, providerId, provider_id, providerServiceId, provider_service_id
    } = data;

    if (!serviceId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Service ID is required' }) };

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (rate !== undefined) updates.rate = rate;
    if (price !== undefined) updates.rate = price;
    if (min_quantity !== undefined) updates.min_quantity = min_quantity;
    if (max_quantity !== undefined) updates.max_quantity = max_quantity;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;

    const resolvedProviderId = providerId !== undefined ? providerId : provider_id;
    if (resolvedProviderId !== undefined) updates.provider_id = resolvedProviderId || null;

    const resolvedProviderServiceId = providerServiceId !== undefined ? providerServiceId : provider_service_id;
    if (resolvedProviderServiceId !== undefined) updates.provider_service_id = resolvedProviderServiceId || null;

    const { data: service, error } = await supabaseAdmin
      .from('services')
      .update(updates)
      .eq('id', serviceId)
      .select()
      .single();

    if (error) {
      console.error('Update service error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to update service' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, service }) };
  } catch (error) {
    console.error('Update service error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

async function handleDeleteService(user, data, headers) {
  try {
    if (!user || user.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };
    const { serviceId } = data;
    if (!serviceId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Service ID is required' }) };

    const { error } = await supabaseAdmin.from('services').delete().eq('id', serviceId);
    if (error) {
      console.error('Delete service error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to delete service' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error('Delete service error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

async function handleCreateCategory(data, headers) {
  try {
    const { name, description, icon } = data;
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: `Category "${name}" created successfully`, category: { name, description, icon } }) };
  } catch (error) {
    console.error('Create category error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create category' }) };
  }
}

async function handleDuplicateService(data, headers) {
  try {
    const { serviceId } = data;
    const { data: originalService, error: fetchError } = await supabaseAdmin.from('services').select('*').eq('id', serviceId).single();

    if (fetchError || !originalService) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Service not found' }) };

    const { data: newService, error: insertError } = await supabaseAdmin
      .from('services')
      .insert({
        provider_id: originalService.provider_id,
        provider_service_id: originalService.provider_service_id,
        name: `${originalService.name} (Copy)`,
        category: originalService.category,
        description: originalService.description,
        rate: originalService.rate,
        min_quantity: originalService.min_quantity,
        max_quantity: originalService.max_quantity,
        type: originalService.type,
        status: 'inactive'
      })
      .select()
      .single();

    if (insertError) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to duplicate service' }) };

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, service: newService }) };
  } catch (error) {
    console.error('Duplicate service error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to duplicate service' }) };
  }
}

