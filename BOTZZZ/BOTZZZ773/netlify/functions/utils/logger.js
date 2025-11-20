const SENSITIVE_KEYS = new Set([
  'password', 'newPassword', 'confirmPassword', 'token', 'otp', 'otpCode',
  'secret', 'apiKey', 'cardNumber', 'cvv', 'accessToken', 'refreshToken'
]);

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function sanitizeMeta(meta) {
  if (!meta) {
    return undefined;
  }

  if (Array.isArray(meta)) {
    return meta.map(sanitizeMeta);
  }

  if (isPlainObject(meta)) {
    return Object.keys(meta).reduce((acc, key) => {
      if (SENSITIVE_KEYS.has(key)) {
        acc[key] = '[REDACTED]';
        return acc;
      }
      acc[key] = sanitizeMeta(meta[key]);
      return acc;
    }, {});
  }

  if (typeof meta === 'string' && meta.length > 1024) {
    return `${meta.slice(0, 1021)}...`;
  }

  return meta;
}

function serializeError(error) {
  if (!error) {
    return undefined;
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    statusCode: error.statusCode,
    code: error.code
  };
}

function logLine(level, scope, message, meta) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    scope,
    message,
    ...meta
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function createLogger(scope = 'app', defaults = {}) {
  function base(level, message, meta = {}) {
    const sanitized = sanitizeMeta(meta);
    logLine(level, scope, message, { ...sanitizeMeta(defaults), ...sanitized });
  }

  return {
    debug: (message, meta) => base('debug', message, meta),
    info: (message, meta) => base('info', message, meta),
    warn: (message, meta) => base('warn', message, meta),
    error: (message, meta) => base('error', message, meta),
    child(extra = {}) {
      return createLogger(scope, { ...defaults, ...extra });
    }
  };
}

module.exports = {
  createLogger,
  serializeError
};
