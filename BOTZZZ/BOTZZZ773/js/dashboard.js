// Dashboard Functionality - Authentication Required
(function() {
    'use strict';

    let isPopupMode = false;
    let authGuardTriggered = false;

    // Helper: Convert various value types to boolean
    function toBooleanFlag(value) {
        if (value === undefined || value === null) return false;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value > 0;
        const normalized = String(value).trim().toLowerCase();
        if (!normalized) return false;
        return ['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(normalized);
    }

    const AUTH_ALERT_MESSAGE = 'You must be signed in to access the dashboard. Please sign in or create an account.';

    function enablePopupSurface() {
        document.body.classList.add('popup-mode');
        const panel = document.querySelector('[data-popup-surface]');
        if (panel) {
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-label', 'Dashboard window');
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

    function notifyOpener(payload) {
        if (!isPopupMode || !window.opener || window.opener.closed) {
            return;
        }
        try {
            window.opener.postMessage(payload, window.location.origin);
        } catch (error) {
            console.warn('[DASHBOARD] Failed to notify opener.', error);
        }
    }

    // ==========================================
    // USER DISCOUNT RATE
    // ==========================================
    let userDiscountRate = 0; // Percentage discount (0-100)
    let userServiceDiscounts = {}; // Per-service discounts for this user { serviceId: rate }
    const PER_SERVICE_DISCOUNTS = { 9071: 10 }; // Global per-service overrides if any

    // ==========================================
    // AUTHENTICATION CHECK
    // ==========================================
    function checkAuth(reason = 'dashboard-init') {
        const token = resolveAuthToken(reason);
        const userProfile = resolveUserProfile(reason);
        if (!token || !userProfile) {
            return null;
        }
        return { token, user: userProfile };
    }

    // ==========================================
    // INITIALIZE DASHBOARD
    // ==========================================
    const urlParams = new URLSearchParams(window.location.search);
    isPopupMode = urlParams.get('popup') === '1';
    if (isPopupMode) {
        enablePopupSurface();
    }

    const auth = checkAuth('initial-load');
    if (!auth) return;

    const { token, user } = auth;
    
    // Initialize discount rate from stored user data if available
    if (user.discount_rate !== undefined) {
        userDiscountRate = parseFloat(user.discount_rate) || 0;
    }

    // Format balance with up to 5 decimals, trimming trailing zeros
    function formatBalanceDisplay(amount) {
        const num = Number(amount);
        if (!Number.isFinite(num)) return '$0';
        const fixed = num.toFixed(5); // cap at 5 decimals
        const trimmed = fixed
            .replace(/(\.\d*?[1-9])0+$/, '$1') // drop trailing zeros after non-zero
            .replace(/\.0+$/, ''); // drop .0 if no decimals remain
        return `$${trimmed}`;
    }

    // Expose for inline scripts (balance realtime listener)
    window.BOTZZZ_formatBalanceDisplay = formatBalanceDisplay;

    // Update UI with user data
    function updateUserDisplay() {
        const userNameEl = document.getElementById('userName');
        const balanceAmountEl = document.getElementById('balanceAmount');

        if (userNameEl && user.username) {
            userNameEl.textContent = user.username;
        }

        if (balanceAmountEl && user.balance !== undefined) {
            balanceAmountEl.textContent = formatBalanceDisplay(user.balance);
        }
    }

    async function refreshUserSnapshot(context = {}) {
        try {
            const response = await fetch('/.netlify/functions/users', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                return null;
            }

            const data = await response.json();
            if (data?.user) {
                Object.assign(user, data.user);
                localStorage.setItem('user', JSON.stringify(user));
                updateUserDisplay();
                
                // Update discount rate and service-specific discounts
                if (data.user.discount_rate !== undefined) {
                    userDiscountRate = parseFloat(data.user.discount_rate) || 0;
                    updateDiscountBadge();
                }
                if (data.user.service_discounts && typeof data.user.service_discounts === 'object') {
                    userServiceDiscounts = data.user.service_discounts;
                }
                
                if (window.BalanceSync) {
                    window.BalanceSync.setUser(user, { reason: context.reason || 'dashboard-refresh' });
                }
                return user;
            }
        } catch (error) {
            console.warn('[DASHBOARD] Failed to refresh user snapshot:', error);
        }
        return null;
    }
    
    function updateDiscountBadge() {
        const discountBadge = document.getElementById('discountBadge');
        if (discountBadge) {
            if (userDiscountRate > 0) {
                discountBadge.textContent = `-${userDiscountRate}% discount`;
                discountBadge.style.display = 'inline-block';
            } else {
                discountBadge.style.display = 'none';
            }
        }
    }

    function escapeHtml(text) {
        if (text === undefined || text === null) {
            return '';
        }
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    // Numeric helper used by orders rendering
    function toNumeric(value) {
        if (value === undefined || value === null) return null;
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }

    function resolveOrderDisplayLabel(order = {}) {
        if (order.order_number !== undefined && order.order_number !== null && String(order.order_number).trim().length > 0) {
            return String(order.order_number).trim();
        }
        if (order.id) {
            const compactId = String(order.id).replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
            return compactId;
        }
        return '—';
    }

    function formatRelativeTimestamp(dateInput) {
        if (!dateInput) {
            return 'just now';
        }
        const date = typeof dateInput === 'number' ? new Date(dateInput) : new Date(dateInput);
        if (Number.isNaN(date.getTime())) {
            return 'just now';
        }
        const diff = Date.now() - date.getTime();
        if (diff < 15000) return 'just now';
        if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
        if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
        return `${Math.floor(diff / 3600000)}h ago`;
    }

    // ==========================================
    // MOBILE MENU TOGGLE
    // ==========================================
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.querySelector('.dashboard-sidebar');

    if (mobileMenuToggle && sidebar) {
        mobileMenuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('show');
        });

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 1024) {
                if (!sidebar.contains(e.target) && !mobileMenuToggle.contains(e.target)) {
                    sidebar.classList.remove('show');
                }
            }
        });
    }

    // ==========================================
    // USER MENU DROPDOWN
    // ==========================================
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userDropdown = document.getElementById('userDropdown');

    if (userMenuBtn && userDropdown) {
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('show');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            userDropdown.classList.remove('show');
        });
    }

    // ==========================================
    // LOGOUT FUNCTIONALITY
    // ==========================================
    function handleLogout() {
        stopOrdersAutoRefresh();
        // Clear all auth data
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.clear();

        // Show notification
        showToast('Logged out successfully', 'success');

        if (isPopupMode) {
            setTimeout(() => {
                notifyOpener({ type: 'USER_LOGGED_OUT' });
                handlePopupClose();
            }, 800);
            return;
        }

        // Redirect to home page
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1000);
    }

    const logoutBtn = document.getElementById('logoutBtn');
    const logoutLink = document.getElementById('logoutLink');

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    if (logoutLink) {
        logoutLink.addEventListener('click', (e) => {
            e.preventDefault();
            handleLogout();
        });
    }

    // ==========================================
    // TOAST NOTIFICATION
    // ==========================================
    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        if (!toast) return;

        const messageEl = toast.querySelector('.toast-message');
        const closeBtn = toast.querySelector('.toast-close');

        // Remove existing classes
        toast.classList.remove('success', 'error', 'show');

        // Set message and type
        if (messageEl) messageEl.textContent = message;
        toast.classList.add(type);

        // Show toast
        setTimeout(() => toast.classList.add('show'), 10);

        // Auto hide after 5 seconds
        const hideTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 5000);

        // Close button
        if (closeBtn) {
            closeBtn.onclick = () => {
                clearTimeout(hideTimeout);
                toast.classList.remove('show');
            };
        }
    }

    // ==========================================
    // SERVICES DATA - LOADED FROM DATABASE
    // ==========================================
    let servicesData = {};
    let categoryLabels = {};

    const CATEGORY_ICON_MAP = {
        instagram: '📷',
        tiktok: '🎵',
        youtube: '▶️',
        twitter: '🐦',
        x: '🐦',
        facebook: '👍',
        telegram: '✈️',
        spotify: '🎧',
        soundcloud: '🎶',
        snapchat: '👻',
        threads: '🧵',
        linkedin: '💼',
        pinterest: '📌',
        twitch: '🎮',
        other: '⭐'
    };

    const CURRENCY_SYMBOLS = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        INR: '₹',
        TRY: '₺',
        BRL: 'R$',
        NGN: '₦',
        CAD: 'C$',
        AUD: 'A$',
        SGD: 'S$',
        AED: 'د.إ',
        SAR: '﷼',
        PHP: '₱'
    };

    function formatCurrencyDisplay(amount, currency = 'USD', digits = null) {
        const numeric = Number(amount);
        const normalizedCurrency = currency ? String(currency).toUpperCase().slice(0, 10) : 'USD';
        if (!Number.isFinite(numeric)) {
            return `-- ${normalizedCurrency}`;
        }

        // Dynamic decimal precision for sub-cent amounts
        let finalDigits = digits;
        if (finalDigits === null) {
            if (numeric < 0.01) {
                finalDigits = 6; // Show more decimals for tiny amounts like 0.0007
            } else if (numeric < 1) {
                finalDigits = 4; // Show 4 decimals for sub-dollar amounts
            } else {
                finalDigits = 2; // Standard 2 decimals for dollar amounts
            }
        }

        const symbol = CURRENCY_SYMBOLS[normalizedCurrency] || `${normalizedCurrency} `;
        const ambiguousSymbols = new Set(['C$', 'A$', 'S$']);
        const formatted = `${symbol}${numeric.toFixed(finalDigits)}`;
        return (!CURRENCY_SYMBOLS[normalizedCurrency] || ambiguousSymbols.has(symbol))
            ? `${formatted} ${normalizedCurrency}`
            : formatted;
    }

    function formatProviderOrderId(value) {
        if (value === undefined || value === null) return null;
        const normalized = String(value).trim();
        if (!normalized) return null;
        return normalized.startsWith('#') ? normalized : `#${normalized}`;
    }

    function resolveProviderOrderId(order = {}) {
        const raw = order.provider_order_id
            ?? order.provider_order
            ?? order.providerOrderId
            ?? order.provider?.order_id
            ?? order.meta?.provider_order_id
            ?? order.details?.provider_order_id
            ?? order.external_id
            ?? null;
        return formatProviderOrderId(raw);
    }

    function buildStatusKey(status) {
        return String(status || 'unknown')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            || 'unknown';
    }

    function formatOrderStatusLabel(status) {
        if (!status) return 'Unknown';
        return String(status)
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    const CAPABILITY_BADGES = [
        { key: 'refill', label: 'Refill' },
        { key: 'cancel', label: 'Cancel' },
        { key: 'dripfeed', label: 'Dripfeed' },
        { key: 'subscription', label: 'Subscription' }
    ];

    // Statuses that indicate order is being processed by provider
    const CUSTOMER_PROCESSING_STATUS_KEYS = new Set([
        'processing'
    ]);

    // Statuses that indicate order is actively in progress
    const CUSTOMER_INPROGRESS_STATUS_KEYS = new Set([
        'in-progress',
        'inprogress',
        'partial',
        'partialcompleted',
        'partiallycompleted'
    ]);

    // Statuses that indicate order is waiting to be processed
    const CUSTOMER_PENDING_STATUS_KEYS = new Set([
        'pending',
        'awaiting',
        'awaiting-start',
        'awaitingstart',
        'queued',
        'queue',
        'submitted',
        'verifying',
        'hold',
        'holding',
        'new',
        'received',
        'accepted',
        'created'
    ]);

    const CUSTOMER_SUCCESS_STATUS_KEYS = new Set([
        'success',
        'successful',
        'completed',
        'complete',
        'delivered',
        'done',
        'finished'
    ]);

    const CUSTOMER_FAILED_STATUS_KEYS = new Set([
        'failed',
        'error',
        'fail',
        'failure'
    ]);

    const CUSTOMER_CANCELLED_KEYS = new Set(['canceled', 'cancelled']);

    function coerceCustomerFacingStatusDescriptor(rawStatus, fallbackLabel = null) {
        const safeRaw = typeof rawStatus === 'string' && rawStatus.trim().length > 0
            ? rawStatus.trim()
            : 'pending';
        const normalizedKey = buildStatusKey(safeRaw);

        // Check if order is being processed
        if (CUSTOMER_PROCESSING_STATUS_KEYS.has(normalizedKey)) {
            return {
                key: 'processing',
                label: 'Processing',
                raw: safeRaw
            };
        }

        // Check if order is actively in progress
        if (CUSTOMER_INPROGRESS_STATUS_KEYS.has(normalizedKey)) {
            return {
                key: 'in-progress',
                label: 'In Progress',
                raw: safeRaw
            };
        }

        // Check if order is waiting to start
        if (CUSTOMER_PENDING_STATUS_KEYS.has(normalizedKey)) {
            return {
                key: 'pending',
                label: 'Pending',
                raw: safeRaw
            };
        }

        if (CUSTOMER_SUCCESS_STATUS_KEYS.has(normalizedKey)) {
            return {
                key: 'success',
                label: 'Completed',
                raw: safeRaw
            };
        }

        // IMPORTANT: Hide "Failed" status from customers - show as "Pending" instead
        // System will retry failed orders or route to another provider
        if (CUSTOMER_FAILED_STATUS_KEYS.has(normalizedKey)) {
            return {
                key: 'pending',
                label: 'Pending',
                raw: safeRaw
            };
        }

        if (CUSTOMER_CANCELLED_KEYS.has(normalizedKey)) {
            return {
                key: 'canceled',
                label: fallbackLabel || 'Canceled',
                raw: safeRaw
            };
        }

        if (normalizedKey === 'refunded' || normalizedKey === 'reversed') {
            return {
                key: normalizedKey,
                label: fallbackLabel || formatOrderStatusLabel(safeRaw),
                raw: safeRaw
            };
        }

        return {
            key: normalizedKey,
            label: fallbackLabel || formatOrderStatusLabel(safeRaw),
            raw: safeRaw
        };
    }

    function renderCapabilityPills(capabilities = {}) {
        return CAPABILITY_BADGES
            .map(({ key, label }) => {
                const enabled = Boolean(capabilities[key]);
                const stateClass = enabled ? 'service-capability--on' : 'service-capability--off';
                return `<span class="service-meta-tag service-capability ${stateClass}">${label}</span>`;
            })
            .join('');
    }

    function slugifyCategory(rawValue) {
        return rawValue
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            || 'other';
    }

    function formatCategoryLabel(rawValue) {
        return rawValue
            .toString()
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    function getCategoryIcon(slug) {
        const baseSlug = slug.split('-')[0];
        return CATEGORY_ICON_MAP[baseSlug] || CATEGORY_ICON_MAP.other;
    }

    function populateCategoryOptions() {
        if (!categorySelect) {
            return;
        }

        const previousValue = categorySelect.value;
        categorySelect.innerHTML = '<option value="" disabled selected>Select a category</option>';
        if (serviceSelect) {
            serviceSelect.innerHTML = '<option value="" disabled selected>Select a service</option>';
        }

        const sortedCategories = Object.entries(categoryLabels)
            .sort(([, labelA], [, labelB]) => labelA.localeCompare(labelB));

        sortedCategories.forEach(([slug, label]) => {
            const option = document.createElement('option');
            option.value = slug;
            option.textContent = `${getCategoryIcon(slug)} ${label}`;
            categorySelect.appendChild(option);
        });

        if (previousValue && servicesData[previousValue]) {
            categorySelect.value = previousValue;
        }
    }

    // Load services from database
    async function loadServicesFromDatabase() {
        try {
            let response = await fetch('/.netlify/functions/services?audience=customer', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            let rawBody = await response.text();
            let data;
            try {
                data = rawBody ? JSON.parse(rawBody) : {};
            } catch (parseError) {
                console.error('[DASHBOARD] Failed to parse services response:', parseError, rawBody);
                throw new Error('Received invalid response while loading services');
            }

            // Fallback to public /v2 if unauthorized or function not OK
            if (!response.ok || response.status === 401 || response.status === 403) {
                console.warn('[DASHBOARD] Function services request failed or unauthorized. Falling back to /v2?action=services');
                response = await fetch('/v2?action=services', { method: 'GET', headers: { 'Content-Type': 'application/json' } });
                rawBody = await response.text();
                try {
                    data = rawBody ? JSON.parse(rawBody) : {};
                } catch (parseError) {
                    console.error('[DASHBOARD] Failed to parse v2 services response:', parseError, rawBody);
                    throw new Error('Received invalid response while loading services (v2)');
                }
            }
            
            if (Array.isArray(data.services)) {
                const services = data.services;
                
                // Filter for customer portal enabled services (has a slot assigned)
                const customerServices = services.filter(service => {
                    const hasSlot = service?.customer_portal_slot !== null && 
                                  service?.customer_portal_slot !== undefined;
                    return hasSlot;
                });
                
                // Store all services in global cache for order display
                window.servicesCache = services;

                if (customerServices.length > 0) {
                    // Categorize services
                    servicesData = {};
                    categoryLabels = {};
                    customerServices.forEach(service => {
                        const rawCategory = service.category || 'Other';
                        const categorySlug = slugifyCategory(rawCategory);
                        const categoryLabel = formatCategoryLabel(rawCategory);

                        categoryLabels[categorySlug] = categoryLabel;

                        if (!servicesData[categorySlug]) {
                            servicesData[categorySlug] = [];
                        }
                        const rawPublicId = service.public_id ?? service.publicId;
                        const providerOrderReferenceRaw = service.provider_order_id ?? service.provider_service_id ?? service.provider_service_reference ?? '';
                        const providerServiceReferenceRaw = service.provider_service_id ?? service.provider_service_reference ?? providerOrderReferenceRaw;
                        const providerOrderReference = providerOrderReferenceRaw === null || providerOrderReferenceRaw === undefined
                            ? ''
                            : String(providerOrderReferenceRaw).trim();
                        const providerServiceReference = providerServiceReferenceRaw === null || providerServiceReferenceRaw === undefined
                            ? ''
                            : String(providerServiceReferenceRaw).trim();
                        const publicId = (rawPublicId === null || rawPublicId === undefined || rawPublicId === '')
                            ? null
                            : Number(rawPublicId);
                        const minQuantity = Number(service.min_quantity ?? service.min_order ?? 100) || 100;
                        const maxQuantity = Number(service.max_quantity ?? service.max_order ?? 10000) || 10000;
                        const currencyCode = (service.currency || 'USD').toUpperCase();
                        const avgTimeValue = service.average_time || service.avg_time || 'Not specified';
                        servicesData[categorySlug].push({
                            id: service.id.toString(),
                            publicId: Number.isFinite(publicId) ? publicId : null,
                            provider_order_id: providerOrderReference,
                            provider_service_id: providerServiceReference,
                            name: service.name,
                            price: parseFloat(service.rate ?? service.price ?? 0),
                            min: minQuantity,
                            max: maxQuantity,
                            avgTime: avgTimeValue,
                            currency: currencyCode,
                            capabilities: {
                                refill: Boolean(service.refill_supported ?? service.refill),
                                cancel: Boolean(service.cancel_supported ?? service.cancel),
                                dripfeed: Boolean(service.dripfeed_supported ?? service.dripfeed),
                                subscription: Boolean(service.subscription_supported ?? service.subscription)
                            },
                            description: service.description || '',
                            categoryLabel,
                            categorySlug
                        });
                    });
                    
                    populateCategoryOptions();
                    return true;
                } else {
                    showToast('No services are currently available. Please contact support.', 'error');
                    populateCategoryOptions();
                    return false;
                }
            } else {
                console.error('Failed to load services:', data.error || 'No services array in response');
                showToast('Failed to load services. Please refresh the page.', 'error');
                populateCategoryOptions();
                return false;
            }
        } catch (error) {
            console.error('Error loading services:', error);
            showToast('Failed to load services. Please refresh the page.', 'error');
            populateCategoryOptions();
            return false;
        }
    }

    // ==========================================
    // ORDER FORM FUNCTIONALITY
    // ==========================================
    const categorySelect = document.getElementById('category');
    const serviceSelect = document.getElementById('service');
    const serviceInfo = document.getElementById('serviceInfo');
    const quantityInput = document.getElementById('quantity');
    const chargeAmount = document.getElementById('chargeAmount');
    const averageTimeEl = document.getElementById('averageTime');
    const orderForm = document.getElementById('orderForm');
    const searchInput = document.getElementById('searchServices');

    let selectedService = null;
    let lastSearchResults = []; // Track search results for category filtering

    function normalizeQuantityValue(rawValue) {
        const raw = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
        if (!raw) {
            return null;
        }
        if (!/^[0-9]+$/.test(raw)) {
            return null;
        }
        return Number(raw);
    }

    function coerceQuantityInput({ clampToLimits = false } = {}) {
        if (!quantityInput) {
            return null;
        }
        const normalized = normalizeQuantityValue(quantityInput.value);
        if (normalized === null) {
            return null;
        }
        let finalValue = normalized;
        if (clampToLimits && selectedService) {
            const maxLimit = Number.isFinite(selectedService.max) ? selectedService.max : Infinity;
            finalValue = Math.min(Math.max(finalValue, selectedService.min), maxLimit);
        }
        if (String(quantityInput.value) !== String(finalValue)) {
            quantityInput.value = finalValue;
        }
        return finalValue;
    }

    // Helper function to render service option
    function createServiceOption(service) {
        const option = document.createElement('option');
        const hasPublicId = Number.isFinite(service.publicId);
        const labelId = hasPublicId ? `#${service.publicId}` : 'ID Pending';
        option.value = service.id;
        
        // Compute effective discount
        const basePriceNum = Number(service.price || 0);
        let effectiveDiscount = 0;
        const publicId = hasPublicId ? Number(service.publicId) : null;
        if (publicId && userServiceDiscounts[publicId] !== undefined && userServiceDiscounts[publicId] !== null) {
            const val = Number(userServiceDiscounts[publicId]);
            if (Number.isFinite(val) && val >= 0 && val <= 100) effectiveDiscount = val;
        } else if (publicId && Object.prototype.hasOwnProperty.call(PER_SERVICE_DISCOUNTS, publicId)) {
            const val = Number(PER_SERVICE_DISCOUNTS[publicId]);
            if (Number.isFinite(val) && val >= 0 && val <= 100) effectiveDiscount = val;
        } else if (userDiscountRate > 0 && userDiscountRate <= 100) {
            effectiveDiscount = userDiscountRate;
        }
        
        const finalPriceNum = effectiveDiscount > 0 ? (basePriceNum - (basePriceNum * (effectiveDiscount / 100))) : basePriceNum;
        const finalPrice = finalPriceNum.toFixed(4);
        const basePrice = basePriceNum.toFixed(4);
        
        // Include category info if available
        let optionText = `[${labelId}] ${service.name} — $${finalPrice}/1K${effectiveDiscount > 0 ? ` (was $${basePrice})` : ''}`;
        if (service.categoryLabel) {
            const categoryDisplay = `${getCategoryIcon(service.categorySlug)} ${service.categoryLabel}`;
            optionText = `[${labelId}] [${categoryDisplay}] ${service.name} — $${finalPrice}/1K${effectiveDiscount > 0 ? ` (was $${basePrice})` : ''}`;
        }
        option.textContent = optionText;
        
        option.dataset.price = finalPriceNum;
        option.dataset.basePrice = basePriceNum;
        option.dataset.discount = effectiveDiscount;
        option.dataset.min = service.min;
        option.dataset.max = service.max === Infinity ? 'Infinity' : service.max;
        option.dataset.avgTime = service.avgTime;
        option.dataset.description = service.description;
        option.dataset.serviceName = service.name;
        option.dataset.currency = service.currency;
        option.dataset.capabilities = JSON.stringify(service.capabilities || {});
        
        const providerRef = service.provider_order_id || service.provider_service_id;
        if (providerRef) {
            option.dataset.providerId = providerRef;
        }
        if (hasPublicId) {
            option.dataset.publicId = service.publicId;
        }
        
        return option;
    }

    // Populate services based on category
    if (categorySelect && serviceSelect) {
        categorySelect.addEventListener('change', (e) => {
            const category = e.target.value;
            
            // If there's an active search, ignore category selection and show all search results
            if (searchInput && searchInput.value.trim().length >= 2) {
                // Show all search results regardless of category selection
                serviceSelect.innerHTML = '';
                if (lastSearchResults.length > 0) {
                    lastSearchResults.forEach(service => {
                        serviceSelect.appendChild(createServiceOption(service));
                    });
                } else {
                    serviceSelect.innerHTML = '<option value="" disabled selected>No services found</option>';
                }
            } else {
                // No active search - populate with category services
                serviceSelect.innerHTML = '<option value="" disabled selected>Select a service</option>';
                
                if (category && servicesData[category]) {
                    servicesData[category].forEach(service => {
                        serviceSelect.appendChild(createServiceOption(service));
                    });
                }
            }
            
            resetOrderCalculation();
        });

        // Update service info and limits
        serviceSelect.addEventListener('change', (e) => {
            const option = e.target.options[e.target.selectedIndex];
            
            if (option.value) {
                const minValue = Number(option.dataset.min);
                const maxValue = option.dataset.max === 'Infinity'
                    ? Infinity
                    : Number(option.dataset.max);
                selectedService = {
                    id: option.value,
                    name: option.dataset.serviceName || option.textContent,
                    displayLabel: option.textContent,
                    price: parseFloat(option.dataset.price),
                    min: Number.isFinite(minValue) ? minValue : 0,
                    max: Number.isFinite(maxValue) ? maxValue : Infinity,
                    avgTime: option.dataset.avgTime,
                    publicId: option.dataset.publicId ? Number(option.dataset.publicId) : null,
                    providerReference: option.dataset.providerId || '',
                    currency: option.dataset.currency ? option.dataset.currency.toUpperCase() : 'USD',
                    capabilities: option.dataset.capabilities ? JSON.parse(option.dataset.capabilities) : {}
                };

                // Update quantity limits
                if (quantityInput) {
                    quantityInput.min = selectedService.min;
                    quantityInput.max = Number.isFinite(selectedService.max) ? selectedService.max : '';
                    const maxLabel = Number.isFinite(selectedService.max) ? selectedService.max : 'Unlimited';
                    quantityInput.placeholder = `Min: ${selectedService.min} - Max: ${maxLabel}`;
                    
                    // Update quantity info display
                    const quantityInfo = quantityInput.parentElement.querySelector('.quantity-info');
                    if (quantityInfo) {
                        quantityInfo.innerHTML = `
                            <span>Min: <strong>${selectedService.min}</strong></span>
                            <span>Max: <strong>${Number.isFinite(selectedService.max) ? selectedService.max.toLocaleString() : 'Unlimited'}</strong></span>
                        `;
                    }
                }

                // Update average time
                if (averageTimeEl) {
                    averageTimeEl.textContent = selectedService.avgTime;
                }

                // Show service info
                if (serviceInfo) {
                    const serviceLabel = Number.isFinite(selectedService.publicId)
                        ? `#${selectedService.publicId}`
                        : 'ID Pending';
                    const priceDisplay = formatCurrencyDisplay(selectedService.price, selectedService.currency, 4);
                    const discountInfo = Number(option.dataset.discount || 0);
                    const basePrice = Number(option.dataset.basePrice || selectedService.price);
                    const baseDisplay = formatCurrencyDisplay(basePrice, selectedService.currency, 4);
                    const capabilityMarkup = renderCapabilityPills(selectedService.capabilities || {});
                    serviceInfo.innerHTML = `
                        <div class="service-meta-row service-meta-row--wrap">
                            <span><strong>Service ID:</strong> ${serviceLabel}</span>
                            <span><strong>Price:</strong> ${priceDisplay} / 1000${discountInfo > 0 ? ` (was ${baseDisplay})` : ''}</span>
                            <span><strong>Range:</strong> ${selectedService.min} - ${Number.isFinite(selectedService.max) ? selectedService.max.toLocaleString() : 'Unlimited'}</span>
                        </div>
                        <div class="service-meta-row service-meta-row--compact">${capabilityMarkup}</div>
                    `;
                    serviceInfo.classList.add('show');
                }

                calculateCharge();
            } else {
                resetOrderCalculation();
            }
        });
    }

    // Calculate charge based on quantity
    if (quantityInput) {
        quantityInput.addEventListener('input', calculateCharge);
        quantityInput.addEventListener('blur', () => {
            coerceQuantityInput({ clampToLimits: true });
            calculateCharge();
        });
        quantityInput.addEventListener('input', () => {
            if (quantityInput.validity.customError) {
                quantityInput.setCustomValidity('');
            }
        });
        quantityInput.addEventListener('invalid', () => {
            const raw = String(quantityInput.value || '').trim();
            if (!raw) {
                quantityInput.setCustomValidity('Please enter a quantity.');
                return;
            }
            const numeric = Number(raw.replace(',', '.'));
            if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
                const lower = Math.floor(numeric);
                const upper = Math.ceil(numeric);
                if (Number.isFinite(lower) && Number.isFinite(upper)) {
                    quantityInput.setCustomValidity(`Please enter a whole number. The nearest valid values are ${lower} and ${upper}.`);
                } else {
                    quantityInput.setCustomValidity('Please enter a whole number.');
                }
                return;
            }
            quantityInput.setCustomValidity('');
        });
    }

    function calculateCharge() {
        if (!selectedService || !quantityInput) return;
        
        const quantity = normalizeQuantityValue(quantityInput.value) || 0;
        
        if (quantity >= selectedService.min && quantity <= selectedService.max) {
            // Price is already discounted in selectedService.price
            let charge = (quantity / 1000) * selectedService.price;
            
            if (chargeAmount) {
                chargeAmount.textContent = formatCurrencyDisplay(charge, selectedService.currency);
            }
        } else if (chargeAmount) {
            chargeAmount.textContent = formatCurrencyDisplay(0, selectedService.currency);
        }
    }

    function resetOrderCalculation() {
        selectedService = null;
        if (chargeAmount) chargeAmount.textContent = formatCurrencyDisplay(0);
        if (averageTimeEl) averageTimeEl.textContent = '34 minutes';
        if (serviceInfo) {
            serviceInfo.classList.remove('show');
            serviceInfo.innerHTML = '';
        }
        if (quantityInput) {
            quantityInput.min = 100;
            quantityInput.max = 30000;
            quantityInput.placeholder = 'Min: 100 - Max: 30,000';
        }
    }

    // ==========================================
    // SEARCH FUNCTIONALITY
    // ==========================================
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            
            if (searchTerm.length < 2) {
                // Reset search results
                lastSearchResults = [];
                serviceSelect.innerHTML = '<option value="" disabled selected>Select a service</option>';
                if (categorySelect) {
                    categorySelect.value = '';
                }
                populateCategoryOptions();
                resetOrderCalculation();
                return;
            }

            // Search across all services
            let results = [];
            Object.entries(servicesData).forEach(([category, services]) => {
                services.forEach(service => {
                    if (service.name.toLowerCase().includes(searchTerm) || 
                        service.id.includes(searchTerm) ||
                        (service.publicId && service.publicId.toString().includes(searchTerm)) ||
                        (service.provider_order_id && service.provider_order_id.toString().includes(searchTerm)) ||
                        (service.provider_service_id && service.provider_service_id.toString().includes(searchTerm))) {
                        results.push({ ...service, category });
                    }
                });
            });

            // If no results from curated list, try full provider list (fallback)
            if (results.length === 0 && Array.isArray(window.servicesCache)) {
                const all = window.servicesCache;
                all.forEach(svc => {
                    const name = String(svc.name || '').toLowerCase();
                    const rawId = String(svc.id || svc.service || svc.public_id || '').toLowerCase();
                    const publicIdVal = svc.public_id ?? svc.publicId;
                    const matches = name.includes(searchTerm) || rawId.includes(searchTerm) || (publicIdVal && String(publicIdVal).includes(searchTerm));
                    if (matches) {
                        const rawCategory = svc.category || 'Other';
                        const categorySlug = slugifyCategory(rawCategory);
                        const categoryLabel = formatCategoryLabel(rawCategory);
                        const publicId = (publicIdVal === null || publicIdVal === undefined || publicIdVal === '') ? null : Number(publicIdVal);
                        const minQuantity = Number(svc.min_quantity ?? svc.min_order ?? 100) || 100;
                        const maxQuantity = Number(svc.max_quantity ?? svc.max_order ?? 10000) || 10000;
                        const currencyCode = (svc.currency || 'USD').toUpperCase();
                        const avgTimeValue = svc.average_time || svc.avg_time || 'Not specified';
                        results.push({
                            id: String(svc.id ?? svc.service ?? publicId),
                            publicId: Number.isFinite(publicId) ? publicId : null,
                            name: svc.name || 'Untitled Service',
                            price: parseFloat(svc.rate ?? svc.price ?? 0),
                            min: minQuantity,
                            max: maxQuantity,
                            avgTime: avgTimeValue,
                            currency: currencyCode,
                            capabilities: {
                                refill: Boolean(svc.refill_supported ?? svc.refill),
                                cancel: Boolean(svc.cancel_supported ?? svc.cancel),
                                dripfeed: Boolean(svc.dripfeed_supported ?? svc.dripfeed),
                                subscription: Boolean(svc.subscription_supported ?? svc.subscription)
                            },
                            description: svc.description || '',
                            categoryLabel,
                            categorySlug
                        });
                    }
                });
            }

            // Store search results for category filtering
            lastSearchResults = results;

            // Prefer exact public_id match when search is numeric
            let exactMatch = null;
            const numericCandidate = searchTerm.replace(/[^0-9.]/g, '');
            const numericSearch = numericCandidate ? Number(numericCandidate) : NaN;
            if (Number.isFinite(numericSearch)) {
                exactMatch = results.find(service => service.publicId === numericSearch)
                    || results.find(service => String(service.id) === String(numericSearch));
            }

            const displayResults = results;

            // Populate service select with filtered results
            serviceSelect.innerHTML = '';
            if (displayResults.length > 0) {
                displayResults.forEach(service => {
                    serviceSelect.appendChild(createServiceOption(service));
                });
                if (exactMatch) {
                    if (categorySelect && exactMatch.categorySlug) {
                        categorySelect.value = exactMatch.categorySlug;
                        categorySelect.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    serviceSelect.value = exactMatch.id;
                    serviceSelect.dispatchEvent(new Event('change', { bubbles: true }));
                } else if (displayResults.length === 1) {
                    serviceSelect.value = displayResults[0].id;
                    serviceSelect.dispatchEvent(new Event('change', { bubbles: true }));
                }
            } else {
                // No results at all
                serviceSelect.innerHTML = '<option value="" disabled selected>No services found</option>';
            }
        });
    }

    // ==========================================
    // FORM SUBMISSION
    // ==========================================
    if (orderForm) {
        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!selectedService) {
                showToast('Please select a service', 'error');
                return;
            }

            const orderLink = document.getElementById('orderLink').value;
            const quantity = coerceQuantityInput({ clampToLimits: true });

            // Validate quantity
            const maxLimit = Number.isFinite(selectedService.max) ? selectedService.max : Infinity;
            if (!Number.isFinite(quantity) || quantity < selectedService.min || (Number.isFinite(maxLimit) && quantity > maxLimit)) {
                const maxLabel = Number.isFinite(maxLimit) ? maxLimit : 'Unlimited';
                showToast(`Quantity must be between ${selectedService.min} and ${maxLabel}`, 'error');
                return;
            }

            // Calculate charge
            const charge = (quantity / 1000) * selectedService.price;

            // Check if user has sufficient balance
            if (parseFloat(user.balance) < charge) {
                showToast('Insufficient balance. Please add funds.', 'error');
                return;
            }

            const orderData = {
                serviceId: selectedService.id,
                serviceLabel: selectedService.publicId ? `#${selectedService.publicId}` : selectedService.name,
                link: orderLink,
                quantity
            };

            try {
                const response = await fetch('/.netlify/functions/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(orderData)
                });

                const result = await response.json();

                if (response.ok) {
                    showToast('Order placed successfully!', 'success');
                    
                    // Update user balance with 5-decimal precision and trim trailing zeros
                    const newBalance = Number((parseFloat(user.balance) - charge).toFixed(5));
                    const formattedBalance = String(newBalance.toFixed(5)).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
                    user.balance = Number(formattedBalance);
                    localStorage.setItem('user', JSON.stringify(user));
                    updateUserDisplay();
                    if (window.BalanceSync) {
                        window.BalanceSync.setBalance(user.balance, { reason: 'order-created' });
                    }

                    // Reset form
                    orderForm.reset();
                    resetOrderCalculation();

                    notifyOpener({
                        type: 'ORDER_CREATED',
                        order: result.order || null,
                        source: 'dashboard'
                    });

                    if (isPopupMode) {
                        setTimeout(() => handlePopupClose(), 1200);
                        return;
                    }

                    // Switch to orders view after 2 seconds
                    setTimeout(() => {
                        showOrdersView();
                        loadOrders();
                    }, 2000);
                } else {
                    showToast(result.error || 'Failed to place order', 'error');
                }
            } catch (error) {
                console.error('Order submission error:', error);
                // Network error message removed - silent failure
            }
        });
    }

    // ==========================================
    // ORDERS VIEW
    // ==========================================
    const ordersLink = document.getElementById('ordersLink');
    const dashboardLink = document.getElementById('dashboardLink');
    const refillsLink = document.getElementById('refillsLink');
    const dashboardContent = document.getElementById('dashboardContent');
    const ordersView = document.getElementById('ordersView');
    const refillsView = document.getElementById('refillsView');
    const liveOrderStatus = document.getElementById('liveOrderStatus');
    const orderStatusMessageEl = document.getElementById('orderStatusMessage');
    const orderStatusCountsEl = document.getElementById('orderStatusCounts');
    const orderStatusLastUpdatedEl = document.getElementById('orderStatusLastUpdated');
    const orderStatusRefreshLabel = document.getElementById('orderStatusRefreshLabel');
    const orderRefundAlert = document.getElementById('orderRefundAlert');
    const refreshOrdersBtn = document.getElementById('refreshOrdersBtn');
    const orderSearchInput = document.getElementById('orderSearch');
    const refundsLink = document.getElementById('refundsLink');
    const refundsView = document.getElementById('refundsView');
    const refundsEligibleList = document.getElementById('refundsEligibleList');
    const refundsEligibleEmpty = document.getElementById('refundsEligibleEmpty');
    const refundsHistoryBody = document.getElementById('refundsHistoryBody');
    const refreshRefundsBtn = document.getElementById('refreshRefundsBtn');
    const refreshRefillsBtn = document.getElementById('refreshRefillsBtn');

    const ORDER_AUTO_REFRESH_INTERVAL_MS = 25000;
    let ordersAutoRefreshHandle = null;
    let lastOrdersUpdatedAt = null;
    window.lastOrdersSnapshot = [];  // Make global for initiateRefill access
    let ordersLoadingInFlight = false;

    function setActiveSidebarLink(activeLink) {
        document.querySelectorAll('.sidebar-link').forEach(link => {
            link.classList.remove('active');
            link.removeAttribute('aria-current');
        });

        if (activeLink) {
            activeLink.classList.add('active');
            activeLink.setAttribute('aria-current', 'page');
        }
    }

    function showOrdersView() {
        if (dashboardContent) dashboardContent.classList.add('hidden');
        if (ordersView) ordersView.classList.remove('hidden');
        if (paymentsView) paymentsView.classList.add('hidden');
        if (refundsView) refundsView.classList.add('hidden');
        if (refillsView) refillsView.classList.add('hidden');

        setActiveSidebarLink(ordersLink);
    }

    function showDashboardView() {
        if (ordersView) ordersView.classList.add('hidden');
        if (paymentsView) paymentsView.classList.add('hidden');
        if (refundsView) refundsView.classList.add('hidden');
        if (refillsView) refillsView.classList.add('hidden');
        if (dashboardContent) dashboardContent.classList.remove('hidden');

        setActiveSidebarLink(dashboardLink);
    }

    function showRefundsView() {
        if (dashboardContent) dashboardContent.classList.add('hidden');
        if (ordersView) ordersView.classList.add('hidden');
        if (paymentsView) paymentsView.classList.add('hidden');
        if (refundsView) refundsView.classList.remove('hidden');
        if (refillsView) refillsView.classList.add('hidden');

        setActiveSidebarLink(refundsLink);

        if (!lastOrdersSnapshot || lastOrdersSnapshot.length === 0) {
            loadOrders({ reason: 'refunds-view' });
        } else {
            updateRefundDisplays(lastOrdersSnapshot);
        }
    }

    function showRefillsView() {
        if (dashboardContent) dashboardContent.classList.add('hidden');
        if (ordersView) ordersView.classList.add('hidden');
        if (paymentsView) paymentsView.classList.add('hidden');
        if (refundsView) refundsView.classList.add('hidden');
        if (refillsView) refillsView.classList.remove('hidden');

        setActiveSidebarLink(refillsLink);
        loadRefillRequests();
    }

    function startOrdersAutoRefresh() {
        if (ordersAutoRefreshHandle) {
            return;
        }
        ordersAutoRefreshHandle = setInterval(() => {
            loadOrders({ silent: true, reason: 'auto-refresh' });
        }, ORDER_AUTO_REFRESH_INTERVAL_MS);
    }

    function buildCustomerFacingStatus(order = {}) {
        // Check if order was cancelled by admin - these show as cancelled
        const cancelled = order?.cancelled || order?.canceled || false;
        if (cancelled) {
            return coerceCustomerFacingStatusDescriptor('cancelled', 'Cancelled');
        }

        const summary = order?.status_summary;
        if (summary?.customer) {
            const raw = summary.customer.raw || summary.customer.key || summary.customer.label || 'pending';
            const status = coerceCustomerFacingStatusDescriptor(raw, summary.customer.label);
            
            // Show failed orders as pending unless cancelled by admin
            if (status.key === 'failed' && !cancelled) {
                return coerceCustomerFacingStatusDescriptor('pending', 'Pending');
            }
            
            return status;
        }

        const directCustomerStatus = order?.customer_status || order?.customerStatus;
        if (typeof directCustomerStatus === 'string' && directCustomerStatus.trim().length > 0) {
            const status = coerceCustomerFacingStatusDescriptor(directCustomerStatus.trim());
            
            // Show failed orders as pending unless cancelled by admin
            if (status.key === 'failed' && !cancelled) {
                return coerceCustomerFacingStatusDescriptor('pending', 'Pending');
            }
            
            return status;
        }

        const fallbackRaw = typeof order?.status === 'string'
            ? order.status
            : (order?.order_status || 'pending');

        const status = coerceCustomerFacingStatusDescriptor(fallbackRaw);
        
        // Show failed orders as pending unless cancelled by admin
        if (status.key === 'failed' && !cancelled) {
            return coerceCustomerFacingStatusDescriptor('pending', 'Pending');
        }

        return status;
    }

    function isOrderRefunded(order = {}) {
        const status = buildCustomerFacingStatus(order);
        const refundKeys = new Set(['canceled', 'cancelled', 'refunded', 'reversed']);
        if (refundKeys.has(status.key)) {
            return true;
        }

        const explicitRefund = (order.refund_status || order.refunded_status || '').toLowerCase();
        return explicitRefund === 'refunded';
    }

    function isRefundEligible(order = {}) {
        const statusCandidates = [
            order.status,
            order.customer_status,
            order.provider_status,
            order?.status_summary?.customer?.key,
            order?.status_summary?.customer?.raw,
            order?.status_summary?.provider?.key
        ];

        const normalizedStatus = statusCandidates
            .map(value => typeof value === 'string' ? value.trim().toLowerCase() : null)
            .find(value => Boolean(value));

        if (!normalizedStatus) {
            return false;
        }

        return normalizedStatus === 'pending' || normalizedStatus === 'processing' || normalizedStatus === 'in-progress';
    }

    function updateLiveStatusPanel(orders = []) {
        if (!liveOrderStatus) {
            return;
        }

        const total = Array.isArray(orders) ? orders.length : 0;
        const counts = {};
        const labels = {};

        if (total > 0) {
            orders.forEach(order => {
                const status = buildCustomerFacingStatus(order);
                const key = status.key || 'pending';
                counts[key] = (counts[key] || 0) + 1;
                if (!labels[key]) {
                    labels[key] = status.label;
                }
            });
        }

        if (orderStatusCountsEl) {
            if (total === 0) {
                orderStatusCountsEl.innerHTML = '<span class="status-chip">No orders yet</span>';
            } else {
                const priority = ['pending', 'success', 'partial', 'canceled', 'failed'];
                const chips = [];
                priority.forEach(key => {
                    if (counts[key]) {
                        const label = labels[key] || formatOrderStatusLabel(key);
                        chips.push(`<span class="status-chip" data-status="${key}">${escapeHtml(label)} · ${counts[key]}</span>`);
                    }
                });
                Object.keys(counts)
                    .filter(key => !priority.includes(key))
                    .forEach(key => {
                        const label = labels[key] || formatOrderStatusLabel(key);
                        chips.push(`<span class="status-chip" data-status="${key}">${escapeHtml(label)} · ${counts[key]}</span>`);
                    });
                orderStatusCountsEl.innerHTML = chips.length > 0
                    ? chips.join('')
                    : '<span class="status-chip">No orders yet</span>';
            }
        }

        if (orderStatusMessageEl) {
            let message = 'Place your first order to see live tracking.';
            if (total > 0) {
                const pendingTotal = (counts.pending || 0) + (counts.processing || 0);
                if (pendingTotal > 0) {
                    message = `Tracking ${pendingTotal} live order${pendingTotal === 1 ? '' : 's'}. Status will update automatically.`;
                } else if (counts.canceled) {
                    message = 'Recent orders were refunded after cancellation. Funds returned automatically.';
                } else if (counts.completed === total) {
                    message = 'All recent orders have been completed successfully.';
                } else {
                    message = 'Orders are up-to-date with the latest provider response.';
                }
            }
            orderStatusMessageEl.textContent = message;
        }

        if (orderStatusLastUpdatedEl) {
            const label = lastOrdersUpdatedAt
                ? `Last updated ${formatRelativeTimestamp(lastOrdersUpdatedAt)}`
                : 'Waiting for first update…';
            orderStatusLastUpdatedEl.textContent = label;
        }

        if (orderStatusRefreshLabel) {
            orderStatusRefreshLabel.textContent = 'Auto-refreshing every 25s';
        }
    }

    function renderRefundHistory(refundedOrders = []) {
        if (!refundsHistoryBody) {
            return;
        }

        if (!Array.isArray(refundedOrders) || refundedOrders.length === 0) {
            refundsHistoryBody.innerHTML = `
                <tr>
                    <td colspan="4">
                        <div class="refunds-empty">
                            <div class="empty-icon">💸</div>
                            <h4>No refunds yet</h4>
                            <p>Completed refunds will be listed here automatically.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        refundsHistoryBody.innerHTML = refundedOrders
            .slice(0, 25)
            .map(order => {
                const amount = formatCurrencyDisplay(
                    order.charge ?? order.customer_charge ?? order.retail_charge ?? order.amount ?? 0,
                    order.currency || order.customer_currency || order.retail_currency || 'USD'
                );
                const label = resolveOrderDisplayLabel(order);
                const updatedAgo = formatRelativeTimestamp(order.updated_at || order.last_status_sync || order.created_at || Date.now());
                const status = buildCustomerFacingStatus(order);

                return `
                    <tr>
                        <td>${escapeHtml(label)}</td>
                        <td>${escapeHtml(amount)}</td>
                        <td>${escapeHtml(updatedAgo)}</td>
                        <td><span class="refunds-status-pill" data-status="${escapeHtml(status.key)}">${escapeHtml(status.label || 'Refunded')}</span></td>
                    </tr>
                `;
            })
            .join('');
    }

    function renderRefundEligibleList(orders = []) {
        if (!refundsEligibleList || !refundsEligibleEmpty) {
            return;
        }

        const eligibleOrders = Array.isArray(orders)
            ? orders
                .filter(order => isRefundEligible(order) && !isOrderRefunded(order))
                .sort((a, b) => {
                    const aTime = new Date(a.created_at || 0).getTime();
                    const bTime = new Date(b.created_at || 0).getTime();
                    return aTime - bTime;
                })
            : [];

        if (eligibleOrders.length === 0) {
            refundsEligibleList.innerHTML = '';
            refundsEligibleEmpty.classList.remove('hidden');
            return;
        }

        refundsEligibleEmpty.classList.add('hidden');
        refundsEligibleList.innerHTML = eligibleOrders
            .slice(0, 20)
            .map(order => {
                const label = resolveOrderDisplayLabel(order);
                const createdAgo = formatRelativeTimestamp(order.created_at || order.last_status_sync || Date.now());
                const amount = formatCurrencyDisplay(
                    order.charge ?? order.customer_charge ?? order.retail_charge ?? order.amount ?? 0,
                    order.currency || order.customer_currency || order.retail_currency || 'USD'
                );

                return `
                    <li class="refunds-eligible-item">
                        <div>
                            <p class="eligible-order-id">${escapeHtml(label)}</p>
                            <p class="eligible-order-meta">Placed ${escapeHtml(createdAgo)} · ${escapeHtml(amount)}</p>
                        </div>
                        <button type="button" class="btn-refund" data-refund-order-id="${escapeHtml(order.id)}" data-order-label="${escapeHtml(label)}" data-order-amount="${escapeHtml(amount)}">
                            Request Refund
                        </button>
                    </li>
                `;
            })
            .join('');
    }

    async function updateRefundDisplays(orders = []) {
        const refundedOrders = Array.isArray(orders)
            ? orders
                .filter(order => isOrderRefunded(order))
                .sort((a, b) => {
                    const aTime = new Date(a.updated_at || a.last_status_sync || a.created_at || 0).getTime();
                    const bTime = new Date(b.updated_at || b.last_status_sync || b.created_at || 0).getTime();
                    return bTime - aTime;
                })
            : [];

        renderRefundHistory(refundedOrders);
        renderRefundEligibleList(orders);

        if (!orderRefundAlert) {
            return;
        }

        if (refundedOrders.length === 0) {
            orderRefundAlert.classList.remove('show');
            orderRefundAlert.textContent = '';
            return;
        }

        const latestRefund = refundedOrders[0];
        
        // Use original_charge for refund amount if available (pre-refund charge), otherwise fall back to current charge
        const numericAmount = Math.abs(Number(
            latestRefund.original_charge 
            ?? latestRefund.charge 
            ?? latestRefund.customer_charge 
            ?? latestRefund.retail_charge 
            ?? latestRefund.amount 
            ?? 0
        ));
        
        const currencyCode = latestRefund.currency || latestRefund.customer_currency || latestRefund.retail_currency || 'USD';
        const amount = formatCurrencyDisplay(numericAmount, currencyCode);
        const label = resolveOrderDisplayLabel(latestRefund);
        const updatedAgo = formatRelativeTimestamp(latestRefund.updated_at || latestRefund.last_status_sync || Date.now());
        const message = `${label} refunded ${amount} back to your balance ${updatedAgo}.`;

        orderRefundAlert.textContent = message;
        orderRefundAlert.classList.add('show');

        if (window.RefundState && Number.isFinite(numericAmount)) {
            window.RefundState.recordLatestRefundEvent({
                amount: numericAmount,
                currency: currencyCode,
                label,
                reference: latestRefund.transaction_id || latestRefund.payment_reference || latestRefund.provider_order_id,
                orderId: latestRefund.id || latestRefund.public_id || latestRefund.order_id,
                timestamp: latestRefund.updated_at || latestRefund.last_status_sync || latestRefund.created_at,
                source: 'dashboard-orders',
                message
            });
        }
    }

    // Customer refund requests - now shows contact support message since only admins can process refunds
    async function handleRefundRequest(orderId, triggerButton = null) {
        if (!orderId) {
            return;
        }

        const orderLabel = triggerButton?.dataset.orderLabel || `Order ${orderId}`;
        
        // Inform customer to contact support for refunds
        const message = `To cancel ${orderLabel} and request a refund, please contact our support team.\n\nOnly administrators can process order cancellations and refunds.`;
        
        const contactSupport = window.confirm(message + '\n\nWould you like to open a support ticket?');
        
        if (contactSupport) {
            // Redirect to tickets page or contact page
            window.location.href = 'tickets.html?subject=' + encodeURIComponent(`Refund Request for ${orderLabel}`);
        }
        
        return; // Customer cannot directly cancel - must go through admin
    }

    function stopOrdersAutoRefresh() {
        if (!ordersAutoRefreshHandle) {
            return;
        }
        clearInterval(ordersAutoRefreshHandle);
        ordersAutoRefreshHandle = null;
    }

    if (ordersLink) {
        ordersLink.addEventListener('click', (e) => {
            e.preventDefault();
            showOrdersView();
            loadOrders({ reason: 'orders-sidebar' });
        });
    }
    
    if (dashboardLink) {
        dashboardLink.addEventListener('click', (e) => {
            e.preventDefault();
            showDashboardView();
        });
    }

    if (refreshOrdersBtn) {
        refreshOrdersBtn.addEventListener('click', () => {
            loadOrders({ reason: 'orders-manual-refresh' });
        });
    }

    if (refundsLink) {
        refundsLink.addEventListener('click', (e) => {
            e.preventDefault();
            showRefundsView();
        });
    }

    if (refreshRefundsBtn) {
        refreshRefundsBtn.addEventListener('click', () => {
            loadOrders({ reason: 'refunds-manual-refresh' });
        });
    }

    if (refillsLink) {
        refillsLink.addEventListener('click', (e) => {
            e.preventDefault();
            showRefillsView();
        });
    }

    if (refreshRefillsBtn) {
        refreshRefillsBtn.addEventListener('click', () => {
            loadRefillRequests();
        });
    }

    if (refundsView) {
        refundsView.addEventListener('click', (event) => {
            const actionButton = event.target.closest('[data-refund-order-id]');
            if (!actionButton) {
                return;
            }

            event.preventDefault();
            const orderId = actionButton.dataset.refundOrderId;
            if (orderId) {
                handleRefundRequest(orderId, actionButton);
            }
        });
    }

    // Ensure initial active state has aria-current set
    if (dashboardLink) {
        setActiveSidebarLink(dashboardLink);
    }

    // ==========================================
    // REAL-TIME ORDER HANDLER (BOTZZZ773)
    // ==========================================
    function handleRealtimeOrderUpdate(data) {
        
        if (!data || !data.record) {
            return;
        }
        
        const record = data.record;
        const eventType = data.type || 'UPDATE';
        
        // Check if this order belongs to current user
        const currentUserId = user?.id || user?.user_id;
        if (record.user_id && record.user_id !== currentUserId) {
            return;
        }
        
        // Update last orders snapshot if we have it
        if (lastOrdersSnapshot && lastOrdersSnapshot.length > 0) {
            const orderIndex = lastOrdersSnapshot.findIndex(o => o.id === record.id);
            
            if (eventType === 'INSERT') {
                // New order - add to beginning
                lastOrdersSnapshot.unshift(record);
                lastOrdersUpdatedAt = Date.now();
            } else if (eventType === 'UPDATE' && orderIndex >= 0) {
                // Update existing order
                lastOrdersSnapshot[orderIndex] = { ...lastOrdersSnapshot[orderIndex], ...record };
                lastOrdersUpdatedAt = Date.now();
            } else if (eventType === 'DELETE' && orderIndex >= 0) {
                // Remove deleted order
                lastOrdersSnapshot.splice(orderIndex, 1);
                lastOrdersUpdatedAt = Date.now();
            }
            
            // Re-render displays with updated data
            updateLiveStatusPanel(lastOrdersSnapshot);
            updateRefundDisplays(lastOrdersSnapshot);
            
            const ordersTableBody = document.getElementById('ordersTableBody');
            if (ordersTableBody && lastOrdersSnapshot.length > 0) {
                displayOrders(lastOrdersSnapshot);
            }
        } else {
            // No snapshot yet, do a full reload
            loadOrders({ silent: true, reason: 'realtime-update' });
        }
    }
    
    // Expose real-time handler globally for botzzz773-realtime.js
    window.BOTZZZ773_handleDashboardOrderUpdate = handleRealtimeOrderUpdate;

    // Load orders from backend
    let ordersPageOffset = 0;
    const ordersPageLimit = 100; // show 100 per page

    function parseSearchQuery() {
        const raw = orderSearchInput ? String(orderSearchInput.value || '').trim() : '';
        if (!raw) return {};
        // Accept comma-separated order_numbers (e.g., 37000041,37000052)
        const parts = raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (parts.length === 0) return {};
        // Only send numbers for order_number search (not ids)
        return { numbers: parts.join(',') };
    }

    function buildOrdersQueryParams(extra = {}) {
        const searchParams = parseSearchQuery();
        const qp = new URLSearchParams();
        qp.set('limit', String(ordersPageLimit));
        qp.set('offset', String(ordersPageOffset));
        if (searchParams.numbers) qp.set('numbers', searchParams.numbers);
        if (extra.status) qp.set('status', extra.status);
        const queryString = qp.toString();
        return queryString;
    }

    function attachPaginationControls(hasMore) {
        const pagers = Array.from(document.querySelectorAll('[data-orders-pager]'));
        if (pagers.length === 0) {
            console.warn('[DASHBOARD] Pagination container not found');
            return;
        }

        const start = ordersPageOffset + 1;
        const end = ordersPageOffset + ordersPageLimit;

        pagers.forEach((pager) => {
            pager.innerHTML = `
                <button type="button" class="btn-soft" data-orders-prev disabled>Prev</button>
                <span class="pager-info" data-orders-info></span>
                <button type="button" class="btn-soft" data-orders-next>Next</button>
            `;

            const prevBtn = pager.querySelector('[data-orders-prev]');
            const nextBtn = pager.querySelector('[data-orders-next]');
            const infoEl = pager.querySelector('[data-orders-info]');

            if (prevBtn) {
                prevBtn.disabled = ordersPageOffset <= 0;
                prevBtn.onclick = () => {
                    if (ordersPageOffset >= ordersPageLimit) {
                        ordersPageOffset -= ordersPageLimit;
                        loadOrders({ silent: true, reason: 'pager-prev' });
                    }
                };
            }

            if (nextBtn) {
                nextBtn.disabled = !hasMore;
                nextBtn.onclick = () => {
                    if (hasMore) {
                        ordersPageOffset += ordersPageLimit;
                        loadOrders({ silent: true, reason: 'pager-next' });
                    }
                };
            }

            if (infoEl) {
                infoEl.textContent = `Showing ${start}–${end}`;
            }
        });
    }

    if (orderSearchInput) {
        let debounceTimer = null;
        const triggerSearch = () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                ordersPageOffset = 0; // reset paging on new search
                loadOrders({ silent: true, reason: 'search' });
            }, 300);
        };
        orderSearchInput.addEventListener('input', triggerSearch);
        orderSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                triggerSearch();
            }
        });
        const searchBtn = document.querySelector('.order-search .search-btn');
        if (searchBtn) {
            searchBtn.addEventListener('click', (e) => {
                e.preventDefault();
                triggerSearch();
            });
        }
    }
    async function loadOrders(options = {}) {
        const {
            silent = false,
            reason = 'manual'
        } = options;

        if (ordersLoadingInFlight && reason === 'auto-refresh') {
            return;
        }

        const ordersTableBody = document.getElementById('ordersTableBody');

        if (!silent && ordersTableBody) {
            ordersTableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="no-orders">
                        <div class="payments-loading">
                            <div class="spinner"></div>
                            <span>Refreshing your orders…</span>
                        </div>
                    </td>
                </tr>
            `;
        }

        ordersLoadingInFlight = true;

        try {
            const qs = buildOrdersQueryParams();
            const response = await fetch('/.netlify/functions/orders?' + qs, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const result = await response.json();

            if (response.ok && Array.isArray(result.orders)) {
                lastOrdersSnapshot = result.orders;
                lastOrdersUpdatedAt = Date.now();
                updateLiveStatusPanel(result.orders);
                updateRefundDisplays(result.orders);
                if (ordersTableBody) {
                    if (result.orders.length > 0) {
                        displayOrders(result.orders);
                        const hasMore = result.orders.length === ordersPageLimit; // heuristic
                        attachPaginationControls(hasMore);
                    } else {
                        ordersTableBody.innerHTML = `
                            <tr>
                                <td colspan="9" class="no-orders">
                                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                        <circle cx="12" cy="12" r="10"/>
                                        <line x1="12" y1="8" x2="12" y2="12"/>
                                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                                    </svg>
                                    <p>No orders found</p>
                                </td>
                            </tr>
                        `;
                        attachPaginationControls(false);
                    }
                }
                startOrdersAutoRefresh();
            } else {
                if (ordersTableBody) {
                    ordersTableBody.innerHTML = `
                        <tr>
                            <td colspan="9" class="no-orders">
                                <p>Unable to load orders right now.</p>
                            </td>
                        </tr>
                    `;
                }
                updateLiveStatusPanel([]);
                updateRefundDisplays([]);
            }
        } catch (error) {
            console.error('Error loading orders:', error);
            if (ordersTableBody) {
                ordersTableBody.innerHTML = `
                    <tr>
                        <td colspan="9" class="no-orders">
                            <p>Something went wrong while loading your orders.</p>
                        </td>
                    </tr>
                `;
            }
            updateLiveStatusPanel(lastOrdersSnapshot);
        } finally {
            ordersLoadingInFlight = false;
        }
    }

    function displayOrders(orders) {
        const ordersTableBody = document.getElementById('ordersTableBody');
        if (!ordersTableBody) return;

        if (orders.length === 0) {
            ordersTableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="no-orders">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <p>No orders found</p>
                    </td>
                </tr>
            `;
            return;
        }

        ordersTableBody.innerHTML = orders.map(order => {
            const orderLabel = resolveOrderDisplayLabel(order);
            const orderIdCell = `
                <div class="order-id-cell">
                    <span class="order-id-primary">${escapeHtml(orderLabel)}</span>
                </div>
            `;
            const createdAt = (function () {
                if (!order.created_at) return '—';
                const d = new Date(order.created_at);
                if (Number.isNaN(d.getTime())) return '—';
                const pad = v => String(v).padStart(2, '0');
                const y = d.getFullYear();
                const m = pad(d.getMonth() + 1);
                const day = pad(d.getDate());
                const hh = pad(d.getHours());
                const mm = pad(d.getMinutes());
                const ss = pad(d.getSeconds());
                return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
            })();
            const orderLink = typeof order.link === 'string' && order.link.trim().length > 0
                ? order.link.trim()
                : null;
            const linkLabel = orderLink
                ? `${orderLink.substring(0, 30)}${orderLink.length > 30 ? '…' : ''}`
                : 'No link provided';
            const safeOrderLink = orderLink ? escapeHtml(orderLink) : '';

            const currencyGuess = order.currency
                || order.retail_currency
                || order.customer_currency
                || order.service?.currency
                || 'USD';
            const chargeRaw = Number(order.original_charge ?? order.charge ?? order.retail_charge ?? order.customer_charge ?? order.amount ?? 0);
            const chargeDisplay = formatCurrencyDisplay(chargeRaw, currencyGuess);

            const quantity = Number.isFinite(Number(order.quantity))
                ? Number(order.quantity)
                : 0;
            
            // Find service public_id from services cache if available
            let servicePublicId = null;
            const serviceName = order.service?.name || order.service_name || 'Service';
            
            if (order.service?.id && window.servicesCache) {
                const cachedService = window.servicesCache.find(s => s.id === order.service.id);
                if (cachedService && cachedService.public_id) {
                    servicePublicId = cachedService.public_id;
                }
            }
            
            const serviceBadge = servicePublicId
                ? `#${servicePublicId} · ${escapeHtml(serviceName)}`
                : `${escapeHtml(serviceName)}`;
            
            const customerStatus = buildCustomerFacingStatus(order);
            const statusKey = customerStatus.key;
            const statusLabel = customerStatus.label;
            const refunded = isOrderRefunded(order);
            
            // Check if refill button should be shown
            const refillButtonEnabled = order.service?.refill_supported === true || order.service?.refill_supported === 1;
            let refillButtonCell = '';
            
            if (refillButtonEnabled && order.status === 'completed' && order.completed_at) {
                const now = new Date();
                const REFILL_TIMEOUT_HOURS = 24;
                let refillDisabled = false;
                let disabledReason = '';
                
                // Check if refill was already requested in the last 24 hours
                if (order.refill_requested_at) {
                    const refillRequestTime = new Date(order.refill_requested_at);
                    const hoursSinceRequest = (now - refillRequestTime) / (1000 * 60 * 60);
                    
                    if (hoursSinceRequest < REFILL_TIMEOUT_HOURS) {
                        refillDisabled = true;
                        const hoursRemaining = Math.floor(REFILL_TIMEOUT_HOURS - hoursSinceRequest);
                        const minutesRemaining = Math.ceil(((REFILL_TIMEOUT_HOURS - hoursSinceRequest) % 1) * 60);
                        disabledReason = `Next refill in ${hoursRemaining}h ${minutesRemaining}m`;
                    }
                } else {
                    // Check if order is less than 24 hours old
                    const completedTime = new Date(order.completed_at);
                    const hoursPassed = (now - completedTime) / (1000 * 60 * 60);
                    
                    if (hoursPassed < REFILL_TIMEOUT_HOURS) {
                        refillDisabled = true;
                        const hoursRemaining = Math.floor(REFILL_TIMEOUT_HOURS - hoursPassed);
                        const minutesRemaining = Math.ceil(((REFILL_TIMEOUT_HOURS - hoursPassed) % 1) * 60);
                        disabledReason = `Refill available in ${hoursRemaining}h ${minutesRemaining}m`;
                    }
                }
                
                if (refillDisabled) {
                    refillButtonCell = `<button class="btn-refill btn-disabled" disabled title="${disabledReason}" style="opacity: 0.5; cursor: not-allowed;">↻ Refill</button>`;
                } else {
                    refillButtonCell = `<button class="btn-refill" onclick="window.initiateRefill('${order.id}', ${order.service?.id})" title="Request refill for this order">↻ Refill</button>`;
                }
            }

            return `
                <tr>
                    <td>${orderIdCell}</td>
                    <td>${createdAt}</td>
                    <td>${orderLink
                        ? `<a href="${safeOrderLink}" target="_blank" rel="noopener" style="color: var(--primary-pink);">${escapeHtml(linkLabel)}</a>`
                        : '<span style="color: var(--text-muted, #94a3b8); font-style: italic;">No link</span>'}
                    </td>
                    <td>${chargeDisplay}</td>
                    <td>${escapeHtml(order.start_count || 0)}</td>
                    <td>${escapeHtml(quantity)}</td>
                    <td>${serviceBadge}</td>
                    <td>
                        <div class="status-cell">
                            <span class="status-badge status-${statusKey}">${escapeHtml(statusLabel)}</span>
                            ${refunded ? '<span class="refund-pill">Refunded</span>' : ''}
                        </div>
                    </td>
                    <td>${escapeHtml(order.remains || 0)}</td>
                    <td style="text-align: center;">${refillButtonCell}</td>
                </tr>
            `;
        }).join('');
    }

    // Order filters
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            const filter = e.target.dataset.filter;
            // Implement filter logic here
        });
    });

    // ==========================================
    // PAYMENTS VIEW
    // ==========================================
    const paymentsLink = document.getElementById('paymentsLink');
    const paymentsView = document.getElementById('paymentsView');
    const paymentsTableBody = document.getElementById('paymentsTableBody');
    const paymentsLoadingState = document.getElementById('paymentsLoadingState');
    const paymentsEmptyState = document.getElementById('paymentsEmptyState');
    const paymentsErrorState = document.getElementById('paymentsErrorState');
    const refreshPaymentsBtn = document.getElementById('refreshPaymentsBtn');

    function showPaymentsView() {
        // Hide other views
        if (dashboardContent) dashboardContent.classList.add('hidden');
        if (ordersView) ordersView.classList.add('hidden');
        if (refundsView) refundsView.classList.add('hidden');
        if (refillsView) refillsView.classList.add('hidden');
        
        // Show payments view
        if (paymentsView) paymentsView.classList.remove('hidden');

        setActiveSidebarLink(paymentsLink);
    }

    async function loadPayments() {
        if (!paymentsTableBody || !paymentsLoadingState || !paymentsEmptyState || !paymentsErrorState) {
            console.error('Payments view elements not found');
            return;
        }

        // Show loading state
        paymentsLoadingState.classList.remove('hidden');
        paymentsEmptyState.classList.add('hidden');
        paymentsErrorState.classList.add('hidden');

        try {
            const response = await fetch('/.netlify/functions/payments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'history'
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            // Hide loading state
            paymentsLoadingState.classList.add('hidden');

            if (result.payments && result.payments.length > 0) {
                displayPayments(result.payments);
            } else {
                paymentsEmptyState.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Failed to load payments:', error);
            
            // Hide loading state and show error
            paymentsLoadingState.classList.add('hidden');
            paymentsErrorState.classList.remove('hidden');
            paymentsErrorState.innerHTML = `
                <h3>Failed to load payments</h3>
                <p>Please try again later or contact support if the problem persists.</p>
                <button class="btn-secondary" onclick="location.reload()">Retry</button>
            `;
        }
    }

    function displayPayments(payments = []) {
        if (!paymentsTableBody) return;

        paymentsTableBody.innerHTML = payments.map(payment => {
            const timestamp = payment.created_at ? new Date(payment.created_at) : null;
            const date = (timestamp && !Number.isNaN(timestamp.getTime()))
                ? (function () {
                    const pad = (v) => String(v).padStart(2, '0');
                    const y = timestamp.getFullYear();
                    const m = pad(timestamp.getMonth() + 1);
                    const d = pad(timestamp.getDate());
                    const hh = pad(timestamp.getHours());
                    const mm = pad(timestamp.getMinutes());
                    const ss = pad(timestamp.getSeconds());
                    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
                })()
                : '—';

            const amountValue = Number(payment.amount || 0);
            const isRefund = amountValue < 0 || (payment.method || '').toLowerCase() === 'refund' || (payment.status || '').toLowerCase() === 'refunded';
            const amountPrefix = isRefund ? '−' : '+';
            const amountDisplay = formatCurrencyDisplay(Math.abs(amountValue), payment.currency || 'USD');
            const amountClass = `payment-amount ${isRefund ? 'refund' : 'deposit'}`;

            const method = formatPaymentMethodLabel(payment.method);
            const statusRaw = (payment.status || (isRefund ? 'refunded' : 'pending')).toLowerCase();
            const statusKey = statusRaw === 'completed' && isRefund ? 'refunded' : statusRaw;
            const statusLabel = statusKey ? formatOrderStatusLabel(statusKey) : 'Pending';
            const statusClass = ['completed', 'pending', 'failed', 'refunded'].includes(statusKey)
                ? statusKey
                : 'pending';

            const reference = escapeHtml(payment.transaction_id || payment.id || '—');
            const memo = payment.memo
                ? `<p class="payment-memo">${escapeHtml(payment.memo)}</p>`
                : '';

            return `
                <tr>
                    <td>
                        <span class="payment-reference">${reference}</span>
                        ${memo}
                    </td>
                    <td>${date}</td>
                    <td><span class="payment-method">${escapeHtml(method)}</span></td>
                    <td class="${amountClass}">${amountPrefix}${amountDisplay}</td>
                    <td><span class="payment-status ${statusClass}">${escapeHtml(statusLabel)}</span></td>
                </tr>
            `;
        }).join('');
    }

    function formatPaymentMethodLabel(method) {
        if (!method) {
            return 'Manual';
        }

        const value = String(method).toLowerCase();
        switch (value) {
            case 'payeer':
                return 'Payeer';
            case 'stripe':
                return 'Stripe';
            case 'cryptomus':
                return 'Cryptomus';
            case 'heleket':
                return 'Heleket';
            case 'refund':
                return 'Refund';
            case 'manual':
                return 'Manual';
            default:
                const normalized = String(method);
                return normalized.charAt(0).toUpperCase() + normalized.slice(1);
        }
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('popup:order-created', (event) => {
            if (event?.detail?.source === 'dashboard') {
                return;
            }
            refreshUserSnapshot();
            loadOrders({ reason: 'popup-order-created' });
        });

        window.addEventListener('popup:add-funds-order-created', () => {
            refreshUserSnapshot();
            loadPayments();
        });

        // Listen for payment success to refresh balance and payments
        window.addEventListener('popup:payment-success', () => {
            refreshUserSnapshot({ reason: 'payment-success' });
            loadPayments();
        });
    }

    // Payments navigation
    if (paymentsLink) {
        paymentsLink.addEventListener('click', (e) => {
            e.preventDefault();
            showPaymentsView();
            loadPayments();
        });
    }

    // Refresh button removed; payments auto-refresh via events

    // Initialize
    updateUserDisplay();
    updateDiscountBadge();

    if (window.BalanceSync) {
        window.BalanceSync.configure({
            fetcher: (context = {}) => refreshUserSnapshot({ reason: context.reason || 'balance-sync' })
        });

        window.BalanceSync.setUser(user, { reason: 'dashboard-init' });
        window.BalanceSync.subscribe(({ user: syncedUser, balance }) => {
            if (!syncedUser) {
                return;
            }
            Object.assign(user, syncedUser);
            if (Number.isFinite(balance)) {
                user.balance = balance;
            }
            updateUserDisplay();
        });
    }

    loadOrders({ silent: true, reason: 'initial-load' });
    
    // Load services from database on page load
    loadServicesFromDatabase().then(success => {
        // Services loaded
    });

    function resolveAuthToken(reason) {
        const token = getAuthToken();
        if (!token) {
            handleMissingAuth(reason || 'token-missing');
        }
        return token;
    }

    function getAuthToken() {
        try {
            const token = localStorage.getItem('token');
            return token;
        } catch (error) {
            console.warn('[DASHBOARD] Unable to read auth token from storage.', error);
            return null;
        }
    }

    function resolveUserProfile(reason) {
        const userData = getStoredUser();
        if (!userData) {
            console.warn('[DASHBOARD] No user found, triggering auth guard');
            handleMissingAuth(reason || 'user-missing');
        }
        return userData;
    }

    function getStoredUser() {
        try {
            const raw = localStorage.getItem('user');
            if (!raw) {
                return null;
            }
            return JSON.parse(raw);
        } catch (error) {
            console.warn('[DASHBOARD] Failed to parse user profile.', error);
            localStorage.removeItem('user');
            return null;
        }
    }

    function handleMissingAuth(reason) {
        if (authGuardTriggered) {
            return;
        }
        authGuardTriggered = true;

        const payload = { type: 'AUTH_REQUIRED', source: 'dashboard', reason };
        notifyOpener(payload);

        if (isPopupMode) {
            setTimeout(() => {
                try {
                    window.close();
                } catch (error) {
                    console.warn('[DASHBOARD] Failed to close popup after auth guard.', error);
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

    // ==========================================
    // REFILL REQUEST HANDLER
    // ==========================================
    window.initiateRefill = async function(orderId, serviceId) {
        try {
            // Get lastOrdersSnapshot from global scope
            const lastOrdersSnapshot = window.lastOrdersSnapshot;

            // Find the order in current snapshot
            const order = lastOrdersSnapshot?.find(o => o.id === orderId);
            if (!order) {
                showToast('Order not found', 'error');
                return;
            }

            // Check if order is completed
            if (order.status !== 'completed') {
                showToast('Refill only available for completed orders', 'error');
                return;
            }

            // Check 24-hour timeout
            if (!order.completed_at) {
                showToast('Order completion time not recorded', 'error');
                return;
            }

            const completedTime = new Date(order.completed_at);
            const now = new Date();
            const hoursPassed = (now - completedTime) / (1000 * 60 * 60);
            const REFILL_TIMEOUT_HOURS = 24;

            if (hoursPassed < REFILL_TIMEOUT_HOURS) {
                const hoursRemaining = Math.floor(REFILL_TIMEOUT_HOURS - hoursPassed);
                const minutesRemaining = Math.ceil(((REFILL_TIMEOUT_HOURS - hoursPassed) % 1) * 60);
                
                showToast(
                    `Refill available in ${hoursRemaining}h ${minutesRemaining}m`,
                    'warning'
                );
                return;
            }

            // Show loading toast
            const loadingToastId = Math.random().toString(36);
            showToast('Submitting refill request...', 'info');

            // Try v2.js endpoint first (preferred), then fallback to orders.js
            let refillResult = null;
            
            // Attempt 1: Try v2.js endpoint with API key
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            const apiKey = user.api_key || localStorage.getItem('api_key');

            if (apiKey) {
                try {
                    const response = await fetch(
                        `/.netlify/functions/v2?action=refill&order=${encodeURIComponent(order.order_number)}&key=${encodeURIComponent(apiKey)}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        }
                    );

                    if (response.ok) {
                        const result = await response.json();
                        if (result.refill) {
                            refillResult = { endpoint: 'v2', refill: result.refill };
                        }
                    }
                } catch (error) {
                    // V2 endpoint failed, will try orders.js
                }
            } else {
                console.log('[REFILL] No API key, skipping V2.js');
            }

            // Attempt 2: Fallback to orders.js endpoint with JWT token
            if (!refillResult) {
                const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
                console.log('[REFILL] Orders.js - Auth token available?', !!token);
                
                if (!token) {
                    console.error('[REFILL] No auth token found!');
                    showToast('Authentication token not found. Please log in again.', 'error');
                    return;
                }

                try {
                    console.log('[REFILL] Attempting Orders.js endpoint...');
                    const response = await fetch('/.netlify/functions/orders', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            action: 'refill',
                            orderId: orderId
                        })
                    });

                    console.log('[REFILL] Orders.js response status:', response.status);
                    if (response.ok) {
                        const result = await response.json();
                        console.log('[REFILL] Orders.js success:', result);
                        if (result.refill) {
                            refillResult = { endpoint: 'orders', refill: result.refill };
                        }
                    } else {
                        console.warn('[REFILL] Orders.js failed with status:', response.status);
                        const errorBody = await response.text();
                        console.warn('[REFILL] Orders.js error body:', errorBody);
                    }
                } catch (error) {
                    console.error('[REFILL] orders.js error:', error.message);
                }
            }

            if (refillResult) {
                console.log('[REFILL] SUCCESS! Result:', refillResult);
                showToast(
                    `Refill request submitted successfully! Refill ID: #${refillResult.refill}`,
                    'success'
                );

                // Update order status in snapshot
                if (order) {
                    order.refill_id = refillResult.refill;
                    order.status = 'refilling';
                    order.refill_requested_at = new Date().toISOString();
                }

                // Refresh orders view
                setTimeout(() => {
                    loadOrders({ silent: true, reason: 'refill-submitted' });
                }, 1500);
            } else {
                console.log('[REFILL] FAILED - No refill result from any endpoint');
                showToast('Failed to submit refill request. Please try again.', 'error');
            }
        } catch (error) {
            console.error('[REFILL] Error:', error);
            showToast('Failed to submit refill request', 'error');
        }
    };

    // ==========================================
    // REFILL REQUESTS VIEW
    // ==========================================
    window.loadRefillRequests = async function() {
        console.log('[REFILLS] Loading refill requests...');
        const tbody = document.getElementById('refillsTableBody');
        if (!tbody) return;

        // Show loading state
        tbody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; padding: 40px; color: #999;">
                    <i class="fas fa-spinner" style="font-size: 32px; animation: spin 1s linear infinite;"></i>
                    <p style="margin-top: 16px;">Loading refill requests...</p>
                </td>
            </tr>
        `;

        try {
            const token = localStorage.getItem('token');
            
            const response = await fetch('/.netlify/functions/user-refills?action=list', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('[REFILLS] Error response:', errorText);
                throw new Error(`Failed to load refill requests: ${response.status}`);
            }

            const data = await response.json();

            if (!data.success || !data.refills || data.refills.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 40px; color: #999;">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 16px; display: block;">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="8" x2="12" y2="12"/>
                                <line x1="12" y1="16" x2="12.01" y2="16"/>
                            </svg>
                            <p>No refill requests found</p>
                        </td>
                    </tr>
                `;
                return;
            }

            let html = '';
            data.refills.forEach(refill => {
                const status = refill.status || 'pending';
                const statusClass = status.replace(/ /g, '-'); // Convert spaces to hyphens for CSS class
                
                // Format date as YYYY-MM-DD HH:MM:SS
                const date = new Date(refill.requested_at);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                const seconds = String(date.getSeconds()).padStart(2, '0');
                const requestedDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
                
                html += `
                    <tr>
                        <td>#${refill.refill_id}</td>
                        <td>${refill.order_number}</td>
                        <td>${refill.service_id}</td>
                        <td>
                            <span class="status-badge ${statusClass}">
                                ${status.charAt(0).toUpperCase() + status.slice(1)}
                            </span>
                        </td>
                        <td>${requestedDate}</td>
                    </tr>`;
            });

            tbody.innerHTML = html;
        } catch (error) {
            console.error('[REFILLS ERROR]', error);
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align: center; padding: 40px; color: #dc2626;">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; display: block;">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <p>${error.message}</p>
                    </td>
                </tr>
            `;
        }
    };

})();
