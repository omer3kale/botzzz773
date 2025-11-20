const { supabaseAdmin } = require('./supabase');

const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = 60;
const HEADER_LIMIT = 'x-ratelimit-limit';
const HEADER_REMAINING = 'x-ratelimit-remaining';
const HEADER_RESET = 'x-ratelimit-reset';

function normalizeHeaderLookup(headers, name) {
  if (!headers || typeof headers !== 'object') {
    return undefined;
  }
  const direct = headers[name];
  if (direct !== undefined) {
    return direct;
  }
  const lowered = name.toLowerCase();
  return headers[lowered];
}

function extractIp(event = {}) {
  const headers = event.headers || {};
  const forwarded = normalizeHeaderLookup(headers, 'x-client-ip')
    || normalizeHeaderLookup(headers, 'x-forwarded-for')
    || normalizeHeaderLookup(headers, 'cf-connecting-ip')
    || normalizeHeaderLookup(headers, 'true-client-ip');

  if (forwarded) {
    return String(forwarded).split(',')[0].trim();
  }
  const netlifyIp = event?.requestContext?.identity?.sourceIp;
  if (netlifyIp) {
    return netlifyIp;
  }
  return 'anonymous';
}

function secondsUntilReset(windowReset) {
  if (!windowReset) {
    return 0;
  }
  const resetTime = new Date(windowReset).getTime();
  if (Number.isNaN(resetTime)) {
    return 0;
  }
  return Math.max(0, Math.ceil((resetTime - Date.now()) / 1000));
}

async function recordHit({ identifier, route, limit = DEFAULT_LIMIT, windowSeconds = DEFAULT_WINDOW_SECONDS }) {
  if (!identifier) {
    return { allowed: true, meta: null };
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('record_api_rate_limit', {
      p_identifier: identifier,
      p_route: route,
      p_window_seconds: windowSeconds,
      p_request_limit: limit
    });

    if (error) {
      console.warn('[rate-limit]', 'RPC failed, allowing request', error);
      return { allowed: true, meta: null };
    }

    const result = Array.isArray(data) ? data[0] : data;
    if (!result) {
      return { allowed: true, meta: null };
    }

    const { request_count: count = 1, request_limit: allowed, window_reset: windowReset } = result;
    const remaining = Math.max(allowed - count, 0);
    const retryAfter = remaining === 0 ? secondsUntilReset(windowReset) : 0;

    return {
      allowed: count <= allowed,
      meta: {
        count,
        limit: allowed,
        remaining,
        windowReset,
        retryAfter
      }
    };
  } catch (error) {
    console.warn('[rate-limit]', 'Unexpected failure, allowing request', error);
    return { allowed: true, meta: null };
  }
}

function applyRateLimitHeaders(response = {}, meta) {
  if (!meta) {
    return response;
  }

  response.headers = Object.assign({}, response.headers, {
    [HEADER_LIMIT]: String(meta.limit),
    [HEADER_REMAINING]: String(meta.remaining),
    [HEADER_RESET]: meta.windowReset ? String(meta.windowReset) : ''
  });

  if (meta.retryAfter && meta.retryAfter > 0) {
    response.headers['retry-after'] = String(meta.retryAfter);
  }

  return response;
}

function defaultIdentifierExtractor(event) {
  return extractIp(event);
}

function defaultBlockedResponse(meta) {
  return {
    statusCode: 429,
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      success: false,
      error: 'Too many requests. Please slow down.',
      retryAfterSeconds: meta?.retryAfter ?? null
    })
  };
}

function withRateLimit(config, handler) {
  const {
    route,
    limit = DEFAULT_LIMIT,
    windowSeconds = DEFAULT_WINDOW_SECONDS,
    identifierExtractor = defaultIdentifierExtractor,
    enabled = true,
    onBlocked = defaultBlockedResponse
  } = config || {};

  if (!route) {
    throw new Error('withRateLimit requires a route identifier');
  }

  return async function rateLimitedHandler(event, context) {
    if (!enabled) {
      return handler(event, context);
    }

    const identifier = typeof identifierExtractor === 'function'
      ? await identifierExtractor(event, context)
      : identifierExtractor;

    const { allowed, meta } = await recordHit({
      identifier: identifier || defaultIdentifierExtractor(event),
      route,
      limit,
      windowSeconds
    });

    if (!allowed) {
      const blockedResponse = onBlocked(meta);
      return applyRateLimitHeaders(blockedResponse, meta);
    }

    const response = await handler(event, context);
    return applyRateLimitHeaders(response, meta);
  };
}

module.exports = {
  withRateLimit,
  extractIp,
  recordHit
};
