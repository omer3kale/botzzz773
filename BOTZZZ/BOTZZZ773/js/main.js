// ==========================================
// BOTZZZ773 - Main JavaScript File
// ==========================================

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

(function installBalanceSync(globalObject) {
    if (!globalObject || globalObject.BalanceSync) {
        return;
    }

    const STORAGE_KEY = 'user';
    const EVENT_NAME = 'balance:updated';
    const DEFAULT_REFRESH_THROTTLE_MS = 3500;

    let cachedUser = readUserSnapshot();
    let refreshThrottleMs = DEFAULT_REFRESH_THROTTLE_MS;
    let lastRefreshAt = 0;
    let refreshPromise = null;
    let fetcher = null;
    const subscribers = new Set();

    function readUserSnapshot() {
        try {
            const raw = globalObject.localStorage?.getItem(STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (error) {
            console.warn('[BalanceSync] Failed to read user snapshot.', error);
            return null;
        }
    }

    function persistUserSnapshot(snapshot) {
        try {
            if (!snapshot) {
                globalObject.localStorage?.removeItem(STORAGE_KEY);
                return;
            }
            globalObject.localStorage?.setItem(STORAGE_KEY, JSON.stringify(snapshot));
        } catch (error) {
            console.warn('[BalanceSync] Failed to persist user snapshot.', error);
        }
    }

    function cloneUser(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') {
            return null;
        }
        return { ...snapshot };
    }

    function getBalanceValue(snapshot = cachedUser) {
        if (!snapshot || snapshot.balance === undefined || snapshot.balance === null) {
            return null;
        }
        const numeric = Number(snapshot.balance);
        return Number.isFinite(numeric) ? numeric : null;
    }

    function emit(meta = {}) {
        const detail = {
            user: cloneUser(cachedUser),
            balance: getBalanceValue(),
            meta
        };

        subscribers.forEach((callback) => {
            try {
                callback(detail);
            } catch (error) {
                console.warn('[BalanceSync] Subscriber error.', error);
            }
        });

        if (typeof globalObject.dispatchEvent === 'function') {
            try {
                globalObject.dispatchEvent(new CustomEvent(EVENT_NAME, { detail }));
            } catch (error) {
                console.warn('[BalanceSync] Failed to dispatch event.', error);
            }
        }
    }

    function setUserSnapshot(nextUser, meta = {}) {
        if (nextUser === null) {
            cachedUser = null;
            persistUserSnapshot(null);
            emit(meta);
            return true;
        }

        if (!nextUser || typeof nextUser !== 'object') {
            return false;
        }

        cachedUser = { ...(cachedUser || {}), ...nextUser };
        persistUserSnapshot(cachedUser);
        emit(meta);
        return true;
    }

    function setBalanceValue(balanceValue, meta = {}) {
        const numeric = Number(balanceValue);
        if (!Number.isFinite(numeric)) {
            return false;
        }
        cachedUser = { ...(cachedUser || {}), balance: Number(numeric.toFixed(4)) };
        persistUserSnapshot(cachedUser);
        emit(meta);
        return true;
    }

    function configure(options = {}) {
        if (typeof options.fetcher === 'function') {
            fetcher = options.fetcher;
        }
        if (Number.isFinite(options.throttleMs) && options.throttleMs >= 0) {
            refreshThrottleMs = options.throttleMs;
        }
    }

    function scheduleRefresh(reason = 'manual') {
        if (!fetcher) {
            return Promise.resolve(null);
        }
        if (refreshPromise) {
            return refreshPromise;
        }

        const now = Date.now();
        const elapsed = now - lastRefreshAt;
        const waitMs = Math.max(0, refreshThrottleMs - elapsed);

        refreshPromise = (waitMs > 0 ? delay(waitMs) : Promise.resolve())
            .then(() => fetcher({ reason }))
            .then((result) => {
                lastRefreshAt = Date.now();
                refreshPromise = null;

                const nextUser = extractUser(result);
                if (nextUser) {
                    setUserSnapshot(nextUser, { reason: reason || 'refresh' });
                } else if (result && typeof result === 'object' && result.balance !== undefined) {
                    setBalanceValue(result.balance, { reason: reason || 'refresh' });
                }
                return nextUser || result || null;
            })
            .catch((error) => {
                lastRefreshAt = Date.now();
                refreshPromise = null;
                console.warn('[BalanceSync] Refresh failed.', error);
                throw error;
            });

        return refreshPromise;
    }

    function extractUser(result) {
        if (!result) {
            return null;
        }
        if (result.user && typeof result.user === 'object') {
            return result.user;
        }
        if (result && typeof result === 'object' && (result.email || result.username || result.id !== undefined || result.balance !== undefined)) {
            return result;
        }
        return null;
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function subscribe(handler, options = {}) {
        if (typeof handler !== 'function') {
            return () => {};
        }
        subscribers.add(handler);
        if (options.immediate) {
            try {
                handler({
                    user: cloneUser(cachedUser),
                    balance: getBalanceValue(),
                    meta: { reason: 'immediate' }
                });
            } catch (error) {
                console.warn('[BalanceSync] Immediate subscriber error.', error);
            }
        }
        return () => subscribers.delete(handler);
    }

    function handleRefundUpdate(event) {
        if (!event?.detail) {
            return;
        }
        if (fetcher) {
            scheduleRefresh('refund-event');
            return;
        }
        const refundAmount = Number(event.detail.amount);
        const currentBalance = getBalanceValue();
        if (Number.isFinite(refundAmount) && Number.isFinite(currentBalance)) {
            setBalanceValue(currentBalance + refundAmount, { reason: 'refund-event-local' });
        }
    }

    function handleStorageSync(event) {
        if (event && event.key && event.key !== STORAGE_KEY) {
            return;
        }
        cachedUser = readUserSnapshot();
        emit({ reason: 'storage-sync' });
    }

    const api = Object.freeze({
        configure,
        refresh: scheduleRefresh,
        setUser: setUserSnapshot,
        setBalance: setBalanceValue,
        clearUser(meta = {}) {
            cachedUser = null;
            persistUserSnapshot(null);
            emit(meta);
        },
        getUser() {
            return cloneUser(cachedUser);
        },
        getBalance() {
            return getBalanceValue();
        },
        subscribe,
        dispatch(meta = {}) {
            emit(meta);
        }
    });

    globalObject.BalanceSync = api;

    // ============= AUTO-UPDATE ALL BALANCE ELEMENTS ON PAGE =============
    // This ensures that whenever balance changes, ALL balance displays update
    function updateAllBalanceDisplays(balance) {
        if (!Number.isFinite(balance)) return;
        
        // Use extended format (up to 5 decimals, trim trailing zeros) if available
        const formatBalance = globalObject.BOTZZZ_formatBalanceDisplay || ((val) => {
            const num = Number(val);
            if (!Number.isFinite(num)) return '$0';
            const fixed = num.toFixed(5);
            const trimmed = fixed
                .replace(/(\.\d*?[1-9])0+$/, '$1')
                .replace(/\.0+$/, '');
            return `$${trimmed}`;
        });
        
        const formattedBalance = formatBalance(balance);
        
        // Update all common balance element selectors
        const balanceSelectors = [
            '.balance',                    // User menu balance
            '.balance-amount',             // Add funds page & API dashboard
            '#balanceAmount',              // Dashboard
            '#currentBalance',             // API Dashboard current balance card
            '#orderPageBalance',           // Order page balance card
            '[data-balance]',              // Generic data attribute
            '.user-balance',               // Alternative class
            '.wallet-balance',             // Wallet displays
            '.account-balance'             // Account displays
        ];
        
        balanceSelectors.forEach(selector => {
            const elements = globalObject.document?.querySelectorAll(selector);
            if (elements) {
                elements.forEach(el => {
                    if (el && el.textContent !== undefined) {
                        el.textContent = formattedBalance;
                    }
                });
            }
        });
    }

    // Subscribe to balance changes and auto-update DOM
    subscribe(({ balance }) => {
        if (Number.isFinite(balance)) {
            updateAllBalanceDisplays(balance);
        }
    });

    // Also expose manual update function
    api.updateDisplays = () => {
        const balance = getBalanceValue();
        if (Number.isFinite(balance)) {
            updateAllBalanceDisplays(balance);
        }
    };

    if (typeof globalObject.addEventListener === 'function') {
        globalObject.addEventListener('refund:updated', handleRefundUpdate);
        globalObject.addEventListener('storage', handleStorageSync);
    }
})(typeof window !== 'undefined' ? window : undefined);

function openAppPopup(path, options = {}) {
    if (typeof window === 'undefined') {
        return null;
    }

    const defaults = {
        name: 'botzzz-popup',
        width: 1100,
        height: 720,
        features: 'resizable=yes,scrollbars=yes',
        context: {}
    };

    const settings = { ...defaults, ...options };
    const left = Math.max(0, (window.screen.width - settings.width) / 2);
    const top = Math.max(0, (window.screen.height - settings.height) / 2);
    const featureList = `${settings.features},width=${settings.width},height=${settings.height},left=${left},top=${top}`;

    const url = new URL(path, window.location.origin);
    url.searchParams.set('popup', '1');

    Object.entries(settings.context || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, value);
        }
    });

    const popupRef = window.open(url.toString(), settings.name, featureList);
    if (!popupRef) {
        alert('Please allow popups for BOTZZZ773 to continue.');
        return null;
    }

    popupRef.focus();
    return popupRef;
}

const authPopupBoundLinks = new WeakSet();
const ticketPopupBoundLinks = new WeakSet();
const orderPopupBoundLinks = new WeakSet();
const addFundsPopupBoundLinks = new WeakSet();
const servicesPopupBoundLinks = new WeakSet();
const apiPopupBoundLinks = new WeakSet();
const dashboardPopupBoundLinks = new WeakSet();
const contactPopupBoundLinks = new WeakSet();
const apiDashboardPopupBoundLinks = new WeakSet();

function registerAuthPopupLinks() {
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach((link) => {
        const intent = deriveAuthIntent(link);
        if (!intent) {
            return;
        }
        link.dataset.authPopup = intent;
        bindAuthPopupLink(link);
    });
}

function deriveAuthIntent(link) {
    if (!link || link.dataset.noPopup === 'true') {
        return null;
    }

    if (link.dataset.authPopup) {
        return link.dataset.authPopup;
    }

    const rawHref = (link.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return null;
    }

    let pathname = '';
    try {
        pathname = new URL(rawHref, window.location.origin).pathname.replace(/^\/+/, '');
    } catch (error) {
        return null;
    }

    if (!pathname || pathname.startsWith('admin/') || pathname.startsWith('../')) {
        return null;
    }

    if (pathname.endsWith('signup.html')) {
        return 'signup';
    }

    if (pathname.endsWith('signin.html')) {
        return 'signin';
    }

    return null;
}

function bindAuthPopupLink(link) {
    if (!link || authPopupBoundLinks.has(link)) {
        return;
    }
    link.addEventListener('click', handleAuthPopupClick);
    authPopupBoundLinks.add(link);
}

function handleAuthPopupClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    if (document.body.classList.contains('popup-mode')) {
        return;
    }

    event.preventDefault();
    const trigger = event.currentTarget;
    const intent = trigger.dataset.authPopup || 'signin';
    const targetPath = trigger.getAttribute('href') || (intent === 'signup' ? 'signup.html' : 'signin.html');
    const redirect = trigger.dataset.redirect || buildAuthRedirectParam();

    const popupRef = openAppPopup(targetPath, {
        name: intent === 'signup' ? 'botzzz-signup-popup' : 'botzzz-signin-popup',
        width: 980,
        context: { redirect }
    });

    if (!popupRef) {
        navigateToAuthPage(targetPath, redirect);
    }
}

function navigateToAuthPage(targetPath, redirect) {
    try {
        const fallbackUrl = new URL(targetPath, window.location.origin);
        if (redirect && !fallbackUrl.searchParams.has('redirect')) {
            fallbackUrl.searchParams.set('redirect', redirect);
        }
        window.location.href = fallbackUrl.toString();
    } catch (error) {
        window.location.href = targetPath;
    }
}

function registerTicketsPopupLinks() {
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach((link) => {
        if (!shouldEnhanceTicketsLink(link)) {
            return;
        }
        bindTicketsPopupLink(link);
    });
}

function shouldEnhanceTicketsLink(link) {
    if (!link || ticketPopupBoundLinks.has(link) || link.dataset.noPopup === 'true') {
        return false;
    }

    const rawHref = (link.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return false;
    }

    if (link.target && link.target !== '_self') {
        return false;
    }

    let pathname = '';
    try {
        pathname = new URL(rawHref, window.location.origin).pathname.replace(/^\/+/, '');
    } catch (error) {
        pathname = rawHref.replace(/^\/+/, '');
    }

    if (!pathname || pathname.startsWith('admin/')) {
        return false;
    }

    return pathname === 'tickets.html';
}

function bindTicketsPopupLink(link) {
    if (!link || ticketPopupBoundLinks.has(link)) {
        return;
    }
    link.addEventListener('click', handleTicketsPopupClick);
    ticketPopupBoundLinks.add(link);
}

function handleTicketsPopupClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    if (document.body.classList.contains('popup-mode') || isCurrentTicketsPage()) {
        return;
    }

    event.preventDefault();
    const popupRef = openAppPopup('tickets.html', {
        name: 'botzzz-tickets-popup',
        width: 1080,
        height: 760
    });

    if (!popupRef) {
        navigateToTicketsPage();
    }
}

function isCurrentTicketsPage() {
    try {
        const pathname = window.location.pathname.replace(/^\/+/, '');
        return pathname === 'tickets.html';
    } catch (error) {
        return false;
    }
}

function navigateToTicketsPage() {
    try {
        window.location.href = new URL('tickets.html', window.location.origin).toString();
    } catch (error) {
        window.location.href = 'tickets.html';
    }
}

function registerOrderPopupLinks() {
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach((link) => {
        if (!shouldEnhanceOrderLink(link)) {
            return;
        }
        bindOrderPopupLink(link);
    });
}

function shouldEnhanceOrderLink(link) {
    if (!link || orderPopupBoundLinks.has(link) || link.dataset.noPopup === 'true') {
        return false;
    }

    const rawHref = (link.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return false;
    }

    if (link.target && link.target !== '_self') {
        return false;
    }

    let pathname = '';
    try {
        pathname = new URL(rawHref, window.location.origin).pathname.replace(/^\/+/, '');
    } catch (error) {
        pathname = rawHref.replace(/^\/+/, '');
    }

    if (!pathname || pathname.startsWith('admin/')) {
        return false;
    }

    return pathname === 'order.html';
}

function bindOrderPopupLink(link) {
    if (!link || orderPopupBoundLinks.has(link)) {
        return;
    }
    link.addEventListener('click', handleOrderPopupClick);
    orderPopupBoundLinks.add(link);
}

function handleOrderPopupClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    if (document.body.classList.contains('popup-mode') || isCurrentOrderPage()) {
        return;
    }

    event.preventDefault();
    const popupRef = openAppPopup('order.html', {
        name: 'botzzz-order-popup',
        width: 1100,
        height: 760
    });

    if (!popupRef) {
        navigateToOrderPage();
    }
}

function isCurrentOrderPage() {
    try {
        const pathname = window.location.pathname.replace(/^\/+/, '');
        return pathname === 'order.html';
    } catch (error) {
        return false;
    }
}

function navigateToOrderPage() {
    try {
        window.location.href = new URL('order.html', window.location.origin).toString();
    } catch (error) {
        window.location.href = 'order.html';
    }
}

function registerAddFundsPopupLinks() {
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach((link) => {
        if (!shouldEnhanceAddFundsLink(link)) {
            return;
        }
        bindAddFundsPopupLink(link);
    });
}

function shouldEnhanceAddFundsLink(link) {
    if (!link || addFundsPopupBoundLinks.has(link) || link.dataset.noPopup === 'true') {
        return false;
    }

    const rawHref = (link.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return false;
    }

    if (link.target && link.target !== '_self') {
        return false;
    }

    let pathname = '';
    try {
        pathname = new URL(rawHref, window.location.origin).pathname.replace(/^\/+/, '');
    } catch (error) {
        pathname = rawHref.replace(/^\/+/, '');
    }

    if (!pathname || pathname.startsWith('admin/')) {
        return false;
    }

    return pathname === 'addfunds.html';
}

function bindAddFundsPopupLink(link) {
    if (!link || addFundsPopupBoundLinks.has(link)) {
        return;
    }
    link.addEventListener('click', handleAddFundsPopupClick);
    addFundsPopupBoundLinks.add(link);
}

function handleAddFundsPopupClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    if (document.body.classList.contains('popup-mode') || isCurrentAddFundsPage()) {
        return;
    }

    event.preventDefault();
    const popupRef = openAppPopup('addfunds.html', {
        name: 'botzzz-addfunds-popup',
        width: 960,
        height: 740
    });

    if (!popupRef) {
        navigateToAddFundsPage();
    }
}

function isCurrentAddFundsPage() {
    try {
        const pathname = window.location.pathname.replace(/^\/+/, '');
        return pathname === 'addfunds.html';
    } catch (error) {
        return false;
    }
}

function navigateToAddFundsPage() {
    try {
        window.location.href = new URL('addfunds.html', window.location.origin).toString();
    } catch (error) {
        window.location.href = 'addfunds.html';
    }
}

function registerServicesPopupLinks() {
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach((link) => {
        if (!shouldEnhanceServicesLink(link)) {
            return;
        }
        bindServicesPopupLink(link);
    });
}

function shouldEnhanceServicesLink(link) {
    if (!link || servicesPopupBoundLinks.has(link) || link.dataset.noPopup === 'true') {
        return false;
    }

    const rawHref = (link.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return false;
    }

    if (link.target && link.target !== '_self') {
        return false;
    }

    let pathname = '';
    try {
        pathname = new URL(rawHref, window.location.origin).pathname.replace(/^\/+/, '');
    } catch (error) {
        pathname = rawHref.replace(/^\/+/, '');
    }

    if (!pathname || pathname.startsWith('admin/')) {
        return false;
    }

    return pathname === 'services.html';
}

function bindServicesPopupLink(link) {
    if (!link || servicesPopupBoundLinks.has(link)) {
        return;
    }
    link.addEventListener('click', handleServicesPopupClick);
    servicesPopupBoundLinks.add(link);
}

function handleServicesPopupClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    if (document.body.classList.contains('popup-mode') || isCurrentServicesPage()) {
        return;
    }

    event.preventDefault();
    const popupRef = openAppPopup('services.html', {
        name: 'botzzz-services-popup',
        width: 1100,
        height: 760
    });

    if (!popupRef) {
        navigateToServicesPage();
    }
}

function isCurrentServicesPage() {
    try {
        const pathname = window.location.pathname.replace(/^\/+/, '');
        return pathname === 'services.html';
    } catch (error) {
        return false;
    }
}

function navigateToServicesPage() {
    try {
        window.location.href = new URL('services.html', window.location.origin).toString();
    } catch (error) {
        window.location.href = 'services.html';
    }
}

function registerApiPopupLinks() {
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach((link) => {
        if (!shouldEnhanceApiLink(link)) {
            return;
        }
        bindApiPopupLink(link);
    });
}

function shouldEnhanceApiLink(link) {
    if (!link || apiPopupBoundLinks.has(link) || link.dataset.noPopup === 'true') {
        return false;
    }

    const rawHref = (link.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return false;
    }

    if (link.target && link.target !== '_self') {
        return false;
    }

    let pathname = '';
    try {
        pathname = new URL(rawHref, window.location.origin).pathname.replace(/^\/+/, '');
    } catch (error) {
        pathname = rawHref.replace(/^\/+/, '');
    }

    if (!pathname || pathname.startsWith('admin/')) {
        return false;
    }

    return pathname === 'api.html';
}

function bindApiPopupLink(link) {
    if (!link || apiPopupBoundLinks.has(link)) {
        return;
    }
    link.addEventListener('click', handleApiPopupClick);
    apiPopupBoundLinks.add(link);
}

function handleApiPopupClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    if (document.body.classList.contains('popup-mode') || isCurrentApiPage()) {
        return;
    }

    event.preventDefault();
    const popupRef = openAppPopup('api.html', {
        name: 'botzzz-api-popup',
        width: 1100,
        height: 760
    });

    if (!popupRef) {
        navigateToApiPage();
    }
}

function isCurrentApiPage() {
    try {
        const pathname = window.location.pathname.replace(/^\/+/, '');
        return pathname === 'api.html';
    } catch (error) {
        return false;
    }
}

function navigateToApiPage() {
    try {
        window.location.href = new URL('api.html', window.location.origin).toString();
    } catch (error) {
        window.location.href = 'api.html';
    }
}

function registerDashboardPopupLinks() {
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach((link) => {
        if (!shouldEnhanceDashboardLink(link)) {
            return;
        }
        bindDashboardPopupLink(link);
    });
}

function shouldEnhanceDashboardLink(link) {
    if (!link || dashboardPopupBoundLinks.has(link) || link.dataset.noPopup === 'true') {
        return false;
    }

    // Only upgrade links that explicitly request popup behavior.
    if (link.dataset.dashboardPopup !== 'true') {
        return false;
    }

    const rawHref = (link.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return false;
    }

    if (link.target && link.target !== '_self') {
        return false;
    }

    let pathname = '';
    try {
        pathname = new URL(rawHref, window.location.origin).pathname.replace(/^\/+/, '');
    } catch (error) {
        pathname = rawHref.replace(/^\/+/, '');
    }

    if (!pathname || pathname.startsWith('admin/')) {
        return false;
    }

    return pathname === 'dashboard.html';
}

function bindDashboardPopupLink(link) {
    if (!link || dashboardPopupBoundLinks.has(link)) {
        return;
    }
    link.addEventListener('click', handleDashboardPopupClick);
    dashboardPopupBoundLinks.add(link);
}

function handleDashboardPopupClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    if (document.body.classList.contains('popup-mode') || isCurrentDashboardPage()) {
        return;
    }

    event.preventDefault();
    const popupRef = openAppPopup('dashboard.html', {
        name: 'botzzz-dashboard-popup',
        width: 1200,
        height: 820
    });

    if (!popupRef) {
        navigateToDashboardPage();
    }
}

function isCurrentDashboardPage() {
    try {
        const pathname = window.location.pathname.replace(/^\/+/, '');
        return pathname === 'dashboard.html';
    } catch (error) {
        return false;
    }
}

function navigateToDashboardPage() {
    try {
        window.location.href = new URL('dashboard.html', window.location.origin).toString();
    } catch (error) {
        window.location.href = 'dashboard.html';
    }
}

function registerContactPopupLinks() {
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach((link) => {
        if (!shouldEnhanceContactLink(link)) {
            return;
        }
        bindContactPopupLink(link);
    });
}

function shouldEnhanceContactLink(link) {
    if (!link || contactPopupBoundLinks.has(link) || link.dataset.noPopup === 'true') {
        return false;
    }

    const rawHref = (link.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return false;
    }

    if (link.target && link.target !== '_self') {
        return false;
    }

    let pathname = '';
    try {
        pathname = new URL(rawHref, window.location.origin).pathname.replace(/^\/+/, '');
    } catch (error) {
        pathname = rawHref.replace(/^\/+/, '');
    }

    if (!pathname || pathname.startsWith('admin/')) {
        return false;
    }

    return pathname === 'contact.html';
}

function bindContactPopupLink(link) {
    if (!link || contactPopupBoundLinks.has(link)) {
        return;
    }
    link.addEventListener('click', handleContactPopupClick);
    contactPopupBoundLinks.add(link);
}

function handleContactPopupClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    if (document.body.classList.contains('popup-mode') || isCurrentContactPage()) {
        return;
    }

    event.preventDefault();
    const popupRef = openAppPopup('contact.html', {
        name: 'botzzz-contact-popup',
        width: 960,
        height: 760
    });

    if (!popupRef) {
        navigateToContactPage();
    }
}

function isCurrentContactPage() {
    try {
        const pathname = window.location.pathname.replace(/^\/+/, '');
        return pathname === 'contact.html';
    } catch (error) {
        return false;
    }
}

function navigateToContactPage() {
    try {
        window.location.href = new URL('contact.html', window.location.origin).toString();
    } catch (error) {
        window.location.href = 'contact.html';
    }
}

function registerApiDashboardPopupLinks() {
    const anchors = document.querySelectorAll('a[href]');
    anchors.forEach((link) => {
        if (!shouldEnhanceApiDashboardLink(link)) {
            return;
        }
        bindApiDashboardPopupLink(link);
    });
}

function shouldEnhanceApiDashboardLink(link) {
    if (!link || apiDashboardPopupBoundLinks.has(link) || link.dataset.noPopup === 'true') {
        return false;
    }

    const rawHref = (link.getAttribute('href') || '').trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:') || rawHref.startsWith('javascript:')) {
        return false;
    }

    if (link.target && link.target !== '_self') {
        return false;
    }

    let pathname = '';
    try {
        pathname = new URL(rawHref, window.location.origin).pathname.replace(/^\/+/, '');
    } catch (error) {
        pathname = rawHref.replace(/^\/+/, '');
    }

    if (!pathname || pathname.startsWith('admin/')) {
        return false;
    }

    return pathname === 'api-dashboard.html';
}

function bindApiDashboardPopupLink(link) {
    if (!link || apiDashboardPopupBoundLinks.has(link)) {
        return;
    }
    link.addEventListener('click', handleApiDashboardPopupClick);
    apiDashboardPopupBoundLinks.add(link);
}

function handleApiDashboardPopupClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    if (document.body.classList.contains('popup-mode') || isCurrentApiDashboardPage()) {
        return;
    }

    event.preventDefault();
    const popupRef = openAppPopup('api-dashboard.html', {
        name: 'botzzz-api-dashboard-popup',
        width: 1200,
        height: 820
    });

    if (!popupRef) {
        navigateToApiDashboardPage();
    }
}

function isCurrentApiDashboardPage() {
    try {
        const pathname = window.location.pathname.replace(/^\/+/, '');
        return pathname === 'api-dashboard.html';
    } catch (error) {
        return false;
    }
}

function navigateToApiDashboardPage() {
    try {
        window.location.href = new URL('api-dashboard.html', window.location.origin).toString();
    } catch (error) {
        window.location.href = 'api-dashboard.html';
    }
}

function buildAuthRedirectParam() {
    const path = window.location.pathname.replace(/^\//, '');
    const search = window.location.search || '';
    return search ? `${path}${search}` : path;
}

if (typeof window !== 'undefined') {
    window.openAppPopup = openAppPopup;
}

// Mobile Navigation Toggle
document.addEventListener('DOMContentLoaded', function() {
    // Check authentication and update navigation
    updateAuthNavigation();
    registerAuthPopupLinks();
    registerTicketsPopupLinks();
    registerOrderPopupLinks();
    registerAddFundsPopupLinks();
    registerServicesPopupLinks();
    registerApiPopupLinks();
    registerDashboardPopupLinks();
    registerContactPopupLinks();
    registerApiDashboardPopupLinks();
    
    const mobileToggle = document.getElementById('mobileToggle');
    const navMenu = document.getElementById('navMenu');
    
    if (mobileToggle) {
        mobileToggle.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            this.classList.toggle('active');
        });
    }
    
    // Close mobile menu when clicking on a link
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            if (window.innerWidth <= 768) {
                navMenu.classList.remove('active');
                mobileToggle.classList.remove('active');
            }
        });
    });
    
    // Close mobile menu when clicking outside
    document.addEventListener('click', function(event) {
        if (!navMenu || !mobileToggle) return; // Guard against null elements
        
        const isClickInsideNav = navMenu.contains(event.target);
        const isClickOnToggle = mobileToggle.contains(event.target);
        
        if (!isClickInsideNav && !isClickOnToggle && navMenu.classList.contains('active')) {
            navMenu.classList.remove('active');
            mobileToggle.classList.remove('active');
        }
    });
});

// Smooth Scroll for Anchor Links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href !== '#' && href !== '') {
            e.preventDefault();
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        }
    });
});

// Active Navigation Link on Scroll
window.addEventListener('scroll', function() {
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');
    
    let current = '';
    
    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.clientHeight;
        if (pageYOffset >= sectionTop - 200) {
            current = section.getAttribute('id');
        }
    });
    
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === '#' + current) {
            link.classList.add('active');
        }
    });
});

// Navbar Background on Scroll
window.addEventListener('scroll', function() {
    const navbar = document.querySelector('.navbar');
    if (navbar) {
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(0, 0, 0, 0.98)';
        } else {
            navbar.style.background = 'rgba(0, 0, 0, 0.95)';
        }
    }
});

// Animate Elements on Scroll
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate-fade-in');
            observer.unobserve(entry.target);
        }
    });
}, observerOptions);

// Observe all cards and sections
const animateElements = document.querySelectorAll('.step-card, .service-card, .feature-card, .faq-item');
animateElements.forEach(el => observer.observe(el));

// Form Validation Helper
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
}

function validateURL(url) {
    try {
        new URL(url);
        return true;
    } catch (err) {
        return false;
    }
}

// Show Success/Error Messages
function showMessage(message, type = 'success') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `alert alert-${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 80px;
        right: 20px;
        background: ${type === 'success' ? '#10b981' : '#ef4444'};
        color: white;
        padding: 1rem 2rem;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => messageDiv.remove(), 300);
    }, 3000);
}

(function registerFetchGuardListeners() {
    if (typeof window === 'undefined') {
        return;
    }

    let lastToastAt = 0;
    const toastCooldownMs = 8000;

    window.addEventListener('fetchguard:failure', () => {
        // Suppress retry messages to customers
        // const now = Date.now();
        // if (now - lastToastAt < toastCooldownMs) {
        //     return;
        // }
        // lastToastAt = now;
        // showMessage('We are retrying the backend request. Hang tight!', 'error');
    });

    window.addEventListener('fetchguard:circuit-open', (event) => {
        // Suppress circuit breaker messages to customers
        // const endpoint = event.detail?.endpoint || 'backend';
        // showMessage(`${endpoint} is cooling down for a few seconds due to repeated failures.`, 'warning');
    });

    window.addEventListener('fetchguard:network-status', (event) => {
        const isOnline = event.detail?.online !== false;
        document.documentElement.dataset.networkStatus = isOnline ? 'online' : 'offline';
    });
})();

// Add slide animation styles
if (!document.querySelector('style[data-alert-animations="true"]')) {
    const style = document.createElement('style');
    style.dataset.alertAnimations = 'true';
    style.textContent = `
        @keyframes slideIn {
            from { transform: translateX(400px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes slideOut {
            from { transform: translateX(0); opacity: 1; }
            to { transform: translateX(400px); opacity: 0; }
        }
    `;
    document.head.appendChild(style);
}

// Loading Spinner Helper
function showLoading(button) {
    button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.innerHTML = '<span style="display: inline-block; width: 20px; height: 20px; border: 3px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.6s linear infinite;"></span> Processing...';
    
    if (!document.querySelector('style[data-spinner-animation="true"]')) {
        const style = document.createElement('style');
        style.dataset.spinnerAnimation = 'true';
        style.textContent = `
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
        `;
        document.head.appendChild(style);
    }
}

function hideLoading(button) {
    button.disabled = false;
    button.textContent = button.dataset.originalText || 'Submit';
}

(function installPopupMessageHub() {
    if (typeof window === 'undefined') {
        return;
    }

    const trustedOrigin = window.location.origin;

    function dispatchPopupEvent(name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    function formatCurrency(amount) {
        const numeric = Number(amount);
        if (!Number.isFinite(numeric)) {
            return '$0.00';
        }
        return `$${numeric.toFixed(2)}`;
    }

    function persistAuthPayload(detail) {
        if (detail?.token) {
            localStorage.setItem('token', detail.token);
        }
        if (detail?.user) {
            localStorage.setItem('user', JSON.stringify(detail.user));
        }
        if (typeof updateAuthNavigation === 'function') {
            updateAuthNavigation();
        }
    }

    const handlers = {
        CONTACT_MESSAGE_SENT(detail) {
            showMessage('Support request sent successfully.', 'success');
            dispatchPopupEvent('popup:contact-message-sent', detail);
        },
        ORDER_CREATED(detail) {
            const orderNumber = detail?.order?.order_number || detail?.order?.id;
            const label = orderNumber ? ` #${orderNumber}` : '';
            showMessage(`Order${label} created successfully.`, 'success');
            dispatchPopupEvent('popup:order-created', detail);
            // Trigger balance refresh across all tabs after order created (deducts balance)
            if (window.BalanceSync) {
                // If new balance is included in detail, set it directly
                if (detail?.order?.user_balance !== undefined) {
                    window.BalanceSync.setBalance(detail.order.user_balance, { reason: 'order-created' });
                } else {
                    window.BalanceSync.refresh({ reason: 'order-created' });
                }
            }
        },
        ADD_FUNDS_ORDER_CREATED(detail) {
            const orderId = detail?.orderId ? ` #${detail.orderId}` : '';
            const amount = formatCurrency(detail?.amount);
            showMessage(`Add-funds request${orderId} initialized for ${amount}.`, 'success');
            dispatchPopupEvent('popup:add-funds-order-created', detail);
        },
        PAYMENT_SUCCESS(detail) {
            showMessage('Payment confirmed. Your balance will refresh shortly.', 'success');
            dispatchPopupEvent('popup:payment-success', detail);
            // Trigger balance refresh across all tabs after payment success
            if (window.BalanceSync) {
                window.BalanceSync.refresh({ reason: 'payment-success' });
            }
        },
        PAYMENT_FAILED(detail) {
            showMessage('Payment failed. Please try again or contact support.', 'error');
            dispatchPopupEvent('popup:payment-failed', detail);
        },
        TICKET_CREATED(detail) {
            showMessage('Ticket created successfully.', 'success');
            dispatchPopupEvent('popup:ticket-created', detail);
        },
        TICKET_REPLIED(detail) {
            showMessage('Ticket reply sent.', 'success');
            dispatchPopupEvent('popup:ticket-replied', detail);
        },
        TICKET_CLOSED(detail) {
            showMessage('Ticket closed successfully.', 'success');
            dispatchPopupEvent('popup:ticket-closed', detail);
        },
        API_KEY_CREATED(detail) {
            showMessage('API key generated.', 'success');
            dispatchPopupEvent('popup:api-key-created', detail);
        },
        API_KEY_DELETED(detail) {
            showMessage('API key deleted.', 'success');
            dispatchPopupEvent('popup:api-key-deleted', detail);
        },
        PROVIDER_ADDED(detail) {
            showMessage(`${detail?.providerName || 'Provider'} connected successfully.`, 'success');
            dispatchPopupEvent('popup:provider-added', detail);
        },
        PROVIDER_DELETED(detail) {
            showMessage('Provider removed.', 'success');
            dispatchPopupEvent('popup:provider-deleted', detail);
        },
        PROVIDER_SYNCED(detail) {
            const count = detail?.servicesCount ?? 0;
            showMessage(`Provider sync complete (${count} services).`, 'success');
            dispatchPopupEvent('popup:provider-synced', detail);
        },
        SERVICES_DIAGNOSTIC_COMPLETED(detail) {
            const transport = detail?.transport === 'xhr' ? 'XMLHttpRequest' : 'Fetch API';
            const duration = typeof detail?.durationMs === 'number' ? `${detail.durationMs}ms` : 'completed';
            const services = detail?.serviceCount ?? 0;
            const success = detail?.success === true && services > 0;
            const tone = success ? 'success' : 'warning';
            const message = success
                ? `${transport} diagnostic passed in ${duration} (${services} services).`
                : `${transport} diagnostic finished with no services. Check the response.`;
            showMessage(message, tone);
            dispatchPopupEvent('popup:test-services-completed', detail);
        },
        SERVICES_DIAGNOSTIC_FAILED(detail) {
            const transport = detail?.transport === 'xhr' ? 'XMLHttpRequest' : 'Fetch API';
            const reason = detail?.message || 'Diagnostic failed.';
            showMessage(`${transport} diagnostic failed: ${reason}`, 'error');
            dispatchPopupEvent('popup:test-services-failed', detail);
        },
        USER_LOGGED_OUT() {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            sessionStorage.clear();
            if (typeof updateAuthNavigation === 'function') {
                updateAuthNavigation();
            }
            showMessage('Session closed.', 'success');
            dispatchPopupEvent('popup:user-logged-out', {});
        },
        USER_LOGGED_IN(detail) {
            persistAuthPayload(detail);
            const name = detail?.user?.username || detail?.user?.full_name || 'there';
            showMessage(`Welcome back, ${name}!`, 'success');
            dispatchPopupEvent('popup:user-logged-in', detail);
        },
        USER_SIGNED_UP(detail) {
            persistAuthPayload(detail);
            showMessage('Account created successfully.', 'success');
            dispatchPopupEvent('popup:user-signed-up', detail);
            dispatchPopupEvent('popup:user-logged-in', detail);
        },
        AUTH_REQUIRED(detail) {
            showMessage('Please sign in to continue.', 'error');
            dispatchPopupEvent('popup:auth-required', detail);
            setTimeout(() => {
                const currentPath = encodeURIComponent(window.location.pathname.replace(/^\//, ''));
                window.location.href = `signin.html?redirect=${currentPath}`;
            }, 600);
        }
    };

    window.addEventListener('message', (event) => {
        if (!event?.data || event.origin !== trustedOrigin) {
            return;
        }

        const type = event.data.type;
        if (!type || typeof type !== 'string') {
            return;
        }

        const handler = handlers[type];
        if (handler) {
            handler(event.data);
        } else {
            dispatchPopupEvent('popup:message', event.data);
        }
    });
})();

// Update Navigation Based on Authentication
function updateAuthNavigation() {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    const authNavItem = document.getElementById('authNavItem');
    
    if (!authNavItem) return;
    
    if (token && user) {
        // User is logged in
        try {
            const userData = JSON.parse(user);
            authNavItem.innerHTML = `
                <a href="dashboard.html" class="nav-link" style="color: var(--primary-pink);">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;">
                        <rect x="3" y="3" width="7" height="7"/>
                        <rect x="14" y="3" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/>
                        <rect x="3" y="14" width="7" height="7"/>
                    </svg>
                    ${userData.username || 'Dashboard'}
                </a>
                <a href="#" class="nav-link" data-logout-link style="color: var(--text-gray); margin-left: 10px;">Logout</a>
            `;
            
            // Add logout handler
            const logoutNavLink = authNavItem.querySelector('[data-logout-link]');
            if (logoutNavLink) {
                logoutNavLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    localStorage.removeItem('token');
                    localStorage.removeItem('user');
                    sessionStorage.clear();
                    window.location.href = 'index.html';
                });
            }

            registerDashboardPopupLinks();
        } catch (error) {
            console.error('Error parsing user data:', error);
        }
    } else {
        // User is not logged in
        authNavItem.innerHTML = '<a href="signin.html" class="nav-link btn-primary" data-auth-popup="signin">Sign In</a>';
        registerAuthPopupLinks();
    }
}

console.log('🚀 BOTZZZ773 SMM Panel Loaded Successfully!');
