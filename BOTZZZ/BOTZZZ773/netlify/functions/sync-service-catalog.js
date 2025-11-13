const axios = require('axios');
const { supabaseAdmin } = require('./utils/supabase');

function normalizeServiceStatus(rawStatus) {
  if (rawStatus === undefined || rawStatus === null) {
    return 'active';
  }

  const status = String(rawStatus).trim().toLowerCase();
  if (!status) {
    return 'active';
  }

  const inactiveValues = new Set(['0', 'false', 'inactive', 'disabled', 'deactive', 'paused', 'off']);
  return inactiveValues.has(status) ? 'inactive' : 'active';
}

function toRate(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Number(numeric.toFixed(4)) : null;
}

function toQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.trunc(numeric);
}

async function fetchProviderServices(provider) {
  const params = new URLSearchParams();
  params.append('key', provider.api_key);
  params.append('action', 'services');

  const response = await axios.post(provider.api_url, params, {
    timeout: 30000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    validateStatus: (status) => status < 500
  });

  if (!Array.isArray(response.data)) {
    throw new Error('Provider returned invalid service list response');
  }

  return response.data;
}

async function syncProviderServices(provider) {
  if (!provider.api_url || !provider.api_key) {
    throw new Error('Provider is missing API credentials');
  }

  const services = await fetchProviderServices(provider);

  const { data: existingServices, error: existingError } = await supabaseAdmin
    .from('services')
    .select('id, provider_service_id, status')
    .eq('provider_id', provider.id);

  if (existingError) {
    throw new Error(`Failed to load existing services: ${existingError.message}`);
  }

  const existingMap = new Map();
  (existingServices || []).forEach((row) => {
    if (row.provider_service_id) {
      existingMap.set(String(row.provider_service_id), row);
    }
  });

  const seenProviderIds = new Set();
  let added = 0;
  let updated = 0;

  for (const payload of services) {
    const providerServiceId = payload.service ?? payload.service_id ?? payload.id;
    if (!providerServiceId) {
      continue;
    }

    const serviceKey = String(providerServiceId);
    seenProviderIds.add(serviceKey);

    const name = payload.name || `Service ${serviceKey}`;
    const category = (payload.category || 'other').toLowerCase();
    const rate = toRate(payload.rate ?? payload.price ?? payload.cost);
    const minQuantity = toQuantity(payload.min ?? payload.minimum);
    const rawMax = payload.max ?? payload.maximum;
    const maxQuantity = rawMax === undefined || rawMax === null ? null : toQuantity(rawMax);
    const status = normalizeServiceStatus(payload.status ?? payload.state ?? payload.available);
    const description = payload.description || payload.desc || '';

    const basePayload = {
      name,
      category,
      status,
      description
    };

    if (minQuantity !== null) {
      basePayload.min_quantity = minQuantity;
    }

    if (maxQuantity !== null) {
      basePayload.max_quantity = maxQuantity;
    } else {
      basePayload.max_quantity = null;
    }

    if (rate !== null) {
      basePayload.rate = rate;
      basePayload.provider_rate = rate;
      basePayload.retail_rate = rate;
    }

    const existing = existingMap.get(serviceKey);
    if (existing) {
      const { error: updateError } = await supabaseAdmin
        .from('services')
        .update(basePayload)
        .eq('id', existing.id);

      if (updateError) {
        console.error('[SERVICE SYNC] Failed to update service', existing.id, updateError);
      } else {
        updated += 1;
      }
    } else {
      const insertPayload = {
        ...basePayload,
        provider_id: provider.id,
        provider_service_id: serviceKey,
        min_quantity: basePayload.min_quantity ?? 10,
        max_quantity: basePayload.max_quantity,
        rate: basePayload.rate ?? 1,
        status: basePayload.status || 'active'
      };

      const { error: insertError } = await supabaseAdmin
        .from('services')
        .insert(insertPayload);

      if (insertError) {
        console.error('[SERVICE SYNC] Failed to insert service', serviceKey, insertError);
      } else {
        added += 1;
      }
    }
  }

  const missingIds = (existingServices || [])
    .filter((row) => row.provider_service_id && !seenProviderIds.has(String(row.provider_service_id)))
    .map((row) => row.id);

  let deactivated = 0;
  if (missingIds.length > 0) {
    const { error: deactivateError } = await supabaseAdmin
      .from('services')
      .update({ status: 'inactive' })
      .in('id', missingIds);

    if (deactivateError) {
      console.error('[SERVICE SYNC] Failed to deactivate missing services:', deactivateError);
    } else {
      deactivated = missingIds.length;
    }
  }

  const { error: providerUpdateError } = await supabaseAdmin
    .from('providers')
    .update({
      services_count: services.length,
      last_sync: new Date().toISOString()
    })
    .eq('id', provider.id);

  if (providerUpdateError) {
    console.error('[SERVICE SYNC] Failed to update provider metadata', provider.id, providerUpdateError);
  }

  return {
    added,
    updated,
    deactivated,
    total: services.length
  };
}

exports.handler = async (event = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const runAt = event.headers?.['x-netlify-schedule-run-at'] || new Date().toISOString();
  const targetProviderId = event.queryStringParameters?.providerId;

  try {
    let query = supabaseAdmin
      .from('providers')
      .select('id, name, api_url, api_key, status')
      .eq('status', 'active');

    if (targetProviderId) {
      query = query.eq('id', targetProviderId);
    }

    const { data: providers, error } = await query;

    if (error) {
      throw new Error(`Failed to load providers: ${error.message}`);
    }

    if (!providers || providers.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ runAt, providersProcessed: 0, results: [] })
      };
    }

    const results = [];

    for (const provider of providers) {
      try {
        const summary = await syncProviderServices(provider);
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          success: true,
          ...summary
        });
      } catch (syncError) {
        console.error('[SERVICE SYNC] Provider sync failed', provider.id, syncError);
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          success: false,
          error: syncError.message
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ runAt, providersProcessed: providers.length, results })
    };
  } catch (error) {
    console.error('[SERVICE SYNC] Scheduled sync failed:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Service sync failed', message: error.message })
    };
  }
};
