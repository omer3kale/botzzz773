const axios = require('axios');
const { supabaseAdmin } = require('./utils/supabase');
const fs = require('fs');
const path = require('path');

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
  if (!Number.isFinite(numeric)) return null;

  // Round to 4 decimals (DB uses numeric(10,4) so max absolute value must be < 1e6)
  const rounded = Number(numeric.toFixed(4));
  const MAX_ABS = 999999.9999; // numeric(10,4) allows up to 999999.9999

  if (Math.abs(rounded) > MAX_ABS) {
    // Value cannot be stored in DB safely; treat as missing so we don't cause numeric overflow
    return null;
  }

  return rounded;
}

function toQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.trunc(numeric);
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

function truncateString(value, maxLength) {
  if (value === undefined || value === null) return '';
  const s = String(value);
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}
 
// Deep sanitize provider metadata so PostgREST receives safe JSON.
function sanitizeMetadata(value, options = {}) {
  const maxDepth = options.maxDepth ?? 3;
  const maxString = options.maxString ?? 2000;
  const maxArray = options.maxArray ?? 100;

  function _sanitize(val, depth) {
    if (val === null) return null;
    if (val === undefined) return null;
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) return null;
      // protect against absurdly large numbers
      if (Math.abs(val) > 1e12) return null;
      return val;
    }
    if (typeof val === 'string') {
      const s = val.trim();
      return s.length > maxString ? s.slice(0, maxString) : s;
    }
    if (typeof val === 'boolean') return val;
    if (Array.isArray(val)) {
      if (depth >= maxDepth) return [];
      const out = [];
      for (let i = 0; i < Math.min(val.length, maxArray); i++) {
        const item = _sanitize(val[i], depth + 1);
        if (item !== null) out.push(item);
      }
      return out;
    }
    if (typeof val === 'object') {
      if (depth >= maxDepth) return {};
      const out = {};
      for (const k of Object.keys(val)) {
        try {
          const v = _sanitize(val[k], depth + 1);
          if (v !== null) out[k] = v;
        } catch (e) {
          // skip problematic key
        }
      }
      return out;
    }
    // functions, symbols, etc. -> drop
    return null;
  }

  try {
    return _sanitize(value, 0) || {};
  } catch (e) {
    return {};
  }
}

function appendFailedPayload(providerId, serviceKey, payload, type = 'insert') {
  try {
    const logDir = path.resolve(__dirname, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, 'failed-provider-payloads.log');
    const entry = {
      time: new Date().toISOString(),
      providerId,
      serviceKey,
      type,
      payload
    };
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[SERVICE SYNC] Failed to write payload log', e && e.message ? e.message : e);
  }
}
async function fetchProviderServices(provider) {
  const params = new URLSearchParams();
  params.append('key', provider.api_key);
  params.append('action', 'services');

  const start = Date.now();

  try {
    const response = await axios.post(provider.api_url, params, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: (status) => status < 500
    });
    const latencyMs = Date.now() - start;

    if (!Array.isArray(response.data)) {
      throw new Error('Provider returned invalid service list response');
    }

    return { services: response.data, latencyMs };
  } catch (error) {
    if (provider?.id) {
      const { error: providerUpdateError } = await supabaseAdmin
        .from('providers')
        .update({
          health_status: 'degraded',
          response_latency_ms: null
        })
        .eq('id', provider.id);

      if (providerUpdateError) {
        console.error('[SERVICE SYNC] Failed to mark provider degraded:', providerUpdateError);
      }
    }

    throw error;
  }
}

async function syncProviderServices(provider) {
  if (!provider.api_url || !provider.api_key) {
    throw new Error('Provider is missing API credentials');
  }

  const { services, latencyMs } = await fetchProviderServices(provider);

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
  let loggedFailedPayloads = 0;
  const MAX_LOG_FAILED = 5;

  for (const payload of services) {
    const providerServiceId = payload.service ?? payload.service_id ?? payload.id;
    if (!providerServiceId) {
      continue;
    }

    const serviceKey = String(providerServiceId);
    seenProviderIds.add(serviceKey);

    const name = truncateString(payload.name || `Service ${serviceKey}`, 255);
    const category = truncateString((payload.category || 'other').toLowerCase(), 50);
    const rate = toRate(payload.rate ?? payload.price ?? payload.cost);
    const minQuantity = toQuantity(payload.min ?? payload.minimum);
    const rawMax = payload.max ?? payload.maximum;
    const maxQuantity = rawMax === undefined || rawMax === null ? null : toQuantity(rawMax);
    const status = truncateString(normalizeServiceStatus(payload.status ?? payload.state ?? payload.available), 20);
    const description = payload.description || payload.desc || '';

    const averageTime = normalizeAverageTime(
      payload.average_time ?? payload.avg_time ?? payload.averageTime ?? payload.time ?? payload.expected_time
    );

    const currency = normalizeCurrency(
      payload.currency ?? payload.price_currency ?? payload.rate_currency ?? payload.cur
    );

    const basePayload = {
      name,
      category,
      status,
      description,
      provider_order_id: truncateString(serviceKey, 50),
      currency,
      average_time: averageTime,
      refill_supported: toBooleanFlag(payload.refill ?? payload.refill_support ?? payload.needs_refill),
      cancel_supported: toBooleanFlag(payload.cancel ?? payload.cancel_support ?? payload.cancellable),
      dripfeed_supported: toBooleanFlag(payload.dripfeed ?? payload.drip_feed ?? payload.drip),
      subscription_supported: toBooleanFlag(payload.subscription ?? payload.subscriptions ?? payload.subscription_supported),
<<<<<<< HEAD
      // provider_metadata must be valid JSON for PostgREST/Supabase; sanitize to remove
      // undefined/non-serializable values and to cap sizes/depth.
      provider_metadata: sanitizeMetadata(payload)
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
        if (updateError && updateError.code === 'PGRST102' && loggedFailedPayloads < MAX_LOG_FAILED) {
          try {
            console.error('[SERVICE SYNC] Failed payload (sanitized):', JSON.stringify(basePayload.provider_metadata));
          } catch (e) {
            console.error('[SERVICE SYNC] Failed payload (sanitized) cannot be stringified');
          }
          // persist the failing sanitized payload for offline inspection
          try { appendFailedPayload(provider.id, serviceKey, basePayload.provider_metadata, 'update'); } catch (_) {}
          loggedFailedPayloads += 1;
        }
      } else {
        updated += 1;
      }
    } else {
      const insertPayload = {
        ...basePayload,
        provider_id: provider.id,
        provider_service_id: truncateString(serviceKey, 50),
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
        if (insertError && insertError.code === 'PGRST102' && loggedFailedPayloads < MAX_LOG_FAILED) {
          try {
            console.error('[SERVICE SYNC] Failed insert payload (sanitized):', JSON.stringify(insertPayload.provider_metadata));
          } catch (e) {
            console.error('[SERVICE SYNC] Failed insert payload (sanitized) cannot be stringified');
          }
          // persist the failing sanitized payload for offline inspection
          try { appendFailedPayload(provider.id, serviceKey, insertPayload.provider_metadata, 'insert'); } catch (_) {}
          loggedFailedPayloads += 1;
        }
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
      last_sync: new Date().toISOString(),
      response_latency_ms: latencyMs,
      health_status: 'online'
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

exports.syncProviderServices = syncProviderServices;

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
