const _supabaseUtils = require('./utils/supabase');
const supabaseAdmin = _supabaseUtils.supabaseAdmin || _supabaseUtils.supabase;
const safeSelectFrom = typeof _supabaseUtils.safeSelectFrom === 'function' ? _supabaseUtils.safeSelectFrom : null;

const CACHE_TTL_MS = 60 * 1000;
const DEFAULT_HEARTBEAT_ENDPOINT = '/.netlify/functions/heartbeat';
let cachedPayload = null;
let cacheExpiresAt = 0;

const baseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=30'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: baseHeaders, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: baseHeaders,
      body: JSON.stringify({ success: false, error: 'Method not allowed' })
    };
  }

  const now = Date.now();
  if (cachedPayload && now < cacheExpiresAt) {
    return {
      statusCode: 200,
      headers: baseHeaders,
      body: JSON.stringify({ ...cachedPayload, cached: true })
    };
  }

  try {
    let data, error;
    if (typeof safeSelectFrom === 'function') {
      const res = await safeSelectFrom(supabaseAdmin, 'settings', ['key','value'], qb => qb.eq('key', 'integrations').maybeSingle());
      data = res.data;
      error = res.error;
    } else {
      // Fallback: safeSelectFrom not present in deployed utils — use direct supabase call
      const res = await supabaseAdmin.from('settings').select('key, value').eq('key', 'integrations').maybeSingle();
      data = res.data;
      error = res.error;
    }

    if (error) {
      throw error;
    }

    const integrations = normalizeSettingValue(data?.value) || {};
    const monitoring = buildMonitoringConfig(integrations);
    const payload = {
      success: true,
      monitoring,
      updatedAt: new Date().toISOString()
    };

    cachedPayload = payload;
    cacheExpiresAt = now + CACHE_TTL_MS;

    return {
      statusCode: 200,
      headers: baseHeaders,
      body: JSON.stringify({ ...payload, cached: false })
    };
  } catch (error) {
    console.error('[public-config] Failed to load settings', error);

    // If debug flag is present, return the underlying error message/stack (truncated)
    const debug = event?.queryStringParameters && String(event.queryStringParameters.debug) === '1';
    if (debug) {
      const safeMessage = (error && error.message) ? String(error.message) : 'Unknown error';
      const safeStack = (error && error.stack) ? String(error.stack).slice(0, 2000) : undefined;
      return {
        statusCode: 500,
        headers: baseHeaders,
        body: JSON.stringify({ success: false, error: safeMessage, stack: safeStack })
      };
    }

    return {
      statusCode: 500,
      headers: baseHeaders,
      body: JSON.stringify({ success: false, error: 'Unable to load monitoring config' })
    };
  }
};

function normalizeSettingValue(value) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return value;
      }
    }
  }
  return value;
}

function truthy(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on', 'enabled'].includes(value.trim().toLowerCase());
  }
  return fallback;
}

function numeric(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeString(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.trim();
}

function buildMonitoringConfig(integrations = {}) {
  const analyticsEnabled = truthy(integrations.analyticsEnabled ?? integrations.gaEnabled, false);
  const measurementId = sanitizeString(integrations.gaMeasurementId || integrations.ga4MeasurementId);
  const trackingId = sanitizeString(integrations.gaTrackingId);

  return {
    sentry: {
      enabled: truthy(integrations.sentryEnabled, false),
      dsn: sanitizeString(integrations.sentryDsn),
      environment: sanitizeString(integrations.sentryEnvironment),
      release: sanitizeString(integrations.sentryRelease),
      tracesSampleRate: numeric(integrations.sentryTracesSampleRate, 0.2),
      replaysSessionSampleRate: numeric(integrations.sentryReplaysSessionSampleRate, 0.05),
      replaysOnErrorSampleRate: numeric(integrations.sentryReplaysOnErrorSampleRate, 1.0),
      cdn: sanitizeString(integrations.sentryCdn)
    },
    logRocket: {
      enabled: truthy(integrations.logRocketEnabled, false),
      appId: sanitizeString(integrations.logRocketAppId),
      release: sanitizeString(integrations.logRocketRelease),
      consoleLogging: truthy(integrations.logRocketConsoleLogging, true)
    },
    analytics: {
      enabled: analyticsEnabled,
      provider: sanitizeString(integrations.analyticsProvider) || 'gtag',
      measurementId,
      trackingId,
      autoPageview: truthy(integrations.analyticsAutoPageview, true)
    },
    uptime: {
      enabled: truthy(integrations.uptimeEnabled, false),
      provider: sanitizeString(integrations.uptimeProvider) || 'custom',
      endpoint: sanitizeString(integrations.uptimeHeartbeatUrl) || DEFAULT_HEARTBEAT_ENDPOINT,
      intervalMs: numeric(integrations.uptimePingInterval, 120000),
      transport: sanitizeString(integrations.uptimeTransport) || 'fetch'
    }
  };
}
