// Providers API - Manage SMM Provider Integrations
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

function extractProviderIdFromPath(path = '') {
  const segments = path.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment || lastSegment.toLowerCase() === 'providers') {
    return null;
  }
  return decodeURIComponent(lastSegment);
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

function canonicalizeAction(rawAction, params) {
  const actionAliases = {
    create: 'create',
    add: 'create',
    new: 'create',
    createprovider: 'create',
    addprovider: 'create',
    provideradd: 'create',
    providercreate: 'create',
    createprovideraction: 'create',
    sync: 'sync',
    syncprovider: 'sync',
    syncservices: 'sync',
    import: 'sync',
    importservices: 'sync',
    refresh: 'sync',
    test: 'test',
    testprovider: 'test',
    testconnection: 'test',
    validate: 'test'
  };

  let normalized = '';

  if (rawAction !== undefined && rawAction !== null) {
    const actionStr = String(rawAction).trim().toLowerCase();
    if (actionStr) {
      normalized = actionAliases[actionStr];
      if (!normalized) {
        const collapsed = actionStr.replace(/[\s_-]+/g, '');
        normalized = actionAliases[collapsed] || '';
      }
    }
  }

  if (!normalized && hasProviderCreatePayload(params)) {
    normalized = 'create';
  }

  if (!normalized && hasProviderSyncPayload(params)) {
    normalized = 'sync';
  }

  return normalized;
}

function sanitizeString(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function parseMarkup(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeProviderPayload(raw = {}) {
  const name = sanitizeString(firstDefined(raw.name, raw.providerName, raw.provider_name, raw.provider));
  const apiUrl = sanitizeString(firstDefined(raw.apiUrl, raw.api_url, raw.url, raw.endpoint));
  const apiKey = sanitizeString(firstDefined(raw.apiKey, raw.api_key, raw.key, raw.providerKey));
  const markup = parseMarkup(firstDefined(raw.markup, raw.defaultMarkup, raw.providerMarkup, raw.priceMarkup));
  const rawStatus = firstDefined(raw.status, raw.providerStatus, raw.state);
  const status = rawStatus ? String(rawStatus).trim().toLowerCase() : undefined;

  return { name, apiUrl, apiKey, markup, status };
}

function hasProviderCreatePayload(raw = {}) {
  const payload = normalizeProviderPayload(raw);
  return Boolean(payload.name || payload.apiKey || payload.apiUrl);
}

function hasProviderSyncPayload(raw = {}) {
  return Boolean(firstDefined(raw.providerId, raw.provider_id, raw.id, raw.provider, raw.targetProviderId));
}

function extractProviderId(raw = {}) {
  return firstDefined(raw.providerId, raw.provider_id, raw.id, raw.provider, raw.targetProviderId);
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

  // Normalize authorization header casing
  const authHeader = event.headers.authorization || event.headers.Authorization;
  const user = getUserFromToken(authHeader);
  if (!user || user.role !== 'admin') {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Admin access required' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const queryParams = event.queryStringParameters || {};

    if (!body.action && queryParams.action) {
      body.action = queryParams.action;
    }

    const providerIdFromPath = extractProviderIdFromPath(event.path || '');
    const providerIdFromQuery = firstDefined(queryParams.providerId, queryParams.provider_id, queryParams.id);
    const providerId = firstDefined(body.providerId, body.provider_id, providerIdFromQuery, providerIdFromPath);

    if (providerId) {
      body.providerId = providerId;
    }

    switch (event.httpMethod) {
      case 'GET':
        return await handleGetProviders(headers);
      case 'POST':
        return await handleAction(body, headers);
      case 'PUT':
        return await handleUpdateProvider(body, headers);
      case 'DELETE':
        return await handleDeleteProvider(body, headers);
      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    console.error('Providers API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleGetProviders(headers) {
  try {
    const { data: providers, error } = await supabaseAdmin
      .from('providers')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Get providers error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch providers' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, providers })
    };
  } catch (error) {
    console.error('Get providers error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleAction(data, headers) {
  const { action, ...params } = data || {};
  const normalizedAction = canonicalizeAction(action, params);

  console.log('[DEBUG] handleAction called with:', {
    action,
    normalizedAction,
    paramKeys: params ? Object.keys(params) : []
  });

  switch (normalizedAction) {
    case 'test':
      return await testProvider(params, headers);
    case 'sync':
      return await syncProvider(params, headers);
    case 'create':
    case 'add':
      return await createProvider(params, headers);
    default:
      console.error('[ERROR] Invalid action received:', action, 'Normalized:', normalizedAction, 'Full data:', JSON.stringify(data));
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Invalid action',
          received: action,
          expected: 'test, sync, or create'
        })
      };
  }
}

async function testProvider(data, headers) {
  try {
    const { apiUrl, apiKey } = normalizeProviderPayload(data);

    if (!apiUrl || !apiKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'API URL and API Key are required' })
      };
    }

    // Test connection by fetching balance
    const params = new URLSearchParams();
    params.append('key', apiKey);
    params.append('action', 'balance');
    
    const response = await axios.post(apiUrl, params, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (response.data.balance !== undefined) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          balance: response.data.balance,
          currency: response.data.currency || 'USD'
        })
      };
    } else {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: response.data.error || 'Invalid API response'
        })
      };
    }
  } catch (error) {
    console.error('Test provider error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error.message || 'Failed to connect to provider'
      })
    };
  }
}

async function syncProvider(data, headers) {
  try {
    const providerId = extractProviderId(data);

    if (!providerId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Provider ID is required' })
      };
    }

    // Get provider details
    const { data: provider, error: providerError } = await supabaseAdmin
      .from('providers')
      .select('*')
      .eq('id', providerId)
      .single();

    if (providerError || !provider) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Provider not found' })
      };
    }

    // Fetch services from provider
    const params = new URLSearchParams();
    params.append('key', provider.api_key);
    params.append('action', 'services');
    
    const response = await axios.post(provider.api_url, params, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!Array.isArray(response.data)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid response from provider' })
      };
    }

    const services = response.data;
    let addedCount = 0;
    let updatedCount = 0;

    // Process each service
    for (const service of services) {
      const { data: existingService } = await supabaseAdmin
        .from('services')
        .select('id')
        .eq('provider_id', providerId)
        .eq('provider_service_id', service.service)
        .single();

      if (existingService) {
        // Update existing service
        await supabaseAdmin
          .from('services')
          .update({
            name: service.name,
            category: service.category || 'Other',
            rate: service.rate,
            min_quantity: service.min,
            max_quantity: service.max
          })
          .eq('id', existingService.id);
        updatedCount++;
      } else {
        // Create new service
        await supabaseAdmin
          .from('services')
          .insert({
            provider_id: providerId,
            provider_service_id: service.service,
            name: service.name,
            category: service.category || 'Other',
            rate: service.rate,
            min_quantity: service.min,
            max_quantity: service.max,
            status: 'inactive' // New services start as inactive
          });
        addedCount++;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        added: addedCount,
        updated: updatedCount,
        total: services.length
      })
    };
  } catch (error) {
    console.error('Sync provider error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error.message || 'Failed to sync provider'
      })
    };
  }
}

async function createProvider(data, headers) {
  try {
    const { name, apiUrl, apiKey, markup, status } = normalizeProviderPayload(data);

    console.log('[DEBUG] Create provider request:', {
      name,
      apiUrl,
      apiKey: apiKey ? apiKey.substring(0, 10) + '...' : undefined,
      markup,
      status
    });

    if (!name || !apiKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Name and API Key are required' })
      };
    }

    // Use a default API URL if not provided (will be updated when testing/syncing)
    const providerApiUrl = apiUrl || 'https://provider-api.example.com';
    const providerMarkup = Number.isFinite(markup) ? markup : 15; // Default 15% markup if not provided
    const providerStatus = status || 'active';

    const insertData = {
      name,
      api_url: providerApiUrl,
      api_key: apiKey,
      markup: providerMarkup,
      status: providerStatus
      // Note: description field removed as it doesn't exist in providers table
    };

    console.log('[DEBUG] Inserting provider:', {
      name: insertData.name,
      api_url: insertData.api_url,
      api_key: insertData.api_key ? insertData.api_key.substring(0, 10) + '...' : undefined,
      markup: insertData.markup,
      status: insertData.status
    });

    const { data: provider, error } = await supabaseAdmin
      .from('providers')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error('Create provider error:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'Failed to create provider',
          details: error.message || error.hint || 'Unknown database error'
        })
      };
    }

    console.log('[DEBUG] Provider created successfully:', provider.id);

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        provider
      })
    };
  } catch (error) {
    console.error('Create provider exception:', error);
    console.error('Exception stack:', error.stack);
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

async function handleUpdateProvider(data, headers) {
  try {
    const providerId = extractProviderId(data);
    const updateData = { ...data };
    delete updateData.providerId;
    delete updateData.provider_id;
    delete updateData.id;
    delete updateData.provider;
    delete updateData.targetProviderId;
    delete updateData.action;

    if (!providerId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Provider ID is required' })
      };
    }

    if (updateData.status) {
      updateData.status = String(updateData.status).trim().toLowerCase();
    }

    const { data: provider, error } = await supabaseAdmin
      .from('providers')
      .update(updateData)
      .eq('id', providerId)
      .select()
      .single();

    if (error) {
      console.error('Update provider error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to update provider' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        provider
      })
    };
  } catch (error) {
    console.error('Update provider error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleDeleteProvider(data, headers) {
  try {
    const providerId = extractProviderId(data);

    if (!providerId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Provider ID is required' })
      };
    }

    const { error } = await supabaseAdmin
      .from('providers')
      .delete()
      .eq('id', providerId);

    if (error) {
      console.error('Delete provider error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to delete provider' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('Delete provider error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}
