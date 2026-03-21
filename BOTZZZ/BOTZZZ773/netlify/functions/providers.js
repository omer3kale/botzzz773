// Providers API - Manage SMM Provider Integrations
const { supabase, supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { syncProviderServices } = require('./sync-service-catalog');
const { getPricingEngine } = require('./utils/pricing-engine');
const { getExchangeRates } = require('./utils/currency-converter');

const JWT_SECRET = process.env.JWT_SECRET;

const ALLOWED_ORIGINS = ['https://www.botzzz773.pro', 'https://botzzz773.pro'];
function getCorsOrigin(event) {
  const origin = event?.headers?.origin || '';
  return ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
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
    validate: 'test',
    'fetch-service-details': 'fetch-service-details',
    fetchservicedetails: 'fetch-service-details',
    'fetch-services': 'fetch-services',
    fetchservices: 'fetch-services',
    listservices: 'fetch-services'
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

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
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

// Real-time exchange rates cache
// Convert amount from any currency to USD
async function convertToUSD(amount, fromCurrency) {
  const currency = String(fromCurrency || 'USD').toUpperCase().trim();
  
  if (currency === 'USD') {
    return parseFloat(amount) || 0;
  }
  
  const rates = await getExchangeRates();
  const rate = rates[currency];
  
  if (!rate) {
    console.warn(`[CURRENCY] Unknown currency ${currency}, treating as USD`);
    return parseFloat(amount) || 0;
  }
  
  // rates are USD-based, so we need to divide by the rate to convert TO USD
  // Example: 100 INR with rate 83.5 (1 USD = 83.5 INR) -> 100/83.5 = 1.20 USD
  return (parseFloat(amount) || 0) / rate;
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
    'Access-Control-Allow-Origin': getCorsOrigin(event),
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
    case 'fetch-service-details':
      return await fetchServiceDetails(params, headers);
    case 'fetch-services':
      return await fetchProviderServicesList(params, headers);
    case 'toggle_low_balance_alert':
      return await toggleLowBalanceAlert(params, headers);
    default:
      console.error('[ERROR] Invalid action received:', action, 'Normalized:', normalizedAction, 'Full data:', JSON.stringify(data));
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Invalid action',
          received: action,
          expected: 'test, sync, create, or fetch-service-details'
        })
      };
  }
}

async function testProvider(data, headers) {
  try {
    // Check if providerId is provided (testing existing provider)
    const providerId = extractProviderId(data);
    let apiUrl, apiKey;
    let providerRecord = null;

    if (providerId) {
      // Fetch provider from database
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

      apiUrl = provider.api_url;
      apiKey = provider.api_key;
      providerRecord = provider;
    } else {
      // Use provided credentials (testing before creating provider)
      const normalized = normalizeProviderPayload(data);
      apiUrl = normalized.apiUrl;
      apiKey = normalized.apiKey;
    }

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
    
    const startTime = Date.now();
    const response = await axios.post(apiUrl, params, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/json',
        'Referer': apiUrl,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache'
      }
    });
    const responseTime = Date.now() - startTime;

    if (response.data.balance !== undefined) {
      if (providerId && providerRecord) {
        const normalizedCurrency = normalizeCurrency(response.data.currency);
        const numericBalance = toNumberOrNull(response.data.balance);
        const providerUpdate = {
          currency: normalizedCurrency,
          last_balance_sync: new Date().toISOString(),
          response_latency_ms: responseTime,
          health_status: 'online'
        };

        if (numericBalance !== null) {
          providerUpdate.balance = numericBalance;
        }

        const { error: providerUpdateError } = await supabaseAdmin
          .from('providers')
          .update(providerUpdate)
          .eq('id', providerId);

        if (providerUpdateError) {
          console.error('Failed to update provider health data during test:', providerUpdateError);
        }
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          balance: response.data.balance,
          currency: response.data.currency || 'USD',
          responseTime
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

    const providerId = extractProviderId(data);
    if (providerId) {
      const { error: providerUpdateError } = await supabaseAdmin
        .from('providers')
        .update({
          health_status: 'offline',
          response_latency_ms: null
        })
        .eq('id', providerId);

      if (providerUpdateError) {
        console.error('Failed to mark provider offline after test failure:', providerUpdateError);
      }
    }

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

    const { data: provider, error: providerError } = await supabaseAdmin
      .from('providers')
      .select('id, name, api_url, api_key, status, markup, currency')
      .eq('id', providerId)
      .single();

    if (providerError || !provider) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Provider not found' })
      };
    }

    const pricingEngine = await getPricingEngine();
    const summary = await syncProviderServices(provider, { pricingEngine });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        providerId: provider.id,
        providerName: provider.name,
        ...summary
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

async function fetchProviderServicesList(data, headers) {
  try {
    const providerId = extractProviderId(data);

    if (!providerId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Provider ID is required' })
      };
    }

    const { data: provider, error: providerError } = await supabaseAdmin
      .from('providers')
      .select('id, name, api_url, api_key, currency')
      .eq('id', providerId)
      .single();

    if (providerError || !provider) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Provider not found' })
      };
    }

    const params = new URLSearchParams();
    params.append('key', provider.api_key);
    params.append('action', 'services');

    const response = await axios.post(provider.api_url, params, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: (status) => status < 500
    });

    if (!Array.isArray(response.data)) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: 'Provider returned invalid service list' })
      };
    }

    let services = response.data;

    // Filter by specific service IDs if provided
    const serviceIds = data.serviceIds;
    if (Array.isArray(serviceIds) && serviceIds.length > 0) {
      const idSet = new Set(serviceIds.map(id => String(id)));
      services = services.filter(s => idSet.has(String(s.service || s.id)));
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        providerId: provider.id,
        providerName: provider.name,
        currency: provider.currency || 'USD',
        services
      })
    };
  } catch (error) {
    console.error('Fetch provider services list error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: error.message || 'Failed to fetch services from provider'
      })
    };
  }
}

async function fetchServiceDetails(data, headers) {
  try {
    const { provider_id, service_id } = data;

    if (!provider_id || !service_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Provider ID and Service ID are required' })
      };
    }

    // Fetch provider from database
    const { data: provider, error: providerError } = await supabaseAdmin
      .from('providers')
      .select('*')
      .eq('id', provider_id)
      .single();

    if (providerError || !provider) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Provider not found' })
      };
    }

    const { api_url, api_key, currency: providerCurrency } = provider;

    if (!api_url || !api_key) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Provider API configuration is incomplete' })
      };
    }

    // Fetch services from provider API (Perfect Panel format)
    const params = new URLSearchParams();
    params.append('key', api_key);
    params.append('action', 'services');

    const response = await axios.post(api_url, params, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    if (!Array.isArray(response.data)) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Invalid response format from provider API' })
      };
    }

    // Find matching service
    const service = response.data.find(s => String(s.service) === String(service_id));

    if (!service) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Service not found in provider catalog' })
      };
    }

    // Convert rate to USD if provider uses different currency
    const rawRate = parseFloat(service.rate) || 0;
    const rateInUSD = providerCurrency && providerCurrency !== 'USD' 
      ? await convertToUSD(rawRate, providerCurrency)
      : rawRate;

    console.log(`[FETCH] Service ${service_id} rate conversion: ${rawRate} ${providerCurrency || 'USD'} → ${rateInUSD.toFixed(4)} USD`);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        service: {
          id: service.service,
          name: service.name,
          rate: parseFloat(rateInUSD.toFixed(4)),
          min: parseInt(service.min) || 0,
          max: parseInt(service.max) || 0,
          refill: service.refill,
          cancel: service.cancel
        },
        conversion: providerCurrency && providerCurrency !== 'USD' ? {
          original_rate: rawRate,
          original_currency: providerCurrency,
          converted_rate: parseFloat(rateInUSD.toFixed(4)),
          converted_currency: 'USD'
        } : null
      })
    };
  } catch (error) {
    console.error('Fetch service details error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to fetch service details',
        message: error.message
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

    // Get all service IDs for this provider
    const { data: services } = await supabaseAdmin
      .from('services')
      .select('id')
      .eq('provider_id', providerId);

    // Nullify orders referencing those services (FK is RESTRICT, not CASCADE)
    if (services && services.length > 0) {
      const serviceIds = services.map(s => s.id);
      await supabaseAdmin
        .from('orders')
        .update({ service_id: null })
        .in('service_id', serviceIds);
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
        body: JSON.stringify({ error: error.message || 'Failed to delete provider' })
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
