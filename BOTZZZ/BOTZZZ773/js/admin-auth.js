// Admin Authentication Protection
// This script must be loaded FIRST on all admin pages

(function bootstrapMonitoringScript(windowObject, documentObject) {
    if (!windowObject || !documentObject) {
        return;
    }
    if (windowObject.__BOTZZZ_MONITORING_SCRIPT__) {
        return;
    }
    windowObject.__BOTZZZ_MONITORING_SCRIPT__ = true;

    const script = documentObject.createElement('script');
    script.src = '/js/monitoring.js?v=20250217';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.botzzzMonitoring = 'true';

    (documentObject.head || documentObject.documentElement || documentObject.body || documentObject).appendChild(script);
})(typeof window !== 'undefined' ? window : undefined, typeof document !== 'undefined' ? document : undefined);

(function installFetchGuard(windowObject) {
    if (typeof windowObject === 'undefined' || typeof windowObject.fetch !== 'function' || windowObject.__FETCH_GUARD_INSTALLED__) {
        return;
    }

    const originalFetch = windowObject.fetch.bind(windowObject);
    const performanceNow = (typeof performance !== 'undefined' && performance.now.bind(performance)) || Date.now;

    const guardConfig = Object.freeze({
        matchPattern: '/.netlify/functions/',
        timeoutMs: 10000,
        maxRetries: 2,
        baseRetryDelayMs: 400,
        maxRetryDelayMs: 4000,
        jitterMs: 250,
        retryStatusCodes: new Set([408, 425, 429, 500, 502, 503, 504]),
        retryableMethods: new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        circuitBreakerThreshold: 3,
        circuitBreakerCooldownMs: 15000
    });
    const maxAttempts = guardConfig.maxRetries + 1;

    const metrics = {
        totalRequests: 0,
        guardedRequests: 0,
        retryCount: 0,
        circuitOpens: 0
    };

    const circuitBreakers = new Map();

    function emit(eventName, detail) {
        try {
            windowObject.dispatchEvent(new CustomEvent(eventName, { detail }));
        } catch (error) {
            console.warn('[FetchGuard] Failed to emit event', eventName, error);
        }
    }

    function resolveUrl(input) {
        if (typeof input === 'string') {
            return input;
        }
        if (input instanceof URL) {
            return input.toString();
        }
        if (input && typeof input.url === 'string') {
            return input.url;
        }
        return '';
    }

    function matchesGuard(url) {
        return typeof url === 'string' && url.includes(guardConfig.matchPattern);
    }

    function getEndpointKey(url) {
        try {
            const parsed = new URL(url, windowObject.location?.origin || windowObject.location);
            return parsed.pathname;
        } catch (error) {
            return url;
        }
    }

    function getCircuit(endpointKey) {
        if (!circuitBreakers.has(endpointKey)) {
            circuitBreakers.set(endpointKey, {
                failures: 0,
                open: false,
                nextAttemptAt: 0,
                lastError: null
            });
        }
        return circuitBreakers.get(endpointKey);
    }

    function markSuccess(endpointKey) {
        const circuit = getCircuit(endpointKey);
        const wasOpen = circuit.open;
        circuit.failures = 0;
        circuit.open = false;
        circuit.nextAttemptAt = 0;
        circuit.lastError = null;
        if (wasOpen) {
            emit('fetchguard:circuit-reset', { endpoint: endpointKey });
        }
    }

    function markFailure(endpointKey, detail) {
        const circuit = getCircuit(endpointKey);
        circuit.failures += 1;
        circuit.lastError = detail;
        if (!circuit.open && circuit.failures >= guardConfig.circuitBreakerThreshold) {
            circuit.open = true;
            circuit.nextAttemptAt = Date.now() + guardConfig.circuitBreakerCooldownMs;
            metrics.circuitOpens += 1;
            emit('fetchguard:circuit-open', {
                endpoint: endpointKey,
                retryAt: circuit.nextAttemptAt,
                detail
            });
        }
    }

    function shouldRetryResponse(response) {
        return guardConfig.retryStatusCodes.has(response.status);
    }

    function createAbortBundle(userSignal) {
        const controller = new AbortController();
        let timeoutId = null;
        let timeoutReason = null;
        if (guardConfig.timeoutMs > 0) {
            timeoutReason = new Error(`Request timed out after ${guardConfig.timeoutMs}ms`);
            timeoutReason.name = 'TimeoutError';
            timeoutId = setTimeout(() => controller.abort(timeoutReason), guardConfig.timeoutMs);
        }

        let abortListener = null;
        if (userSignal) {
            if (userSignal.aborted) {
                controller.abort(userSignal.reason);
            } else {
                abortListener = () => controller.abort(userSignal.reason);
                userSignal.addEventListener('abort', abortListener, { once: true });
            }
        }

        return {
            controller,
            signal: controller.signal,
            cleanup() {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                if (abortListener && userSignal) {
                    userSignal.removeEventListener('abort', abortListener);
                }
            },
            isTimeoutAbort() {
                return controller.signal.aborted && controller.signal.reason === timeoutReason;
            }
        };
    }

    function shouldRetryError(error, abortBundle) {
        if (!error) {
            return false;
        }
        if (abortBundle?.isTimeoutAbort()) {
            return true;
        }
        const message = String(error.message || '');
        return /NetworkError|Failed to fetch|load failed|Network request failed/i.test(message);
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getRetryDelay(attempt) {
        const exponential = Math.min(
            guardConfig.baseRetryDelayMs * Math.pow(2, attempt - 1),
            guardConfig.maxRetryDelayMs
        );
        const jitter = Math.random() * guardConfig.jitterMs;
        return exponential + jitter;
    }

    async function guardedFetch(input, init = {}) {
        const requestInfo = input;
        const requestInit = init || {};
        const resolvedUrl = resolveUrl(input);

        if (!matchesGuard(resolvedUrl)) {
            return originalFetch(requestInfo, requestInit);
        }

        metrics.totalRequests += 1;
        metrics.guardedRequests += 1;

        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            const offlineError = new Error('Offline: unable to reach backend');
            offlineError.name = 'OfflineError';
            emit('fetchguard:offline', { endpoint: resolvedUrl });
            throw offlineError;
        }

        const method = (requestInit.method || requestInfo?.method || 'GET').toUpperCase();
        if (!guardConfig.retryableMethods.has(method)) {
            return originalFetch(requestInfo, requestInit);
        }

        const endpointKey = getEndpointKey(resolvedUrl);
        const circuit = getCircuit(endpointKey);
        if (circuit.open && Date.now() < circuit.nextAttemptAt) {
            const blockedError = new Error(`Circuit open for ${endpointKey}`);
            blockedError.name = 'CircuitOpenError';
            blockedError.detail = circuit;
            emit('fetchguard:circuit-blocked', { endpoint: endpointKey, retryAt: circuit.nextAttemptAt });
            throw blockedError;
        }

        let attempt = 0;
        let lastResponse = null;
        let lastNetworkError = null;

        while (attempt < maxAttempts) {
            attempt += 1;
            const abortBundle = createAbortBundle(requestInit.signal);
            const finalInit = { ...requestInit, signal: abortBundle.signal };
            const startTime = performanceNow();

            try {
                const response = await originalFetch(requestInfo, finalInit);
                lastResponse = response;
                const duration = performanceNow() - startTime;

                if (!shouldRetryResponse(response)) {
                    markSuccess(endpointKey);
                    emit('fetchguard:success', { endpoint: endpointKey, status: response.status, attempt, duration });
                    abortBundle.cleanup();
                    return response;
                }

                emit('fetchguard:retry', { endpoint: endpointKey, status: response.status, attempt, duration });
                abortBundle.cleanup();

                if (attempt >= maxAttempts) {
                    markFailure(endpointKey, { status: response.status });
                    emit('fetchguard:failure', { endpoint: endpointKey, status: response.status, attempts: attempt });
                    return response;
                }

                metrics.retryCount += 1;
                await delay(getRetryDelay(attempt));
                continue;
            } catch (error) {
                lastNetworkError = error;
                const duration = performanceNow() - startTime;
                const retryableError = shouldRetryError(error, abortBundle);
                abortBundle.cleanup();

                if (!retryableError || attempt >= maxAttempts) {
                    markFailure(endpointKey, { error });
                    emit('fetchguard:failure', { endpoint: endpointKey, error, attempts: attempt, duration });
                    throw error;
                }

                metrics.retryCount += 1;
                emit('fetchguard:retry', { endpoint: endpointKey, error, attempt, duration });
                await delay(getRetryDelay(attempt));
            }
        }

        if (lastResponse) {
            return lastResponse;
        }

        throw lastNetworkError || new Error('Request failed after guard retries');
    }

    windowObject.fetch = guardedFetch;

    windowObject.fetchGuard = {
        config: guardConfig,
        getMetrics() {
            return {
                ...metrics,
                circuits: Array.from(circuitBreakers.entries()).map(([endpoint, state]) => ({
                    endpoint,
                    ...state
                }))
            };
        },
        resetCircuit(endpoint) {
            if (!endpoint) {
                circuitBreakers.clear();
                emit('fetchguard:circuit-reset', { endpoint: 'all' });
                return;
            }
            const circuit = circuitBreakers.get(endpoint);
            if (circuit) {
                circuit.failures = 0;
                circuit.open = false;
                circuit.nextAttemptAt = 0;
                circuit.lastError = null;
                emit('fetchguard:circuit-reset', { endpoint });
            }
        },
        on(eventName, handler) {
            windowObject.addEventListener(eventName, handler);
            return () => windowObject.removeEventListener(eventName, handler);
        }
    };

    function broadcastNetworkStatus() {
        emit('fetchguard:network-status', { online: navigator?.onLine !== false });
    }

    windowObject.addEventListener('online', broadcastNetworkStatus);
    windowObject.addEventListener('offline', broadcastNetworkStatus);
    broadcastNetworkStatus();

    windowObject.__FETCH_GUARD_INSTALLED__ = true;
    emit('fetchguard:ready', { config: guardConfig });
})(typeof window !== 'undefined' ? window : undefined);

(function() {
    'use strict';

    // Check authentication
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    
    // No token or user - redirect to admin login
    if (!token || !userStr) {
        console.warn('Admin access denied: No authentication token');
        window.location.href = '/admin/signin.html';
        return;
    }

    // Parse user data
    let user;
    try {
        user = JSON.parse(userStr);
    } catch (error) {
        console.error('Admin access denied: Invalid user data', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/admin/signin.html';
        return;
    }

    // Check if user has admin role
    if (user.role !== 'admin') {
        console.warn('Admin access denied: User is not an admin', user);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/admin/signin.html';
        return;
    }

    // Verify token is still valid by checking if it's expired
    // JWT tokens have expiration, but we can do a basic check
    try {
        const tokenParts = token.split('.');
        if (tokenParts.length !== 3) {
            throw new Error('Invalid token format');
        }
        
        // Decode payload (middle part)
        const payload = JSON.parse(atob(tokenParts[1]));
        
        // Check expiration
        if (payload.exp && payload.exp * 1000 < Date.now()) {
            console.warn('Admin access denied: Token expired');
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = '/admin/signin.html';
            return;
        }
    } catch (error) {
        console.error('Admin access denied: Token validation failed', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/admin/signin.html';
        return;
    }

    console.log('✅ Admin authentication verified:', user.username);

    // Add logout handler when DOM is ready
    document.addEventListener('DOMContentLoaded', function() {
        // Find logout button and add handler
        const logoutBtn = document.querySelector('[onclick*="logout"]');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function(e) {
                e.preventDefault();
                if (confirm('Are you sure you want to logout?')) {
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    window.location.href = '/admin/signin.html';
                }
            });
        }
    });
})();
