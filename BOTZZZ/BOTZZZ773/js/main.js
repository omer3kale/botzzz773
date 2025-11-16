// ==========================================
// BOTZZZ773 - Main JavaScript File
// ==========================================

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

// Mobile Navigation Toggle
document.addEventListener('DOMContentLoaded', function() {
    // Check authentication and update navigation
    updateAuthNavigation();
    
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
    if (window.scrollY > 50) {
        navbar.style.background = 'rgba(0, 0, 0, 0.98)';
    } else {
        navbar.style.background = 'rgba(0, 0, 0, 0.95)';
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
        const now = Date.now();
        if (now - lastToastAt < toastCooldownMs) {
            return;
        }
        lastToastAt = now;
        showMessage('We are retrying the backend request. Hang tight!', 'error');
    });

    window.addEventListener('fetchguard:circuit-open', (event) => {
        const endpoint = event.detail?.endpoint || 'backend';
        showMessage(`${endpoint} is cooling down for a few seconds due to repeated failures.`, 'warning');
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
        } catch (error) {
            console.error('Error parsing user data:', error);
        }
    } else {
        // User is not logged in
        authNavItem.innerHTML = '<a href="signin.html" class="nav-link btn-primary">Sign In</a>';
    }
}

console.log('🚀 BOTZZZ773 SMM Panel Loaded Successfully!');
