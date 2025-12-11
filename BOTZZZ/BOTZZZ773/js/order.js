// ==========================================
// Order Page JavaScript
// ==========================================

const SERVICES_ENDPOINT = '/.netlify/functions/services?audience=customer';
const SERVICES_FETCH_TIMEOUT = 15000;
const SERVICES_FETCH_RETRIES = 2;

let servicesData = [];
let servicesFetchController = null;
let pendingServiceSelection = null;
let serviceStatusController = null;
let networkStatusController = null;
let isPopupMode = false;
let authGuardTriggered = false;
let userDiscountRate = 0; // User's discount percentage (0-100)

const AUTH_ALERT_MESSAGE = 'You must be signed in to place orders. Please sign in or create an account.';

const delay = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

function generateServiceFallbackId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `svc-${crypto.randomUUID()}`;
    }
    return `svc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toBooleanFlag(value) {
    if (value === undefined || value === null) return false;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return false;
    return ['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(normalized);
}

function toNumberOrNull(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function normalizeServiceRecord(service) {
    // Enhanced fallback pattern for service identifiers (consistent with services.js and admin-orders.js)
    const rawId = service?.id 
        ?? service?.public_id 
        ?? service?.publicId 
        ?? service?.provider_service_id 
        ?? service?.providerServiceId 
        ?? service?.provider_order_id 
        ?? service?.providerOrderId;
    const serviceId = rawId !== undefined && rawId !== null ? String(rawId) : generateServiceFallbackId();
    const categoryName = service?.category ? String(service.category) : 'Other';

    const minCandidate = toNumberOrNull(service?.min_quantity ?? service?.min_order);
    const minQuantity = Number.isFinite(minCandidate) && minCandidate > 0 ? minCandidate : 10;

    const rawMax = service?.max_quantity ?? service?.max_order;
    let maxQuantity;
    if (rawMax === null || rawMax === undefined || String(rawMax).toLowerCase() === 'infinity') {
        maxQuantity = Infinity;
    } else {
        const maxCandidate = toNumberOrNull(rawMax);
        maxQuantity = Number.isFinite(maxCandidate) && maxCandidate > 0 ? maxCandidate : 1000000;
    }

    const rateCandidate = toNumberOrNull(service?.retail_rate ?? service?.rate ?? service?.price ?? 0) ?? 0;
    const publicIdNumeric = toNumberOrNull(service?.public_id ?? service?.publicId);
    const slotNumeric = toNumberOrNull(service?.customer_portal_slot ?? service?.customerPortalSlot);
    const providerName = service?.provider?.name || service?.provider_name || 'Curated Provider';

    return {
        ...service,
        id: serviceId,
        category: categoryName,
        rate: rateCandidate,
        min_quantity: minQuantity,
        max_quantity: maxQuantity,
        publicId: publicIdNumeric,
        providerName,
        customer_portal_slot: slotNumeric
    };
}

function groupServicesByCategory(services) {
    return services.reduce((groups, service) => {
        const category = service?.category ? String(service.category) : 'Other';
        const normalizedCategory = category.charAt(0).toUpperCase() + category.slice(1);
        if (!groups[normalizedCategory]) {
            groups[normalizedCategory] = [];
        }
        groups[normalizedCategory].push(service);
        return groups;
    }, {});
}

function applyPendingServiceSelection() {
    if (!pendingServiceSelection) {
        return;
    }
    const serviceSelect = document.getElementById('service');
    if (!serviceSelect || servicesData.length === 0) {
        return;
    }
    const match = servicesData.find(service => String(service.id) === String(pendingServiceSelection));
    if (!match) {
        console.warn('[ORDER] Requested service not found in curated list:', pendingServiceSelection);
        pendingServiceSelection = null;
        return;
    }
    serviceSelect.value = String(match.id);
    serviceSelect.dispatchEvent(new Event('change', { bubbles: true }));
    pendingServiceSelection = null;
}

// Helper to consistently manage the service dropdown state
function setServiceSelectPlaceholder(selectEl, message, disabled = true) {
    if (!selectEl) {
        return;
    }

    // Clear current options and show a single descriptive placeholder option
    selectEl.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = message;
    placeholder.disabled = true;
    placeholder.selected = true;
    selectEl.appendChild(placeholder);
    selectEl.disabled = disabled;
}

function createServiceStatusController() {
    const container = document.querySelector('[data-service-status]');
    if (!container) {
        return null;
    }

    const iconEl = container.querySelector('[data-status-icon]');
    const labelEl = container.querySelector('[data-status-label]');
    const helperEl = container.querySelector('[data-status-helper]');
    const actionBtn = container.querySelector('[data-retry-services]');

    // Hide all status elements from customers
    if (iconEl) iconEl.style.display = 'none';
    if (labelEl) labelEl.style.display = 'none';
    if (helperEl) helperEl.style.display = 'none';

    const defaults = {
        loading: {
            showRetry: false
        },
        retrying: {
            showRetry: false
        },
        success: {
            showRetry: false
        },
        error: {
            showRetry: true
        },
        empty: {
            showRetry: true
        }
    };

    let retryHandler = null;

    function setState(state = 'loading', overrides = {}) {
        const config = { ...(defaults[state] || defaults.loading), ...overrides };
        container.dataset.state = state;
        if (actionBtn) {
            actionBtn.hidden = !config.showRetry;
            actionBtn.disabled = false;
        }
    }

    if (actionBtn) {
        actionBtn.addEventListener('click', () => {
            if (retryHandler) {
                actionBtn.disabled = true;
                retryHandler();
            }
        });
    }

    setState('loading');

    return {
        setState,
        onRetry(handler) {
            retryHandler = handler;
        }
    };
}

function createNetworkPillController() {
    const pill = document.querySelector('[data-network-pill]');
    if (!pill) {
        return null;
    }
    const labelEl = pill.querySelector('[data-network-label]');
    const dotEl = pill.querySelector('.status-dot');

    function setStatus(isOnline) {
        const state = isOnline ? 'online' : 'offline';
        pill.hidden = false;
        pill.dataset.status = state;
        if (labelEl) {
            labelEl.textContent = isOnline ? 'Connection stable' : 'Offline – retrying';
        }
        if (dotEl) {
            dotEl.setAttribute('aria-hidden', 'true');
        }
    }

    setStatus(navigator.onLine !== false);

    window.addEventListener('online', () => setStatus(true));
    window.addEventListener('offline', () => setStatus(false));

    return { setStatus };
}

// ============= BALANCE DISPLAY FOR ORDER PAGE =============
async function initializeBalanceDisplay() {
    const balanceDisplay = document.getElementById('orderPageBalance');
    if (!balanceDisplay) return;

    // Configure BalanceSync for order page
    if (window.BalanceSync) {
        window.BalanceSync.configure({
            element: balanceDisplay,
            key: 'botzzz773-balance'
        });

        // Subscribe to balance changes
        window.BalanceSync.subscribe(({ balance }) => {
            if (Number.isFinite(balance)) {
                balanceDisplay.textContent = `$${balance.toFixed(2)}`;
            }
        });

        // Try to get cached balance first
        const cached = window.BalanceSync.getBalance();
        if (Number.isFinite(cached)) {
            balanceDisplay.textContent = `$${cached.toFixed(2)}`;
        }
    }

    // Load fresh balance and discount rate from server
    try {
        const token = resolveAuthToken('balance-load');
        if (!token) return;

        const response = await fetch('/.netlify/functions/users', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const data = await response.json();
            // Regular user gets their own data in 'user' object
            const userData = data?.user || data;
            const balance = Number(userData?.balance);
            if (Number.isFinite(balance)) {
                balanceDisplay.textContent = `$${balance.toFixed(2)}`;
                if (window.BalanceSync) {
                    window.BalanceSync.setBalance(balance, { reason: 'order-page-load' });
                }
            }
            
            // Store user's discount rate for price calculations
            const discount = Number(userData?.discount_rate ?? 0);
            if (Number.isFinite(discount) && discount >= 0 && discount <= 100) {
                userDiscountRate = discount;
                console.log('[ORDER] User discount rate:', userDiscountRate + '%');
            }
        }
    } catch (err) {
        console.warn('[ORDER] Failed to load user data:', err.message);
    }
}

// Show message to user
function showMessage(message, type = 'info') {
    // Create message element if it doesn't exist
    let messageBox = document.querySelector('[data-order-message]');
    if (!messageBox) {
        messageBox = document.createElement('div');
        messageBox.setAttribute('data-order-message', 'true');
        messageBox.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            padding: 16px 24px;
            border-radius: 8px;
            font-weight: 500;
            z-index: 10000;
            max-width: 500px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideDown 0.3s ease;
        `;
        document.body.appendChild(messageBox);
    }
    
    // Set colors based on type
    const colors = {
        success: { bg: '#10b981', text: '#ffffff' },
        error: { bg: '#ef4444', text: '#ffffff' },
        info: { bg: '#3b82f6', text: '#ffffff' }
    };
    
    const color = colors[type] || colors.info;
    messageBox.style.backgroundColor = color.bg;
    messageBox.style.color = color.text;
    messageBox.textContent = message;
    messageBox.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        messageBox.style.display = 'none';
    }, 5000);
}

// Validation helpers
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validateURL(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const orderForm = document.getElementById('orderForm');
    const serviceSelect = document.getElementById('service');
    const quantityInput = document.getElementById('quantity');
    const estimatedPriceEl = document.getElementById('estimatedPrice');

    const urlParams = new URLSearchParams(window.location.search);
    isPopupMode = urlParams.get('popup') === '1';
    if (isPopupMode) {
        enablePopupSurface();
    }

    if (!resolveAuthToken('initial-load')) {
        return;
    }

    serviceStatusController = createServiceStatusController();
    networkStatusController = createNetworkPillController();

    if (serviceStatusController) {
        serviceStatusController.onRetry(() => {
            loadServices({ manualRetry: true });
        });
    }

    pendingServiceSelection = urlParams.get('service');

    loadServices();
    
    // Initialize balance display for order page
    initializeBalanceDisplay();
    
    // Update estimated price on input change
    function updatePrice() {
        const serviceId = serviceSelect?.value;
        const selectedOption = serviceSelect?.selectedOptions?.[0] || null;
        const min = selectedOption ? Number(selectedOption.dataset.min) : 10;
    const max = selectedOption ? (selectedOption.dataset.max === 'Infinity' ? Infinity : Number(selectedOption.dataset.max)) : 1000000;

        if (quantityInput) {
            quantityInput.min = Number.isFinite(min) ? min : 1;
            quantityInput.max = Number.isFinite(max) ? max : '';

            const hint = quantityInput.nextElementSibling;
            if (hint) {
                const minLabel = Number.isFinite(min) ? formatNumber(min) : '0';
                const maxLabel = Number.isFinite(max) ? formatNumber(max) : '∞';
                hint.textContent = `Minimum: ${minLabel} • Maximum: ${maxLabel}`;
                hint.style.color = '#64748B';
            }
        }

        const quantity = Number(quantityInput?.value) || 0;
        const service = servicesData.find(s => String(s.id) === String(serviceId));

        if (estimatedPriceEl) {
            if (service && quantity > 0) {
                const rate = Number(service.rate || 0);
                let price = (quantity / 1000) * rate;
                
                // Apply user's discount if they have one
                if (userDiscountRate > 0 && userDiscountRate <= 100) {
                    const discountAmount = price * (userDiscountRate / 100);
                    price = price - discountAmount;
                    
                    // Show discount info
                    const discountBadge = document.getElementById('discountBadge');
                    if (discountBadge) {
                        discountBadge.textContent = `-${userDiscountRate}% discount applied`;
                        discountBadge.style.display = 'block';
                    }
                }
                
                estimatedPriceEl.textContent = '$' + price.toFixed(2);
                estimatedPriceEl.style.animation = 'pulse 0.5s ease';
            } else {
                estimatedPriceEl.textContent = '$0.00';
                const discountBadge = document.getElementById('discountBadge');
                if (discountBadge) {
                    discountBadge.style.display = 'none';
                }
            }
        }
    }
    
    // Add pulse animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }
    `;
    document.head.appendChild(style);
    
    serviceSelect?.addEventListener('change', updatePrice);
    quantityInput?.addEventListener('input', updatePrice);
    
    // Handle form submission
    if (orderForm) {
        orderForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Get form data
            const formData = new FormData(orderForm);
            const data = {
                platform: formData.get('platform'),
                serviceType: formData.get('serviceType'),
                link: formData.get('link'),
                quantity: formData.get('quantity'),
                notes: formData.get('notes')
            };
            
            // Validate
            
            if (!validateURL(data.link)) {
                showMessage('Please enter a valid URL', 'error');
                return;
            }
            
            const serviceId = serviceSelect?.value;
            if (!serviceId) {
                showMessage('Please select a service', 'error');
                return;
            }

            const service = servicesData.find(s => String(s.id) === String(serviceId));
            if (!service) {
                showMessage('Selected service is no longer available. Please refresh.', 'error');
                return;
            }

            const quantityValue = Number(data.quantity);
            const minQuantity = Number.isFinite(service.min_quantity) && service.min_quantity > 0
                ? service.min_quantity
                : 10;
            const maxQuantity = service.max_quantity === Infinity
                ? Infinity
                : (Number.isFinite(service.max_quantity) && service.max_quantity > 0
                    ? service.max_quantity
                    : 1000000);

            if (!Number.isFinite(quantityValue) || quantityValue < minQuantity || quantityValue > maxQuantity) {
                showMessage(`Quantity must be between ${formatNumber(minQuantity)} and ${formatNumber(maxQuantity)}.`, 'error');
                return;
            }
            
            // Check authentication first
            const token = resolveAuthToken('submit-order');
            if (!token) {
                return;
            }
            
            // Show loading
            const submitBtn = orderForm.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>Processing...</span>';
            
            // Prepare order payload
            const orderPayload = {
                serviceId: String(serviceId),
                link: data.link,
                quantity: quantityValue,
                notes: data.notes || ''
            };
            
            // Debug log
            console.log('[ORDER] Submitting order:', orderPayload);
            
            try {
                // Call Orders API
                const response = await fetch('/.netlify/functions/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(orderPayload)
                });

                const result = await response.json();
                
                console.log('[ORDER] Response:', response.status, result);

                if (response.ok && result.success) {
                    showMessage(`Order #${result.order.order_number || result.order.id} created successfully!`, 'success');
                    orderForm.reset();
                    updatePrice();
                    
                    // Update balance via BalanceSync (order deducts balance)
                    if (window.BalanceSync && result.newBalance !== undefined) {
                        window.BalanceSync.setBalance(result.newBalance, { reason: 'order-created' });
                        console.log('[ORDER] Balance updated via BalanceSync:', result.newBalance);
                    } else if (window.BalanceSync) {
                        // Fallback: refresh balance from server
                        window.BalanceSync.refresh({ reason: 'order-created' });
                    }
                    
                    // Scroll to top
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    notifyOpener({ type: 'ORDER_CREATED', order: result.order });
                    
                    if (isPopupMode) {
                        setTimeout(() => handlePopupClose(), 1200);
                    } else {
                        setTimeout(() => {
                            window.location.href = 'dashboard.html';
                        }, 2000);
                    }
                } else {
                    // Show detailed error
                    let errorMsg = result.error || 'Order creation failed';
                    if (result.details) {
                        errorMsg += '\nDetails: ' + JSON.stringify(result.details);
                    }
                    throw new Error(errorMsg);
                }
            } catch (error) {
                console.error('Order error:', error);
                showMessage(error.message || 'Failed to create order. Please try again.', 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
        });
    }
    
    // Pre-fill service from URL parameter
    // Service selection via URL handled once services load
    
    // Real-time link validation
    const linkInput = document.getElementById('link');
    if (linkInput) {
        linkInput.addEventListener('blur', function() {
            if (this.value && !validateURL(this.value)) {
                this.style.borderColor = '#ef4444';
                const hint = this.nextElementSibling;
                if (hint) {
                    hint.textContent = '❌ Please enter a valid URL';
                    hint.style.color = '#ef4444';
                }
            } else if (this.value) {
                this.style.borderColor = '#10b981';
                const hint = this.nextElementSibling;
                if (hint) {
                    hint.textContent = '✅ Valid URL';
                    hint.style.color = '#10b981';
                }
            }
        });
    }
    
    // Quantity validation
    if (quantityInput) {
        quantityInput.addEventListener('input', function() {
            const value = Number(this.value);
            const selectedOption = serviceSelect?.selectedOptions?.[0] || null;
            const min = selectedOption ? Number(selectedOption.dataset.min) : 10;
            const max = selectedOption ? (selectedOption.dataset.max === 'Infinity' ? Infinity : Number(selectedOption.dataset.max)) : 1000000;
            const hint = this.nextElementSibling;

            if (!value) {
                this.style.borderColor = '';
                if (hint) {
                    const minLabel = Number.isFinite(min) ? formatNumber(min) : '0';
                    const maxLabel = Number.isFinite(max) ? formatNumber(max) : '∞';
                    hint.textContent = `Minimum: ${minLabel} • Maximum: ${maxLabel}`;
                    hint.style.color = '#64748B';
                }
                return;
            }

            if (value < min || !Number.isFinite(value)) {
                this.style.borderColor = '#ef4444';
                if (hint) {
                    hint.textContent = `❌ Minimum quantity is ${formatNumber(min)}`;
                    hint.style.color = '#ef4444';
                }
                return;
            }

            if (Number.isFinite(max) && value > max) {
                this.style.borderColor = '#ef4444';
                if (hint) {
                    hint.textContent = `❌ Maximum quantity is ${formatNumber(max)}`;
                    hint.style.color = '#ef4444';
                }
                return;
            }

            this.style.borderColor = '#10b981';
            if (hint) {
                hint.textContent = '✅ Quantity looks good';
                hint.style.color = '#10b981';
            }
        });
    }
});

console.log('💰 Order page loaded!');

// ==========================================
// Load Services from API
// ==========================================

async function loadServices(options = {}) {
    const serviceSelect = document.getElementById('service');
    if (!serviceSelect) {
        return;
    }

    const isRetry = Boolean(options.manualRetry);

    if (servicesFetchController) {
        servicesFetchController.abort();
        servicesFetchController = null;
    }

    console.log('[ORDER] Loading services...');
    setServiceSelectPlaceholder(serviceSelect, 'Loading curated services...');

    serviceStatusController?.setState(isRetry ? 'retrying' : 'loading');

    const token = resolveAuthToken('load-services');
    if (!token) {
        setServiceSelectPlaceholder(serviceSelect, 'Sign in required to view services', true);
        serviceStatusController?.setState('error');
        return;
    }

    const fetchHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    let lastError = null;

    for (let attempt = 0; attempt <= SERVICES_FETCH_RETRIES; attempt++) {
        try {
            const { response, data } = await fetchServicesOnce(fetchHeaders);

            console.log('[ORDER] Services API response:', response.status);

            if (response.status === 401 || response.status === 403) {
                console.warn('[ORDER] Services request unauthorized. Response:', data);
                setServiceSelectPlaceholder(serviceSelect, 'Sign in required to load services', true);
                serviceStatusController?.setState('error');
                handleMissingAuth('services-response-unauthorized');
                return;
            }

            if (!response.ok) {
                const apiError = data?.error || `Failed to load services (HTTP ${response.status})`;
                throw new Error(apiError);
            }

            const services = Array.isArray(data?.services) ? data.services : [];
            const curatedServices = services
                .filter(service => {
                    const status = String(service?.status || 'active').toLowerCase();
                    const portalSlot = toNumberOrNull(service?.customer_portal_slot ?? service?.customerPortalSlot);
                    const hasPortalSlot = portalSlot !== null;
                    const providerHealthy = !service?.provider || String(service?.provider?.status || 'active').toLowerCase() === 'active';
                    // Accept services with a portal slot; ignore missing status by defaulting to active
                    return hasPortalSlot && providerHealthy;
                })
                .sort((a, b) => {
                    const slotA = toNumberOrNull(a?.customer_portal_slot ?? a?.customerPortalSlot) ?? Number.MAX_SAFE_INTEGER;
                    const slotB = toNumberOrNull(b?.customer_portal_slot ?? b?.customerPortalSlot) ?? Number.MAX_SAFE_INTEGER;
                    if (slotA !== slotB) {
                        return slotA - slotB;
                    }

                    const categoryA = String(a?.category || '').toLowerCase();
                    const categoryB = String(b?.category || '').toLowerCase();
                    if (categoryA !== categoryB) {
                        return categoryA.localeCompare(categoryB);
                    }

                    const nameA = String(a?.name || '');
                    const nameB = String(b?.name || '');
                    return nameA.localeCompare(nameB);
                })
                .map(normalizeServiceRecord);

            console.log('[ORDER] Received services:', services.length, 'Curated:', curatedServices.length);

            servicesData = curatedServices;

            if (servicesData.length === 0) {
                setServiceSelectPlaceholder(serviceSelect, 'No services available', true);
                showMessage('No admin-approved services are available yet. Please contact support.', 'info');
                serviceStatusController?.setState('empty');
                return;
            }

            renderServiceOptions(serviceSelect);
            serviceSelect.disabled = false;
            showMessage(`${servicesData.length} curated services ready`, 'success');
            serviceStatusController?.setState('success');
            applyPendingServiceSelection();
            return;
        } catch (error) {
            lastError = error;
            console.error(`[ORDER] Failed to load services (attempt ${attempt + 1}):`, error);
            if (attempt < SERVICES_FETCH_RETRIES) {
                // Silent retry - no customer notification
                await delay(400 * (attempt + 1));
                continue;
            }
        }
    }

    // Keep trying silently without notifying customer
    setServiceSelectPlaceholder(serviceSelect, 'Loading services...', true);
    console.warn('[ORDER] All service load attempts failed:', lastError);
    serviceStatusController?.setState('error');
}

async function fetchServicesOnce(headers) {
    const controller = new AbortController();
    servicesFetchController = controller;
    const timeoutId = setTimeout(() => controller.abort(), SERVICES_FETCH_TIMEOUT);

    try {
        const response = await fetch(SERVICES_ENDPOINT, {
            method: 'GET',
            headers,
            signal: controller.signal
        });

        const rawBody = await response.text();
        let data;

        try {
            data = rawBody ? JSON.parse(rawBody) : {};
        } catch (parseError) {
            console.error('[ORDER] Failed to parse services payload:', parseError, rawBody);
            throw new Error('Received an invalid response from services API');
        }

        return { response, data };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Services request timed out');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
        if (servicesFetchController === controller) {
            servicesFetchController = null;
        }
    }
}

function renderServiceOptions(serviceSelect) {
    if (!serviceSelect) {
        return;
    }

    if (!servicesData.length) {
        setServiceSelectPlaceholder(serviceSelect, 'No services available', true);
        return;
    }

    const grouped = groupServicesByCategory(servicesData);
    const sortedCategories = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

    let html = '<option value="">Select a service</option>';

    sortedCategories.forEach(categoryName => {
        html += `<optgroup label="${escapeHtml(categoryName)}">`;
        grouped[categoryName].forEach(service => {
            const rate = Number(service.rate || 0).toFixed(2);
            const min = service.min_quantity;
            const max = service.max_quantity;
            const datasetMax = max === Infinity ? 'Infinity' : max;
            const hasPublicId = Number.isFinite(service.publicId);
            const labelId = hasPublicId ? `#${service.publicId}` : 'ID Pending';
            html += `<option value="${escapeHtml(String(service.id))}" data-rate="${rate}" data-min="${min}" data-max="${datasetMax}" data-public-id="${hasPublicId ? service.publicId : ''}">
                    ${labelId} · ${escapeHtml(service.name || 'Untitled Service')} - $${rate}/1k (Min: ${formatNumber(min)}, Max: ${formatNumber(max)})
                </option>`;
        });
        html += '</optgroup>';
    });

    serviceSelect.innerHTML = html;
}

(function registerOrderFetchGuardHooks() {
    if (typeof window === 'undefined') {
        return;
    }

    function isServiceEndpoint(endpoint) {
        return typeof endpoint === 'string' && endpoint.includes('/.netlify/functions/services');
    }

    window.addEventListener('fetchguard:network-status', (event) => {
        const isOnline = event?.detail?.online !== false;
        networkStatusController?.setStatus?.(isOnline);
    });

    window.addEventListener('fetchguard:retry', (event) => {
        if (!isServiceEndpoint(event?.detail?.endpoint)) {
            return;
        }
        serviceStatusController?.setState('retrying');
    });

    window.addEventListener('fetchguard:circuit-open', (event) => {
        if (!isServiceEndpoint(event?.detail?.endpoint)) {
            return;
        }
        serviceStatusController?.setState('error');
    });

    window.addEventListener('fetchguard:failure', (event) => {
        if (!isServiceEndpoint(event?.detail?.endpoint)) {
            return;
        }
        serviceStatusController?.setState('error');
    });
})();

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (!isFinite(num)) {
        return '∞';
    }

    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(0) + 'K';
    }
    return num.toString();
}

function enablePopupSurface() {
    document.body.classList.add('popup-mode');
    const panel = document.querySelector('[data-popup-surface]');
    if (panel) {
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Order creation window');
        panel.setAttribute('tabindex', '-1');
        requestAnimationFrame(() => panel.focus());
    }

    const closeButton = document.querySelector('[data-popup-close]');
    if (closeButton) {
        closeButton.addEventListener('click', handlePopupClose);
    }

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            handlePopupClose();
        }
    });
}

function handlePopupClose() {
    if (window.opener && !window.opener.closed) {
        window.opener.focus();
        window.close();
        return;
    }

    document.body.classList.remove('popup-mode');
    const panel = document.querySelector('[data-popup-surface]');
    if (panel) {
        panel.removeAttribute('role');
        panel.removeAttribute('aria-modal');
        panel.removeAttribute('tabindex');
    }
    const closeButton = document.querySelector('[data-popup-close]');
    if (closeButton) {
        closeButton.style.display = 'none';
    }
}

function resolveAuthToken(reason) {
    const token = getAuthToken();
    if (!token) {
        handleMissingAuth(reason);
    }
    return token;
}

function getAuthToken() {
    try {
        return localStorage.getItem('token');
    } catch (error) {
        console.warn('[ORDER] Unable to read auth token from storage.', error);
        return null;
    }
}

function handleMissingAuth(reason) {
    if (authGuardTriggered) {
        return;
    }
    authGuardTriggered = true;

    const payload = { type: 'AUTH_REQUIRED', source: 'order', reason };
    if (isPopupMode) {
        notifyOpener(payload);
        setTimeout(() => {
            try {
                window.close();
            } catch (error) {
                console.warn('[ORDER] Failed to close popup after auth guard.', error);
            }
        }, 200);
        return;
    }

    alert(AUTH_ALERT_MESSAGE);
    const redirectTarget = buildRedirectTarget();
    window.location.href = `signin.html?redirect=${encodeURIComponent(redirectTarget)}`;
}

function buildRedirectTarget() {
    const path = window.location.pathname.replace(/^\/+/, '');
    const search = window.location.search || '';
    return search ? `${path}${search}` : path;
}

function notifyOpener(payload) {
    if (!isPopupMode || !window.opener || window.opener.closed) {
        return;
    }
    window.opener.postMessage(payload, window.location.origin);
}
