// ==========================================
// Services Page JavaScript
// ==========================================

let filterButtons;
let authToken = null;
const serviceDetailsMap = {};
let servicesStatusController = null;
let servicesNetworkController = null;

function createServiceStatusController() {
    const container = document.querySelector('[data-service-status]');
    if (!container) {
        return null;
    }

    const iconEl = container.querySelector('[data-status-icon]');
    const labelEl = container.querySelector('[data-status-label]');
    const helperEl = container.querySelector('[data-status-helper]');
    const actionBtn = container.querySelector('[data-retry-services]');

    const defaults = {
        loading: {
            icon: '⏳',
            label: 'Checking curated services…',
            helper: 'Hang tight while we reach Netlify.',
            showRetry: false
        },
        retrying: {
            icon: '🔁',
            label: 'Retrying curated services…',
            helper: 'We are trying the request again automatically.',
            showRetry: false
        },
        success: {
            icon: '✅',
            label: 'Services synced',
            helper: 'Filter or search to find what you need.',
            showRetry: false
        },
        empty: {
            icon: '📦',
            label: 'No curated services yet',
            helper: 'An admin needs to approve storefront slots.',
            showRetry: true
        },
        error: {
            icon: '⚠️',
            label: 'Could not reach services',
            helper: 'Check your connection or retry below.',
            showRetry: true
        }
    };

    let retryHandler = null;

    function setState(state = 'loading', overrides = {}) {
        const config = { ...(defaults[state] || defaults.loading), ...overrides };
        if (iconEl) iconEl.textContent = config.icon;
        if (labelEl) labelEl.textContent = config.label;
        if (helperEl) helperEl.textContent = config.helper;
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

function requireAuth() {
    const token = localStorage.getItem('token');
    const rawUser = localStorage.getItem('user');

    if (!token || !rawUser) {
        window.location.href = 'signin.html';
        return null;
    }

    try {
        const user = JSON.parse(rawUser);
        authToken = token;
        return { token, user };
    } catch (error) {
        console.error('[SERVICES] Invalid cached user payload:', error);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = 'signin.html';
        return null;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const auth = requireAuth();
    if (!auth) {
        return;
    }

    servicesStatusController = createServiceStatusController();
    servicesNetworkController = createNetworkPillController();

    if (servicesStatusController) {
        servicesStatusController.onRetry(() => {
            loadServicesFromAPI({ manualRetry: true });
        });
    }

    // Load services from API first, then initialize filters
    loadServicesFromAPI()
        .then(isLoaded => {
            if (isLoaded) {
                initializeFilters();
            } else {
                console.warn('[FILTERS] Skipping initialization because services failed to load.');
            }
        })
        .catch(error => {
            console.error('[FILTERS] Failed to load services before initialization:', error);
        });
    
    // Initialize search (can work immediately)
    initializeSearch();
});

// Initialize filter buttons
function initializeFilters() {
    filterButtons = document.querySelectorAll('[data-filter]');
    
    console.log('[FILTERS] Initializing with', filterButtons.length, 'buttons');
    
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            const filter = this.dataset.filter;
            const serviceCategories = document.querySelectorAll('.service-category');
            
            console.log('[FILTER] Clicked:', filter);
            console.log('[FILTER] Found categories:', serviceCategories.length);
            
            // Update active button
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Filter categories
            serviceCategories.forEach(category => {
                if (filter === 'all') {
                    category.style.display = 'block';
                } else {
                    const categoryName = category.dataset.category;
                    console.log('[FILTER] Category:', categoryName, 'Filter:', filter, 'Match:', categoryName === filter);
                    if (categoryName === filter) {
                        category.style.display = 'block';
                    } else {
                        category.style.display = 'none';
                    }
                }
            });
            
            // Animate appearance
            setTimeout(() => {
                const visibleCategories = Array.from(serviceCategories)
                    .filter(cat => cat.style.display !== 'none');
                visibleCategories.forEach((cat, index) => {
                    cat.style.animation = 'none';
                    setTimeout(() => {
                        cat.style.animation = 'fadeInUp 0.5s ease';
                    }, index * 100);
                });
            }, 100);
        });
    });
    
    console.log('[FILTERS] Initialized successfully');
}

// Initialize search functionality
function initializeSearch() {
    const searchInput = document.getElementById('serviceSearch');
    
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const serviceCategories = document.querySelectorAll('.service-category');
            
            serviceCategories.forEach(category => {
                const categoryTitle = category.querySelector('.category-title')?.textContent.toLowerCase() || '';
                const rows = category.querySelectorAll('.service-row:not(.service-row-header)');
                let hasVisibleRow = false;
                
                rows.forEach(row => {
                    const serviceName = row.querySelector('strong')?.textContent.toLowerCase() || '';
                    const serviceDetails = row.querySelector('.service-details')?.textContent.toLowerCase() || '';
                    
                    if (serviceName.includes(searchTerm) || 
                        serviceDetails.includes(searchTerm) ||
                        categoryTitle.includes(searchTerm)) {
                        row.style.display = 'grid';
                        hasVisibleRow = true;
                    } else {
                        row.style.display = 'none';
                    }
                });
                
                if (hasVisibleRow || categoryTitle.includes(searchTerm)) {
                    category.style.display = 'block';
                } else {
                    category.style.display = 'none';
                }
            });
        });
    }
    
    // Smooth scroll to category from hash
    if (window.location.hash) {
        setTimeout(() => {
            const target = document.querySelector(window.location.hash);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    }
}

// Add fade in animation
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);

console.log('📱 Services page loaded!');

// ==========================================
// Load Services from API
// ==========================================

async function loadServicesFromAPI(options = {}) {
    const container = document.getElementById('servicesContainer');
    if (!container) {
        console.warn('[SERVICES] Container element not found.');
        return false;
    }

    const isRetry = Boolean(options.manualRetry);
    
    try {
        // Show loading state
        container.innerHTML = '<div class="loading-spinner" style="text-align: center; padding: 60px;"><div style="display: inline-block; width: 50px; height: 50px; border: 4px solid rgba(255,20,148,0.2); border-top-color: #FF1494; border-radius: 50%; animation: spin 1s linear infinite;"></div><p style="margin-top: 20px; color: #94A3B8;">Loading services...</p></div>';
        servicesStatusController?.setState(isRetry ? 'retrying' : 'loading', {
            helper: isRetry ? 'Requesting a fresh copy from the API…' : 'Hang tight while we reach Netlify.'
        });
        
        const headers = {
            'Content-Type': 'application/json'
        };

        if (authToken) {
            headers.Authorization = `Bearer ${authToken}`;
        }

        const response = await fetch('/.netlify/functions/services?audience=customer', {
            method: 'GET',
            headers
        });

        const rawBody = await response.text();
        let data;
        try {
            data = rawBody ? JSON.parse(rawBody) : {};
        } catch (parseError) {
            console.error('[SERVICES] Failed to parse services response:', parseError, rawBody);
            throw new Error('Received invalid response while loading services');
        }

        if (response.status === 401 || response.status === 403) {
            console.warn('[SERVICES] Services request unauthorized. Response:', data);
            container.innerHTML = `
                <div style="text-align: center; padding: 80px 20px;">
                    <div style="font-size: 80px; margin-bottom: 20px;">🔒</div>
                    <h3 style="color: #1E293B; margin-bottom: 12px; font-size: 24px;">Session Expired</h3>
                    <p style="color: #64748B; font-size: 16px; margin-bottom: 20px;">Please sign in again to view services.</p>
                    <a href="signin.html" class="btn btn-primary">Go to Sign In</a>
                </div>
            `;
            servicesStatusController?.setState('error', {
                label: 'Session expired',
                helper: 'Sign back in to browse the catalog.'
            });
            return false;
        }

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load services');
        }

        const services = Array.isArray(data.services) ? data.services : [];
        const approvedServices = services.filter(service => service.admin_approved === true || service.adminApproved === true);
        console.log('[DEBUG] Loaded services:', services.length, 'approved:', approvedServices.length);
        
        if (approvedServices.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 80px 20px;">
                    <div style="font-size: 80px; margin-bottom: 20px;">📦</div>
                    <h3 style="color: #1E293B; margin-bottom: 12px; font-size: 24px;">No Services Available</h3>
                    <p style="color: #64748B; font-size: 16px;">Services will appear once an admin approves them for customers.</p>
                </div>
            `;
            servicesStatusController?.setState('empty', {
                helper: 'Ask an admin to approve storefront slots.'
            });
            return true;
        }
        
        // Group services by category
        const grouped = {};
        Object.keys(serviceDetailsMap).forEach((key) => delete serviceDetailsMap[key]);

    approvedServices.forEach(service => {
            const serviceKey = assignServiceKey(service);
            serviceDetailsMap[serviceKey] = service;
            const category = (service.category || 'Other').toLowerCase();
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push(service);
        });
        
        // Generate HTML for each category
        let html = '';
        const categoryIcons = {
            'instagram': '📱',
            'tiktok': '🎵',
            'youtube': '▶️',
            'twitter': '🐦',
            'facebook': '👥',
            'telegram': '💬',
            'spotify': '🎧',
            'soundcloud': '🎶',
            'other': '⭐'
        };
        
        Object.keys(grouped).sort().forEach(category => {
            const icon = categoryIcons[category] || '⭐';
            const categoryServices = grouped[category];
            const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
            
            html += `
                <div class="service-category" data-category="${category}" id="${category}">
                    <h2 class="category-title">${icon} ${categoryName} Services</h2>
                    
                    <div class="service-subcategory">
                        <div class="services-table">
                            <div class="service-row service-row-header">
                                <div class="service-col">Service Name</div>
                                <div class="service-col">Rate (per 1000)</div>
                                <div class="service-col">Min/Max</div>
                                <div class="service-col">Action</div>
                            </div>
            `;
            
            categoryServices.forEach(service => {
                const serviceKey = assignServiceKey(service);
                const rate = parseFloat(service.rate || 0);
                const currency = (service.currency || 'USD').toUpperCase();
                const pricePerK = formatCurrencyValue(rate, currency);
                const minRaw = service.min_quantity ?? service.min_order;
                const maxRaw = service.max_quantity ?? service.max_order;
                const min = Number.isFinite(Number(minRaw)) ? Number(minRaw) : 10;
                const max = maxRaw === null || maxRaw === undefined
                    ? Infinity
                    : (Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : 10000);
                const rawPublicId = service.public_id ?? service.publicId;
                const publicIdValue = (rawPublicId === null || rawPublicId === undefined || rawPublicId === '')
                    ? null
                    : Number(rawPublicId);
                const labelId = Number.isFinite(publicIdValue)
                    ? `#${publicIdValue}`
                    : 'ID Pending';
                const panelOrderLabel = Number.isFinite(publicIdValue)
                    ? `Panel ID: #${publicIdValue}`
                    : 'Panel ID: Pending';
                const providerOrderRaw = service.provider_order_id ?? service.provider_service_id;
                const providerOrderLabel = providerOrderRaw && String(providerOrderRaw).trim().length > 0
                    ? `Provider Ref: ${escapeHtml(String(providerOrderRaw).trim())}`
                    : 'Provider Ref: Pending';
                // Provider names are hidden from customers - only admins see them
                const avgTimeBadge = service.average_time
                    ? `<span class="service-meta-tag" title="Average completion time">${escapeHtml(service.average_time)}</span>`
                    : '';
                const currencyBadge = `<span class="service-meta-tag service-meta-tag--muted" title="Billing currency">${currency}</span>`;
                const capabilityBadges = renderSupportBadges(service);
                const metaRows = [];
                const primaryTags = [currencyBadge];
                if (avgTimeBadge) {
                    primaryTags.unshift(avgTimeBadge);
                }
                metaRows.push(`<div class="service-meta-row">${primaryTags.join('')}</div>`);
                if (capabilityBadges) {
                    metaRows.push(`<div class="service-meta-row service-meta-row--compact">${capabilityBadges}</div>`);
                }
                // No provider badge for customers - white-label experience
                const serviceMetaMarkup = metaRows.join('');
                
                html += `
                    <div class="service-row" data-service-id="${service.id}">
                        <div class="service-col">
                            <strong>${labelId} · ${escapeHtml(service.name)}</strong>
                            <div class="service-id-meta">
                                <span class="service-id-chip">${panelOrderLabel}</span>
                                <span class="service-id-chip service-id-chip--secondary">${providerOrderLabel}</span>
                            </div>
                            <span class="service-details">${escapeHtml(service.description || 'No description available')}</span>
                            ${serviceMetaMarkup}
                        </div>
                        <div class="service-col price">${pricePerK}<span class="price-note">per 1K</span></div>
                        <div class="service-col">${formatNumber(min)} / ${formatNumber(max)}</div>
                        <div class="service-col">
                            <button class="btn btn-primary btn-sm" data-service-key="${escapeHtml(service.__clientKey)}" onclick="showServiceDescription(this.dataset.serviceKey)">Details</button>
                        </div>
                    </div>
                `;
            });
            
            html += `
                        </div>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        console.log('[SUCCESS] Services loaded and displayed');
        servicesStatusController?.setState('success', {
            helper: `${approvedServices.length} curated services are ready.`
        });
        
        // Return true to signal completion
        return true;
        
    } catch (error) {
        console.error('[ERROR] Failed to load services:', error);

        if (error.message && error.message.toLowerCase().includes('unauthorized')) {
            container.innerHTML = `
                <div style="text-align: center; padding: 80px 20px;">
                    <div style="font-size: 80px; margin-bottom: 20px;">🔒</div>
                    <h3 style="color: #1E293B; margin-bottom: 12px; font-size: 24px;">Sign in required</h3>
                    <p style="color: #64748B; font-size: 16px; margin-bottom: 20px;">Please sign in to view available services.</p>
                    <a href="signin.html" class="btn btn-primary">Go to Sign In</a>
                </div>
            `;
            return false;
        }

        container.innerHTML = `
            <div style="text-align: center; padding: 80px 20px;">
                <div style="font-size: 80px; margin-bottom: 20px;">⚠️</div>
                <h3 style="color: #DC2626; margin-bottom: 12px; font-size: 24px;">Failed to Load Services</h3>
                <p style="color: #64748B; font-size: 16px; margin-bottom: 20px;">${error.message}</p>
                <button onclick="location.reload()" class="btn btn-primary">Retry</button>
            </div>
        `;
        servicesStatusController?.setState('error', {
            helper: error.message || 'Unable to fetch curated services.'
        });
        
        // Return false to signal error
        return false;
    }
}

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

const CURRENCY_SYMBOL_MAP = {
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
    IDR: 'Rp',
    PHP: '₱'
};

function assignServiceKey(service) {
    if (!service || typeof service !== 'object') {
        return Math.random().toString(36).slice(2, 10);
    }

    if (service.__clientKey) {
        return service.__clientKey;
    }

    const fallback = Math.random().toString(36).slice(2, 10);
    const candidate = service.id ?? service.provider_service_id ?? service.provider_order_id ?? service.public_id ?? fallback;
    const key = String(candidate);

    Object.defineProperty(service, '__clientKey', {
        value: key,
        enumerable: false,
        configurable: true
    });

    return key;
}

function formatCurrencyValue(amount, currency = 'USD', fractionDigits = 2) {
    const numeric = Number(amount);
    const normalizedCurrency = currency ? String(currency).toUpperCase().slice(0, 10) : 'USD';
    if (!Number.isFinite(numeric)) {
        return `-- ${normalizedCurrency}`;
    }

    const customSymbol = CURRENCY_SYMBOL_MAP[normalizedCurrency];
    const symbol = customSymbol || `${normalizedCurrency} `;
    const ambiguousSymbols = new Set(['C$', 'A$', 'S$']);
    const needsCode = !customSymbol || ambiguousSymbols.has(symbol);
    const formatted = `${symbol}${numeric.toFixed(fractionDigits)}`;
    return needsCode ? `${formatted} ${normalizedCurrency}` : formatted;
}

const SERVICE_CAPABILITY_FIELDS = [
    { key: 'refill_supported', label: 'Refill' },
    { key: 'cancel_supported', label: 'Cancel' },
    { key: 'dripfeed_supported', label: 'Dripfeed' },
    { key: 'subscription_supported', label: 'Subscription' }
];

function renderSupportBadges(service, options = {}) {
    const { showDisabled = false, fallbackLabel = '' } = options;
    if (!service || typeof service !== 'object') {
        return fallbackLabel;
    }

    const badges = SERVICE_CAPABILITY_FIELDS
        .map(({ key, label }) => {
            const enabled = Boolean(service[key]);
            if (!enabled && !showDisabled) {
                return '';
            }
            const stateClass = enabled ? 'service-capability--on' : 'service-capability--off';
            return `<span class="service-meta-tag service-capability ${stateClass}" title="${label} ${enabled ? 'supported' : 'not supported'}">${label}</span>`;
        })
        .filter(Boolean);

    if (badges.length === 0 && fallbackLabel) {
        return fallbackLabel;
    }

    return badges.join('');
}

// ==========================================
// Show Service Description Modal
// ==========================================

function showServiceDescription(serviceKey) {
    const service = serviceDetailsMap[serviceKey];
    if (!service) {
        console.warn('[SERVICES] Unable to locate service details for key', serviceKey);
        return;
    }

    const rawPublicId = service.public_id ?? service.publicId;
    const publicIdValue = (rawPublicId === null || rawPublicId === undefined || rawPublicId === '')
        ? null
        : Number(rawPublicId);
    const labelId = Number.isFinite(publicIdValue) ? `#${publicIdValue}` : 'ID Pending';
    
    // Enhanced fallback pattern for provider identifiers (consistent with admin-orders.js)
    const providerOrderRaw = service.provider_order_id 
        ?? service.providerOrderId 
        ?? service.provider_service_id 
        ?? service.providerServiceId 
        ?? service.meta?.provider_order_id 
        ?? service.meta?.providerOrderId;
    
    const providerOrderLabel = providerOrderRaw && String(providerOrderRaw).trim().length > 0
        ? `Provider Ref: ${escapeHtml(String(providerOrderRaw).trim())}`
        : 'Provider Ref: Pending';
    const description = escapeHtml(service.description || 'No description available');
    const currency = (service.currency || 'USD').toUpperCase();
    const priceLabel = formatCurrencyValue(service.rate, currency);
    const minRaw = service.min_quantity ?? service.min_order;
    const maxRaw = service.max_quantity ?? service.max_order;
    const min = formatNumber(Number.isFinite(Number(minRaw)) ? Number(minRaw) : 10);
    const maxValue = maxRaw === null || maxRaw === undefined ? Infinity : Number(maxRaw);
    const max = formatNumber(Number.isFinite(maxValue) ? maxValue : Infinity);
    const averageTime = service.average_time ? escapeHtml(service.average_time) : 'Not provided';
    const providerName = escapeHtml(service.provider?.name || 'Unknown Provider');
    const providerStatus = service.provider?.status ? escapeHtml(service.provider.status) : 'unknown';
    const providerMarkup = Number.isFinite(Number(service.provider?.markup))
        ? `${Number(service.provider.markup).toFixed(1)}%`
        : '—';
    const capabilityBadges = renderSupportBadges(service, { showDisabled: true, fallbackLabel: '<span class="service-meta-tag service-capability service-capability--off">No automation flags reported</span>' });
    const providerMetadataRaw = service.provider_metadata;
    const providerMetadataBlock = providerMetadataRaw
        ? `<div style="margin-top: 20px;"><h4 style="margin: 0 0 8px; font-size: 14px; color: #475569;">Provider Metadata</h4><pre style="max-height: 280px; overflow: auto; background: #0F172A; color: #E2E8F0; padding: 16px; border-radius: 12px; font-size: 12px;">${escapeHtml(JSON.stringify(providerMetadataRaw, null, 2))}</pre></div>`
        : '';
    const serviceRecordId = service.id ?? service.provider_service_id ?? serviceKey;
    const orderLinkParam = encodeURIComponent(serviceRecordId);

    const modalHTML = `
        <div id="serviceDescriptionModal" class="modal" style="display: flex !important; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; backdrop-filter: blur(4px);">
            <div class="modal-content" style="background: white; border-radius: 16px; padding: 32px; max-width: 720px; width: 92%; box-shadow: 0 20px 60px rgba(0,0,0,0.35); animation: modalSlideIn 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 24px;">
                    <div>
                        <p style="margin: 0; color: #94A3B8; font-size: 0.85rem;">${labelId} · ${providerOrderLabel}</p>
                        <h2 style="color: #0F172A; margin: 4px 0 0; font-size: 26px; font-weight: 700;">${escapeHtml(service.name)}</h2>
                    </div>
                    <button onclick="closeServiceDescription()" style="background: none; border: none; font-size: 28px; color: #64748B; cursor: pointer; padding: 0; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 10px; transition: all 0.2s;" onmouseover="this.style.background='#F1F5F9'; this.style.color='#1E293B'" onmouseout="this.style.background='none'; this.style.color='#64748B'">&times;</button>
                </div>

                <div style="background: linear-gradient(120deg, #FF1494 0%, #FF6B35 100%); padding: 24px; border-radius: 16px; margin-bottom: 24px; color: white;">
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; text-align: center;">
                        <div>
                            <div style="opacity: 0.8; font-size: 0.8rem;">Rate per 1000</div>
                            <div style="font-size: 1.6rem; font-weight: 700;">${priceLabel}</div>
                        </div>
                        <div>
                            <div style="opacity: 0.8; font-size: 0.8rem;">Minimum</div>
                            <div style="font-size: 1.6rem; font-weight: 700;">${min}</div>
                        </div>
                        <div>
                            <div style="opacity: 0.8; font-size: 0.8rem;">Maximum</div>
                            <div style="font-size: 1.6rem; font-weight: 700;">${max}</div>
                        </div>
                        <div>
                            <div style="opacity: 0.8; font-size: 0.8rem;">Average Time</div>
                            <div style="font-size: 1.3rem; font-weight: 600;">${averageTime}</div>
                        </div>
                    </div>
                </div>

                <div style="margin-bottom: 24px;">
                    <h3 style="color: #1E293B; font-size: 16px; font-weight: 600; margin-bottom: 12px;">Service Description</h3>
                    <p style="color: #475569; line-height: 1.65; margin: 0; white-space: pre-wrap;">${description}</p>
                </div>

                <div style="margin-bottom: 24px;">
                    <h3 style="color: #1E293B; font-size: 16px; font-weight: 600; margin-bottom: 12px;">Automation & Support</h3>
                    <div class="service-meta-row service-meta-row--wrap">${capabilityBadges}</div>
                </div>

                <div style="background: #F8FAFC; border-radius: 16px; padding: 20px; margin-bottom: 24px;">
                    <h3 style="color: #0F172A; font-size: 16px; font-weight: 600; margin-bottom: 12px;">Provider Details</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px;">
                        <div>
                            <p style="margin: 0; font-size: 0.8rem; color: #94A3B8;">Name</p>
                            <p style="margin: 4px 0 0; font-weight: 600; color: #0F172A;">${providerName}</p>
                        </div>
                        <div>
                            <p style="margin: 0; font-size: 0.8rem; color: #94A3B8;">Status</p>
                            <p style="margin: 4px 0 0; font-weight: 600; color: #0F172A; text-transform: capitalize;">${providerStatus}</p>
                        </div>
                        <div>
                            <p style="margin: 0; font-size: 0.8rem; color: #94A3B8;">Markup</p>
                            <p style="margin: 4px 0 0; font-weight: 600; color: #0F172A;">${providerMarkup}</p>
                        </div>
                    </div>
                    ${providerMetadataBlock}
                </div>

                <div style="display: flex; flex-wrap: wrap; gap: 12px;">
                    <a href="order.html?service=${orderLinkParam}" class="btn btn-primary" style="flex: 1; text-align: center; padding: 12px; font-size: 16px; font-weight: 600; text-decoration: none; display: block;">Order Now</a>
                    <button onclick="closeServiceDescription()" class="btn btn-secondary" style="padding: 12px 24px; font-size: 16px; font-weight: 600;">Close</button>
                </div>
            </div>
        </div>
        
        <style>
            @keyframes modalSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(-20px) scale(0.95);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
        </style>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    document.body.style.overflow = 'hidden';

    const modalEl = document.querySelector('#serviceDescriptionModal');
    modalEl.addEventListener('click', function(e) {
        if (e.target.id === 'serviceDescriptionModal') {
            closeServiceDescription();
        }
    });

    document.addEventListener('keydown', function escapeHandler(e) {
        if (e.key === 'Escape') {
            closeServiceDescription();
            document.removeEventListener('keydown', escapeHandler);
        }
    });
}

function closeServiceDescription() {
    const modal = document.querySelector('#serviceDescriptionModal');
    if (modal) {
        modal.style.animation = 'modalSlideOut 0.2s ease';
        setTimeout(() => {
            modal.remove();
            document.body.style.overflow = '';
        }, 200);
    }
}

(function registerServicesFetchGuardHooks() {
    if (typeof window === 'undefined') {
        return;
    }

    function isServicesEndpoint(endpoint) {
        return typeof endpoint === 'string' && endpoint.includes('/.netlify/functions/services');
    }

    window.addEventListener('fetchguard:network-status', (event) => {
        const isOnline = event?.detail?.online !== false;
        servicesNetworkController?.setStatus?.(isOnline);
    });

    window.addEventListener('fetchguard:retry', (event) => {
        if (!isServicesEndpoint(event?.detail?.endpoint)) {
            return;
        }
        servicesStatusController?.setState('retrying', {
            helper: 'We are retrying the services API automatically.'
        });
    });

    window.addEventListener('fetchguard:circuit-open', (event) => {
        if (!isServicesEndpoint(event?.detail?.endpoint)) {
            return;
        }
        servicesStatusController?.setState('error', {
            helper: 'The API is cooling down; retry in a few seconds.'
        });
    });

    window.addEventListener('fetchguard:failure', (event) => {
        if (!isServicesEndpoint(event?.detail?.endpoint)) {
            return;
        }
        servicesStatusController?.setState('error', {
            helper: event?.detail?.error?.message || 'Unable to fetch curated services.'
        });
    });
})();

// Add modal slide out animation
const modalStyle = document.createElement('style');
modalStyle.textContent = `
    @keyframes modalSlideOut {
        from {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
        to {
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
        }
    }
`;
document.head.appendChild(modalStyle);
