/*
 * BOTZZZ773 Monitoring Runtime
 * Loads production observability tooling (Sentry, LogRocket, analytics, uptime pings)
 * Configuration is delivered via /.netlify/functions/public-config and cached client-side.
 */
(function bootstrapMonitoring(windowObject, documentObject) {
  'use strict';

  if (!windowObject || windowObject.__BOTZZZ_MONITORING_INITIALIZED__) {
    return;
  }

  const LOG_PREFIX = '[BOTZZZ Monitoring]';
  const CONFIG_ENDPOINT = '/.netlify/functions/public-config';
  const DEFAULT_HEARTBEAT_ENDPOINT = '/.netlify/functions/heartbeat';
  const CONFIG_STORAGE_KEY = 'botzzz-monitoring-config';
  const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const loadedScripts = new Map();

  function toBoolean(value, fallback = false) {
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

  function toNumber(value, fallback = undefined) {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function loadScriptOnce(sourceUrl) {
    if (!sourceUrl) {
      return Promise.reject(new Error('Missing script URL'));
    }
    if (loadedScripts.has(sourceUrl)) {
      return loadedScripts.get(sourceUrl);
    }
    const promise = new Promise((resolve, reject) => {
      const script = documentObject.createElement('script');
      script.src = sourceUrl;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${sourceUrl}`));
      const target = documentObject.head || documentObject.documentElement || documentObject.body || documentObject;
      target.appendChild(script);
    });
    loadedScripts.set(sourceUrl, promise);
    return promise;
  }

  function readCachedConfig({ ignoreExpiry = false } = {}) {
    try {
      const raw = (windowObject.sessionStorage && windowObject.sessionStorage.getItem(CONFIG_STORAGE_KEY))
        || (windowObject.localStorage && windowObject.localStorage.getItem(CONFIG_STORAGE_KEY));
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw);
      if (!ignoreExpiry && parsed.expiresAt && parsed.expiresAt < Date.now()) {
        return null;
      }
      return parsed.data || null;
    } catch (error) {
      console.warn(LOG_PREFIX, 'Unable to read cached config', error);
      return null;
    }
  }

  function writeCachedConfig(data) {
    try {
      const payload = { data, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
      if (windowObject.sessionStorage) {
        windowObject.sessionStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(payload));
        return;
      }
      if (windowObject.localStorage) {
        windowObject.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(payload));
      }
    } catch (error) {
      console.warn(LOG_PREFIX, 'Unable to cache monitoring config', error);
    }
  }

  function parseUserProfile() {
    try {
      const stored = localStorage.getItem('user');
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      return null;
    }
  }

  function addFetchGuardBreadcrumb(handler) {
    windowObject.addEventListener('fetchguard:failure', handler);
    windowObject.addEventListener('fetchguard:circuit-open', handler);
    windowObject.addEventListener('fetchguard:circuit-reset', handler);
  }

  const Monitoring = {
    init() {
      if (this._initPromise) {
        return this._initPromise;
      }
      this._initPromise = this.loadConfig()
        .then(config => {
          this.config = config || {};
          this.setupGlobalErrorBridge();
          this.setupSentry();
          this.setupLogRocket();
          this.setupAnalytics();
          this.setupHeartbeat();
          return config;
        })
        .catch(error => {
          console.warn(LOG_PREFIX, 'Initialization failed', error);
        });
      return this._initPromise;
    },

    async loadConfig() {
      const cachedConfig = readCachedConfig();
      if (cachedConfig) {
        return cachedConfig;
      }
      try {
        const response = await fetch(`${CONFIG_ENDPOINT}?t=${Date.now()}`, { cache: 'no-store', mode: 'cors' });
        if (!response.ok) {
          throw new Error(`Config request failed: ${response.status}`);
        }
        const payload = await response.json();
        const config = payload?.monitoring || {};
        writeCachedConfig(config);
        return config;
      } catch (error) {
        console.warn(LOG_PREFIX, 'Falling back to stale monitoring config', error);
        return readCachedConfig({ ignoreExpiry: true }) || {};
      }
    },

    setupGlobalErrorBridge() {
      if (this._errorBridgeInstalled || !windowObject.addEventListener) {
        return;
      }
      this._errorBridgeInstalled = true;

      windowObject.addEventListener('error', event => {
        if (event.error) {
          console.warn(LOG_PREFIX, 'Window error captured', event.error);
        }
      });

      windowObject.addEventListener('unhandledrejection', event => {
        console.warn(LOG_PREFIX, 'Unhandled rejection', event.reason);
      });
    },

    setupSentry() {
      const sentryConfig = this.config?.sentry;
      if (!sentryConfig || !toBoolean(sentryConfig.enabled) || !sentryConfig.dsn) {
        return;
      }
      if (windowObject.__BOTZZZ_SENTRY_READY__) {
        return;
      }

      const sentryCdn = sentryConfig.cdn || 'https://browser.sentry-cdn.com/8.30.0/bundle.tracing.replay.min.js';
      loadScriptOnce(sentryCdn)
        .then(() => {
          const Sentry = windowObject.Sentry;
          if (!Sentry || typeof Sentry.init !== 'function') {
            console.warn(LOG_PREFIX, 'Sentry global not available after load');
            return;
          }

          const integrations = [];
          if (typeof Sentry.browserTracingIntegration === 'function') {
            integrations.push(Sentry.browserTracingIntegration());
          }
          if (typeof Sentry.replayIntegration === 'function') {
            integrations.push(Sentry.replayIntegration());
          }

          Sentry.init({
            dsn: sentryConfig.dsn,
            environment: sentryConfig.environment || windowObject.location?.hostname || 'production',
            release: sentryConfig.release || `botzzz@${windowObject.location?.hostname || 'web'}`,
            tracesSampleRate: toNumber(sentryConfig.tracesSampleRate, 0.2),
            replaysSessionSampleRate: toNumber(sentryConfig.replaysSessionSampleRate, 0.05),
            replaysOnErrorSampleRate: toNumber(sentryConfig.replaysOnErrorSampleRate, 1.0),
            integrations,
            beforeSend(event) {
              event.tags = Object.assign({}, event.tags, {
                app: 'botzzz773',
                route: windowObject.location?.pathname || 'unknown'
              });
              return event;
            }
          });

          const user = parseUserProfile();
          if (user && typeof Sentry.setUser === 'function') {
            Sentry.setUser({
              email: user.email,
              username: user.username || user.name || user.email,
              id: user.id,
              role: user.role
            });
          }

          addFetchGuardBreadcrumb(event => {
            if (typeof Sentry.addBreadcrumb === 'function') {
              Sentry.addBreadcrumb({
                category: 'fetchguard',
                level: 'info',
                data: event.detail || {}
              });
            }
          });

          windowObject.__BOTZZZ_SENTRY_READY__ = true;
          console.info(LOG_PREFIX, 'Sentry initialized');
        })
        .catch(error => {
          console.warn(LOG_PREFIX, 'Failed to load Sentry', error);
        });
    },

    setupLogRocket() {
      const logRocketConfig = this.config?.logRocket;
      if (!logRocketConfig || !toBoolean(logRocketConfig.enabled) || !logRocketConfig.appId) {
        return;
      }
      if (windowObject.__BOTZZZ_LOGROCKET_READY__) {
        return;
      }

      loadScriptOnce('https://cdn.lr-ingest.io/LogRocket.min.js')
        .then(() => {
          if (!windowObject.LogRocket || typeof windowObject.LogRocket.init !== 'function') {
            throw new Error('LogRocket global missing');
          }
          windowObject.LogRocket.init(logRocketConfig.appId, {
            release: logRocketConfig.release || 'botzzz@web',
            consoleLogging: toBoolean(logRocketConfig.consoleLogging, true)
          });

          const user = parseUserProfile();
          if (user && typeof windowObject.LogRocket.identify === 'function') {
            windowObject.LogRocket.identify(user.id || user.email || user.username, {
              name: user.username || user.name,
              email: user.email,
              role: user.role
            });
          }

          windowObject.__BOTZZZ_LOGROCKET_READY__ = true;
          console.info(LOG_PREFIX, 'LogRocket initialized');
        })
        .catch(error => {
          console.warn(LOG_PREFIX, 'Failed to init LogRocket', error);
        });
    },

    setupAnalytics() {
      const analyticsConfig = this.config?.analytics;
      if (!analyticsConfig || !toBoolean(analyticsConfig.enabled)) {
        return;
      }

      const ids = [analyticsConfig.measurementId, analyticsConfig.trackingId]
        .filter(Boolean)
        .flatMap(id => id.split(',').map(entry => entry.trim()))
        .filter(Boolean);

      if (!ids.length) {
        return;
      }

      if (!windowObject.dataLayer) {
        windowObject.dataLayer = windowObject.dataLayer || [];
      }
      windowObject.gtag = windowObject.gtag || function gtag(){ windowObject.dataLayer.push(arguments); };

      const firstId = ids[0];
      loadScriptOnce(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(firstId)}`)
        .then(() => {
          windowObject.gtag('js', new Date());
          ids.forEach(id => {
            windowObject.gtag('config', id, {
              send_page_view: toBoolean(analyticsConfig.autoPageview, true),
              transport_type: 'beacon'
            });
          });
          console.info(LOG_PREFIX, 'Analytics initialized for', ids.join(', '));
        })
        .catch(error => {
          console.warn(LOG_PREFIX, 'Analytics script failed to load', error);
        });
    },

    setupHeartbeat() {
      const uptimeConfig = this.config?.uptime;
      if (!uptimeConfig || !toBoolean(uptimeConfig.enabled)) {
        return;
      }

      const endpoint = uptimeConfig.endpoint || DEFAULT_HEARTBEAT_ENDPOINT;
      const intervalMs = Math.max(toNumber(uptimeConfig.intervalMs, 120000) || 120000, 60000);
      const transport = uptimeConfig.transport || 'fetch';

      const sendPing = (reason = 'interval') => {
        const url = `${endpoint}?reason=${encodeURIComponent(reason)}&ts=${Date.now()}`;
        if (transport === 'beacon' && typeof navigator?.sendBeacon === 'function') {
          try {
            navigator.sendBeacon(url);
            return;
          } catch (error) {
            console.warn(LOG_PREFIX, 'Heartbeat beacon failed', error);
          }
        }
        fetch(url, { method: 'GET', keepalive: true }).catch(error => {
          console.warn(LOG_PREFIX, 'Heartbeat request failed', error);
        });
      };

      this._heartbeatTimer = windowObject.setInterval(() => sendPing('interval'), intervalMs);
      if (documentObject && typeof documentObject.addEventListener === 'function') {
        documentObject.addEventListener('visibilitychange', () => {
          if (documentObject.visibilityState === 'hidden') {
            sendPing('hidden');
          }
        });
      }
      windowObject.addEventListener('offline', () => sendPing('offline'));

      sendPing('startup');
      console.info(LOG_PREFIX, `Heartbeat enabled (${Math.round(intervalMs / 1000)}s interval)`);
    }
  };

  windowObject.__BOTZZZ_MONITORING_INITIALIZED__ = true;
  windowObject.__BOTZZZ_MONITORING__ = Monitoring;
  Monitoring.init();
})(typeof window !== 'undefined' ? window : undefined, typeof document !== 'undefined' ? document : undefined);
