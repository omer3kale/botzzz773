// ==========================================
// Services Page JavaScript
// ==========================================

let filterButtons;
let authToken = null;
const serviceDetailsMap = {};
let servicesStatusController = null;
let servicesNetworkController = null;
let categoriesCache = null;
let approvedServicesCache = [];
let fullServicesHTMLCache = '';
let activeFilterContext = null;
let isPopupMode = false;
let authGuardTriggered = false;
let userDiscountRate = 0; // User's discount percentage (0-100)
let userServiceDiscounts = {}; // User-specific per-service discounts: { serviceId: discountRate }
const PER_SERVICE_DISCOUNTS = { 9071: 10 }; // Global per-service discount overrides

async function refreshUserProfile(token) {
    if (!token) return null;
    try {
        const res = await fetch('/.netlify/functions/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'verify', token })
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.user) {
            localStorage.setItem('user', JSON.stringify(data.user));
            return data.user;
        }
    } catch (err) {
        console.warn('[SERVICES] Failed to refresh user profile', err);
    }
    return null;
}

const AUTH_ALERT_MESSAGE = 'You must be signed in to view services. Please sign in or create an account.';

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
        empty: {
            showRetry: true
        },
        error: {
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
            labelEl.textContent = isOnline ? 'Connection stable' : 'Offline - retrying';
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

document.addEventListener('DOMContentLoaded', function() {
    const hasServicesContainer = Boolean(document.getElementById('servicesContainer'));
    // On pages without services container (e.g., index), only load categories/cards and skip auth lookups
    if (!hasServicesContainer) {
        initializeCategoryLoading();
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    isPopupMode = urlParams.get('popup') === '1';
    if (isPopupMode) {
        enablePopupSurface();
    }

    const token = resolveAuthToken('initial-load');
    if (token) {
        authToken = token;
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

    // Initialize dynamic category loading for public pages
    initializeCategoryLoading();
});

// Initialize filter buttons
function initializeFilters() {
    filterButtons = document.querySelectorAll('[data-filter]');

    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            const filter = this.dataset.filter;
            const serviceCategories = document.querySelectorAll('.service-category');

            // Update active button
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');

            // Filter categories
            serviceCategories.forEach(category => {
                if (filter === 'all') {
                    category.style.display = 'block';
                } else {
                    const categoryName = category.dataset.category;
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

function enablePopupSurface() {
    document.body.classList.add('popup-mode');
    const panel = document.querySelector('[data-popup-surface]');
    if (panel) {
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Services window');
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

// Load Services from API
async function loadServicesFromAPI(options = {}) {
    const container = document.getElementById('servicesContainer');
    if (!container) {
        console.warn('[SERVICES] Container element not found.');
        return false;
    }

    const headers = {
        'Content-Type': 'application/json'
    };

    try {
        // Prefer full services payload from Netlify Function (includes description + slots)
        // Fallback to public v2 if function is not available
        let response = await fetch('/.netlify/functions/services', {
            method: 'GET',
            headers
        }).catch(() => null);

        if (!response || !response.ok) {
            response = await fetch('/v2?action=services', {
                method: 'GET',
                headers
            });
        }

        const rawBody = await response.text();
        let data;
        try {
            data = rawBody ? JSON.parse(rawBody) : {};
        } catch (parseError) {
            console.error('[SERVICES] Failed to parse services response:', parseError, rawBody);
            throw new Error('Received invalid response while loading services');
        }

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load services');
        }

        // Handle both array response (from /v2) and object response (function)
        let services = Array.isArray(data) ? data : (Array.isArray(data.services) ? data.services : []);

        // Normalize to internal shape while preserving description and slots when available
        services = services.map(service => {
            const rateVal = service.rate ?? service.price;
            const minVal = service.min_quantity ?? service.min_order ?? service.min;
            const maxVal = service.max_quantity ?? service.max_order ?? service.max;
            const publicId = service.public_id ?? service.publicId ?? service.service ?? service.id;
            return {
                id: service.id ?? service.service ?? publicId,
                public_id: publicId,
                name: service.name,
                category: service.category,
                type: service.type || 'Default',
                rate: parseFloat(rateVal),
                min_quantity: parseInt(minVal ?? 1),
                max_quantity: parseInt(maxVal ?? 10000),
                description: service.description || '',
                customer_portal_slot: service.customer_portal_slot ?? service.customerPortalSlot ?? null,
                refill: (service.refill_supported ?? service.refill) !== false,
                cancel: (service.cancel_supported ?? service.cancel) !== false,
                dripfeed: Boolean(service.dripfeed_supported ?? service.dripfeed ?? false),
                currency: service.currency || 'USD',
                __clientKey: `service_${publicId}`
            };
        });

        // Load user's discount rate and service-specific discounts if authenticated
        try {
            const userData = JSON.parse(localStorage.getItem('user') || '{}');
            const discount = Number(userData?.discount_rate ?? 0);
            if (Number.isFinite(discount) && discount >= 0 && discount <= 100) {
                userDiscountRate = discount;
            }
            // Load user-specific service discounts
            if (userData.service_discounts && typeof userData.service_discounts === 'object') {
                userServiceDiscounts = userData.service_discounts;
            }
        } catch (err) {
            // Ignore discount lookup failures silently
        }

        // Show all services - no authentication or approval filtering for public view
        approvedServicesCache = services;

        if (services.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 80px 20px;">
                    <div style="font-size: 80px; margin-bottom: 20px;">📦</div>
                    <h3 style="color: #1E293B; margin-bottom: 12px; font-size: 24px;">No Services Available</h3>
                    <p style="color: #64748B; font-size: 16px;">Check back soon for new services.</p>
                </div>
            `;
            servicesStatusController?.setState('empty');
            return true;
        }

        // Group services by category
        const grouped = groupServicesByCategory(services);
        Object.keys(serviceDetailsMap).forEach((key) => delete serviceDetailsMap[key]);
        services.forEach(service => {
            const serviceKey = assignServiceKey(service);
            serviceDetailsMap[serviceKey] = service;
        });

        const html = await buildGroupedServicesHtml(grouped);
        container.innerHTML = html;
        fullServicesHTMLCache = html;
        servicesStatusController?.setState('success');

        // Setup real-time listeners for service updates
        setupServicesRealTimeListener();

        // Return true to signal completion
        return true;
    } catch (error) {
        console.error('[ERROR] Failed to load services:', error);

        container.innerHTML = `
            <div style="text-align: center; padding: 80px 20px;">
                <div style="font-size: 80px; margin-bottom: 20px;">⚠️</div>
                <h3 style="color: #DC2626; margin-bottom: 12px; font-size: 24px;">Failed to Load Services</h3>
                <p style="color: #64748B; font-size: 16px; margin-bottom: 20px;">${error.message}</p>
                <button onclick="location.reload()" class="btn btn-primary">Retry</button>
            </div>
        `;
        servicesStatusController?.setState('error');

        // Return false to signal error
        return false;
    }
}

function groupServicesByCategory(services = []) {
    return services.reduce((acc, service) => {
        const category = (service.category || 'other').toLowerCase();
        if (!acc[category]) {
            acc[category] = [];
        }
        acc[category].push(service);
        return acc;
    }, {});
}

// Build hierarchical structure with parent and child categories
async function buildHierarchicalCategoryStructure(groupedServices = {}) {
    const categoriesData = categoriesCache || await loadCategoriesFromAPI();
    const parentCategories = categoriesData?.hierarchical || categoriesData?.flat || [];
    const childCategories = categoriesData?.children || [];
    
    // Create a map of slug -> category for quick lookup
    const categoryMap = {};
    [...parentCategories, ...childCategories].forEach(cat => {
        const slug = normalizeCategorySlug(cat.slug || cat.name);
        categoryMap[slug] = cat;
    });
    
    // Build parent-child structure
    const hierarchy = [];
    const processedSlugs = new Set();
    
    // First, process parent categories in order
    parentCategories.forEach(parent => {
        const parentSlug = normalizeCategorySlug(parent.slug || parent.name);
        const parentServices = groupedServices[parentSlug] || [];
        
        // Find children for this parent
        const children = childCategories
            .filter(child => child.parent_id === parent.id)
            .map(child => {
                const childSlug = normalizeCategorySlug(child.slug || child.name);
                processedSlugs.add(childSlug);
                return {
                    ...child,
                    slug: childSlug,
                    services: groupedServices[childSlug] || []
                };
            })
            .filter(child => child.services.length > 0);
        
        // Only include parent if it has services or children with services
        if (parentServices.length > 0 || children.length > 0) {
            processedSlugs.add(parentSlug);
            hierarchy.push({
                ...parent,
                slug: parentSlug,
                services: parentServices,
                children: children
            });
        }
    });
    
    // Add any orphan categories (services with categories not in the system)
    Object.keys(groupedServices).forEach(slug => {
        if (!processedSlugs.has(slug)) {
            hierarchy.push({
                name: formatCategoryLabel(slug),
                slug: slug,
                icon: 'fas fa-folder',
                services: groupedServices[slug],
                children: []
            });
        }
    });
    
    return hierarchy;
}

async function buildGroupedServicesHtml(groupedServices = {}) {
    const categoryIcons = await getCategoryIconsMap();
    const hierarchy = await buildHierarchicalCategoryStructure(groupedServices);
    
    return hierarchy.map(parent => {
        const parentSlug = parent.slug;
        const parentIconClass = categoryIcons[parentSlug] || 'fas fa-star';
        const parentTitle = `${formatCategoryLabel(parent.name || parentSlug)} Services`;
        
        let html = '';
        
        // Build parent section with its direct services
        if (parent.services.length > 0) {
            html += buildCategorySectionHtml({
                slug: parentSlug,
                icon: parentIconClass,
                title: parentTitle,
                services: sortServicesForDisplay(parent.services),
                isParent: true,
                hasChildren: parent.children.length > 0
            });
        } else if (parent.children.length > 0) {
            // Parent header without services
            html += `
                <div class="service-category service-category--parent" data-category="${parentSlug}" id="${parentSlug}">
                    <h2 class="category-title">${renderCategoryIcon(parentIconClass)} ${parentTitle}</h2>
                </div>
            `;
        }
        
        // Build child subcategories
        parent.children.forEach(child => {
            const childSlug = child.slug;
            const childIconClass = categoryIcons[childSlug] || 'fas fa-folder';
            const childTitle = formatCategoryLabel(child.name || childSlug);
            
            html += buildSubcategorySectionHtml({
                parentSlug: parentSlug,
                slug: childSlug,
                icon: childIconClass,
                title: childTitle,
                services: sortServicesForDisplay(child.services)
            });
        });
        
        return html;
    }).join('');
}

function buildSubcategorySectionHtml({ parentSlug, slug, icon, title, services }) {
    const rowsHtml = buildServiceRowsHtml(services);
    return `
        <div class="service-category service-category--child" data-category="${slug}" data-parent-category="${parentSlug}" id="${slug}">
            <h3 class="subcategory-title">${renderCategoryIcon(icon)} ${title}</h3>
            <div class="service-subcategory">
                <div class="services-table">
                    <div class="service-row service-row-header">
                        <div class="service-col">Service Name</div>
                        <div class="service-col">Rate (per 1000)</div>
                        <div class="service-col">Min/Max</div>
                        <div class="service-col">Description</div>
                        <div class="service-col">Action</div>
                    </div>
                    ${rowsHtml}
                </div>
            </div>
        </div>
    `;
}

function buildCategorySectionHtml({ slug, icon, title, services, isParent = false, hasChildren = false }) {
    const rowsHtml = buildServiceRowsHtml(services);
    const parentClass = isParent ? ' service-category--parent' : '';
    const childrenClass = hasChildren ? ' has-children' : '';
    return `
        <div class="service-category${parentClass}${childrenClass}" data-category="${slug}" id="${slug}">
            <h2 class="category-title">${renderCategoryIcon(icon)} ${title}</h2>
            <div class="service-subcategory">
                <div class="services-table">
                    <div class="service-row service-row-header">
                        <div class="service-col">Service Name</div>
                        <div class="service-col">Rate (per 1000)</div>
                        <div class="service-col">Min/Max</div>
                        <div class="service-col">Description</div>
                        <div class="service-col">Action</div>
                    </div>
                    ${rowsHtml}
                </div>
            </div>
        </div>
    `;
}

function buildServiceRowsHtml(services = []) {
    return services.map(service => buildServiceRowMarkup(service)).join('');
}

function buildServiceRowMarkup(service) {
    const serviceKey = assignServiceKey(service);
    const rate = parseFloat(service.rate || 0);
    const currency = (service.currency || 'USD').toUpperCase();

    // Determine effective discount: user-service specific → global-service → user-global
    const rawPublicId = service.public_id ?? service.publicId;
    const publicIdValue = (rawPublicId === null || rawPublicId === undefined || rawPublicId === '') ? null : Number(rawPublicId);
    
    let effectiveDiscount = 0;
    if (publicIdValue && userServiceDiscounts[publicIdValue] !== undefined && userServiceDiscounts[publicIdValue] !== null) {
        const val = Number(userServiceDiscounts[publicIdValue]);
        if (Number.isFinite(val) && val >= 0 && val <= 100) {
            effectiveDiscount = val;
        }
    } else if (publicIdValue && Object.prototype.hasOwnProperty.call(PER_SERVICE_DISCOUNTS, publicIdValue)) {
        const val = Number(PER_SERVICE_DISCOUNTS[publicIdValue]);
        if (Number.isFinite(val) && val >= 0 && val <= 100) {
            effectiveDiscount = val;
        }
    } else if (userDiscountRate > 0 && userDiscountRate <= 100) {
        effectiveDiscount = userDiscountRate;
    }

    // Apply discount if any
    let finalRate = rate;
    let discountMarkup = '';
    if (effectiveDiscount > 0) {
        const discountAmount = rate * (effectiveDiscount / 100);
        finalRate = rate - discountAmount;
        discountMarkup = `<span class="price-discount" style="text-decoration: line-through; opacity: 0.6; font-size: 0.85em; margin-right: 6px;">${formatCurrencyValue(rate, currency)}</span>`;
    }

    const pricePerK = formatCurrencyValue(finalRate, currency);
    const minRaw = service.min_quantity ?? service.min_order;
    const maxRaw = service.max_quantity ?? service.max_order;
    const min = Number.isFinite(Number(minRaw)) ? Number(minRaw) : 10;
    const max = maxRaw === null || maxRaw === undefined
        ? Infinity
        : (Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : 10000);
    const serviceHeading = Number.isFinite(publicIdValue)
        ? `${publicIdValue} · ${escapeHtml(service.name)}`
        : escapeHtml(service.name);
    const avgTimeBadge = service.average_time
        ? `<span class="service-meta-tag" title="Average completion time">${escapeHtml(service.average_time)}</span>`
        : '';
    const currencyBadge = `<span class="service-meta-tag service-meta-tag--muted" title="Billing currency">${currency}</span>`;
    const capabilityBadges = renderSupportBadges(service);
    const metaRows = [];
    const primaryTags = [];
    if (avgTimeBadge) {
        primaryTags.unshift(avgTimeBadge);
    }
    metaRows.push(`<div class="service-meta-row">${primaryTags.join('')}</div>`);
    if (capabilityBadges) {
        metaRows.push(`<div class="service-meta-row service-meta-row--compact">${capabilityBadges}</div>`);
    }
    const serviceMetaMarkup = metaRows.join('');

    return `
        <div class="service-row" data-service-id="${service.id}">
            <div class="service-col">
                <strong>${serviceHeading}</strong>
                ${serviceMetaMarkup}
            </div>
            <div class="service-col price">${discountMarkup}${pricePerK}</div>
            <div class="service-col">${formatNumber(min)} / ${formatNumber(max)}</div>
            <div class="service-col">${service.description ? escapeHtml(service.description) : ''}</div>
            <div class="service-col">
                <button class="btn btn-primary btn-sm" data-service-key="${escapeHtml(service.__clientKey)}" onclick="showServiceDescription(this.dataset.serviceKey)">Details</button>
            </div>
        </div>
    `;
}

function sortServicesForDisplay(services = []) {
    return services.slice().sort((a, b) => {
        const slotA = Number(a?.customer_portal_slot ?? a?.customerPortalSlot);
        const slotB = Number(b?.customer_portal_slot ?? b?.customerPortalSlot);

        const hasSlotA = Number.isFinite(slotA);
        const hasSlotB = Number.isFinite(slotB);

        if (hasSlotA && hasSlotB && slotA !== slotB) {
            return slotA - slotB;
        }
        if (hasSlotA && !hasSlotB) return -1;
        if (!hasSlotA && hasSlotB) return 1;

        const nameA = String(a?.name || '').toLowerCase();
        const nameB = String(b?.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
    });
}

function formatCategoryLabel(slug = '') {
    return slug
        .split('-')
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ') || 'Other';
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

    const numeric = Number(num);
    if (!Number.isFinite(numeric)) {
        return '∞';
    }

    return numeric.toLocaleString();
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

function determineFractionDigits(numeric, fallback = 2) {
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    const absValue = Math.abs(numeric);
    if (absValue === 0) {
        return fallback;
    }
    if (absValue < 0.0001) return 6;
    if (absValue < 0.001) return 5;
    if (absValue < 0.01) return 4;
    if (absValue < 0.1) return 3;
    if (absValue < 1) return 3;
    return fallback;
}

function formatCurrencyValue(amount, currency = 'USD', fractionDigits) {
    const numeric = Number(amount);
    const normalizedCurrency = currency ? String(currency).toUpperCase().slice(0, 10) : 'USD';
    if (!Number.isFinite(numeric)) {
        return `-- ${normalizedCurrency}`;
    }

    const digits = typeof fractionDigits === 'number'
        ? fractionDigits
        : determineFractionDigits(numeric, 2);

    const customSymbol = CURRENCY_SYMBOL_MAP[normalizedCurrency];
    const symbol = customSymbol || `${normalizedCurrency} `;
    const ambiguousSymbols = new Set(['C$', 'A$', 'S$']);
    const needsCode = !customSymbol || ambiguousSymbols.has(symbol);
    const formatted = `${symbol}${numeric.toFixed(digits)}`;
    return needsCode ? `${formatted} ${normalizedCurrency}` : formatted;
}

const SERVICE_CAPABILITY_FIELDS = [
    { key: 'refill', label: 'Refill' },
    { key: 'cancel', label: 'Cancel' },
    { key: 'dripfeed', label: 'Dripfeed' },
    { key: 'subscription', label: 'Subscription' }
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

    // Send Google Analytics event for service view
    if (typeof gtag !== 'undefined') {
        gtag('event', 'view_item', {
            'items': [{
                'item_id': service.public_id ?? service.publicId ?? serviceKey,
                'item_name': service.name || 'Unknown Service',
                'item_category': service.category || 'Services',
                'price': service.rate,
                'currency': (service.currency || 'USD').toUpperCase()
            }]
        });
    }

    // Send Facebook Pixel event for service view
    if (typeof fbq !== 'undefined') {
        fbq('track', 'ViewContent', {
            content_name: service.name || 'Unknown Service',
            content_type: 'product',
            content_id: service.public_id ?? service.publicId ?? serviceKey,
            value: service.rate,
            currency: (service.currency || 'USD').toUpperCase()
        });
    }

    const rawPublicId = service.public_id ?? service.publicId;
    const publicIdValue = (rawPublicId === null || rawPublicId === undefined || rawPublicId === '')
        ? null
        : Number(rawPublicId);
    const labelId = Number.isFinite(publicIdValue) ? `#${publicIdValue}` : 'ID Pending';
    
    
    const description = escapeHtml(service.description || 'No description available');
    const currency = (service.currency || 'USD').toUpperCase();
    
    // Apply discount in modal: user-service specific → global-service → user-global
    let finalRate = service.rate;
    let priceDiscountMarkup = '';
    
    let effectiveDiscount = 0;
    if (publicIdValue && userServiceDiscounts[publicIdValue] !== undefined && userServiceDiscounts[publicIdValue] !== null) {
        const val = Number(userServiceDiscounts[publicIdValue]);
        if (Number.isFinite(val) && val >= 0 && val <= 100) {
            effectiveDiscount = val;
        }
    } else if (publicIdValue && Object.prototype.hasOwnProperty.call(PER_SERVICE_DISCOUNTS, publicIdValue)) {
        const val = Number(PER_SERVICE_DISCOUNTS[publicIdValue]);
        if (Number.isFinite(val) && val >= 0 && val <= 100) {
            effectiveDiscount = val;
        }
    } else if (userDiscountRate > 0 && userDiscountRate <= 100) {
        effectiveDiscount = userDiscountRate;
    }
    
    if (effectiveDiscount > 0) {
        const discountAmount = service.rate * (effectiveDiscount / 100);
        finalRate = service.rate - discountAmount;
            priceDiscountMarkup = `<div class="service-modal-price-original">${formatCurrencyValue(service.rate, currency)}</div>`;
    }
    
    const priceLabel = formatCurrencyValue(finalRate, currency);
    const minRaw = service.min_quantity ?? service.min_order;
    const maxRaw = service.max_quantity ?? service.max_order;
    const min = formatNumber(Number.isFinite(Number(minRaw)) ? Number(minRaw) : 10);
    const maxValue = maxRaw === null || maxRaw === undefined ? Infinity : Number(maxRaw);
    const max = formatNumber(Number.isFinite(maxValue) ? maxValue : Infinity);
    const averageTime = service.average_time ? escapeHtml(service.average_time) : 'Not provided';
    const capabilityBadges = renderSupportBadges(service, { showDisabled: true, fallbackLabel: '<span class="service-meta-tag service-capability service-capability--off">No automation flags reported</span>' });
    const serviceRecordId = service.id ?? service.provider_service_id ?? serviceKey;
    const orderLinkParam = encodeURIComponent(serviceRecordId);

        const modalHTML = `
            <div id="serviceDescriptionModal" class="service-modal">
                <div class="service-modal-content">
                    <div class="service-modal-header">
                        <div>
                            <p class="service-modal-id">${labelId}</p>
                            <h2 class="service-modal-title">${escapeHtml(service.name)}</h2>
                        </div>
                        <button type="button" class="service-modal-close" onclick="closeServiceDescription()" aria-label="Close">&times;</button>
                    </div>

                    <div class="service-modal-metrics">
                        <div class="service-modal-metric-grid">
                            <div class="service-modal-metric">
                                <div class="service-modal-label">Rate per 1000</div>
                                ${priceDiscountMarkup}
                                <div class="service-modal-value">${priceLabel}</div>
                            </div>
                            <div class="service-modal-metric">
                                <div class="service-modal-label">Minimum</div>
                                <div class="service-modal-value">${min}</div>
                            </div>
                            <div class="service-modal-metric">
                                <div class="service-modal-label">Maximum</div>
                                <div class="service-modal-value">${max}</div>
                            </div>
                            <div class="service-modal-metric">
                                <div class="service-modal-label">Average Time</div>
                                <div class="service-modal-value service-modal-value--sm">${averageTime}</div>
                            </div>
                        </div>
                    </div>

                    <div class="service-modal-section">
                        <h3 class="service-modal-section-title">Service Description</h3>
                        <p class="service-modal-description">${description}</p>
                    </div>

                    <div class="service-modal-section">
                        <h3 class="service-modal-section-title">Automation & Support</h3>
                        <div class="service-meta-row service-meta-row--wrap">${capabilityBadges}</div>
                    </div>

                    <div class="service-modal-actions">
                        <a href="order.html?service=${orderLinkParam}" class="btn btn-primary">Order Now</a>
                        <button type="button" onclick="closeServiceDescription()" class="btn btn-secondary">Close</button>
                    </div>
                </div>
            </div>
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
        servicesStatusController?.setState('retrying');
    });

    window.addEventListener('fetchguard:circuit-open', (event) => {
        if (!isServicesEndpoint(event?.detail?.endpoint)) {
            return;
        }
        servicesStatusController?.setState('error');
    });

    window.addEventListener('fetchguard:failure', (event) => {
        if (!isServicesEndpoint(event?.detail?.endpoint)) {
            return;
        }
        servicesStatusController?.setState('error');
    });
})();

// Add loading styles for categories
const categoryLoadingStyle = document.createElement('style');
categoryLoadingStyle.textContent = `
    .loading-categories, .loading-categories-home {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 20px;
        color: var(--text-secondary, #6b7280);
        font-size: 14px;
    }
    
    .loading-categories i, .loading-categories-home i {
        color: var(--primary, #ff1494);
    }
    
    .loading-categories {
        min-height: 50px;
    }
    
    .loading-categories-home {
        min-height: 200px;
        grid-column: 1 / -1;
    }
`;
document.head.appendChild(categoryLoadingStyle);

// ==========================================
// Dynamic Category Loading Functions
// ==========================================

async function loadCategoriesFromAPI() {
    try {
        const response = await fetch('/.netlify/functions/services?type=categories');
        const data = await response.json();
        
        if (data.success && Array.isArray(data.categories)) {
            const sortedCategories = data.categories.sort((a, b) => (a.display_order || 1) - (b.display_order || 1));
            
            // Organize into hierarchical structure
            const parentCategories = sortedCategories.filter(cat => !cat.parent_id);
            const childCategories = sortedCategories.filter(cat => cat.parent_id);
            
            // Add children to their parents
            parentCategories.forEach(parent => {
                parent.subcategories = childCategories.filter(child => child.parent_id === parent.id);
            });
            
            categoriesCache = { 
                flat: sortedCategories, 
                hierarchical: parentCategories,
                children: childCategories
            };
            return categoriesCache;
        }
        
        // Fallback to default categories if API fails
        const defaults = getDefaultCategories();
        categoriesCache = defaults;
        return defaults;
    } catch (error) {
        console.warn('Failed to load categories from API, using defaults:', error);
        const defaults = getDefaultCategories();
        categoriesCache = defaults;
        return defaults;
    }
}

function getDefaultCategories() {
    const defaultParents = [
        { name: 'Instagram', slug: 'instagram', icon: 'fab fa-instagram', description: 'Followers, Likes, Views, Comments & More', subcategories: [] },
        { name: 'TikTok', slug: 'tiktok', icon: 'fab fa-tiktok', description: 'Followers, Likes, Views, Shares & More', subcategories: [] },
        { name: 'YouTube', slug: 'youtube', icon: 'fab fa-youtube', description: 'Views, Subscribers, Likes, Comments & More', subcategories: [] },
        { name: 'Twitter', slug: 'twitter', icon: 'fab fa-twitter', description: 'Followers, Likes, Retweets, Views & More', subcategories: [] },
        { name: 'Facebook', slug: 'facebook', icon: 'fab fa-facebook', description: 'Likes, Followers, Views, Shares & More', subcategories: [] },
        { name: 'Telegram', slug: 'telegram', icon: 'fab fa-telegram', description: 'Members, Views, Reactions & More', subcategories: [] }
    ];
    
    return {
        flat: defaultParents,
        hierarchical: defaultParents,
        children: []
    };
}

function normalizeCategorySlug(value) {
    if (value === undefined || value === null) {
        return '';
    }

    const slug = String(value)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    return slug;
}

function getCategoryCollections() {
    const parents = categoriesCache?.hierarchical || categoriesCache?.flat || [];
    const children = categoriesCache?.children || [];
    return { parents, children };
}

function findCategoryBySlug(slug) {
    const normalizedSlug = normalizeCategorySlug(slug);
    if (!normalizedSlug) {
        return null;
    }

    const { parents, children } = getCategoryCollections();
    const combined = [...parents, ...children];
    return combined.find(cat => normalizeCategorySlug(cat.slug || cat.name) === normalizedSlug) || null;
}

function resolveParentCategory(category) {
    if (!category) {
        return null;
    }

    if (!category.parent_id) {
        return category;
    }

    const { parents } = getCategoryCollections();
    return parents.find(parent => parent.id === category.parent_id) || null;
}

function collectChildSlugSet(parentCategory) {
    const slugs = new Set();
    if (!parentCategory) {
        return slugs;
    }

    const directChildren = Array.isArray(parentCategory.subcategories) && parentCategory.subcategories.length
        ? parentCategory.subcategories
        : (categoriesCache?.children || []).filter(child => child.parent_id === parentCategory.id);

    directChildren.forEach(child => {
        const slug = normalizeCategorySlug(child.slug || child.name);
        if (slug) {
            slugs.add(slug);
        }
    });

    return slugs;
}

function getServiceCategorySlug(service) {
    const rawValue = service?.category_slug
        || service?.categorySlug
        || service?.category
        || '';
    return normalizeCategorySlug(rawValue);
}

// Create category icons mapping for services display
async function getCategoryIconsMap() {
    const categoriesData = categoriesCache || await loadCategoriesFromAPI();
    const allCategories = categoriesData.flat || categoriesData;
    const iconMap = {};
    
    allCategories.forEach(category => {
        const slug = category.slug || category.name.toLowerCase().replace(/\s+/g, '-');
        // Store the actual Font Awesome icon class from category management
        iconMap[slug] = category.icon || 'fas fa-folder';
    });
    
    // Add fallback for 'other' category
    iconMap['other'] = 'fas fa-star';
    
    return iconMap;
}

// Helper to render icon - handles both FA classes and emojis
function renderCategoryIcon(iconValue) {
    if (!iconValue) return '<i class="fas fa-star"></i>';
    // If it's a Font Awesome class
    if (iconValue.startsWith('fa')) {
        return `<i class="${iconValue}"></i>`;
    }
    // If it's an emoji or other text
    return iconValue;
}

// Load category filter buttons for services page
async function loadCategoryFilters() {
    const container = document.getElementById('categoryFilterButtons');
    if (!container) return;
    
    try {
        const categoriesData = await loadCategoriesFromAPI();
        const parentCategories = categoriesData.hierarchical || categoriesData;
        
        let buttonsHTML = `
            <button class="filter-btn filter-btn--all active" data-filter="all">
                <i class="fas fa-th"></i> All Services
            </button>
        `;
        
        parentCategories.forEach(category => {
            const iconClass = category.icon || 'fas fa-folder';
            const slug = category.slug || category.name.toLowerCase().replace(/\s+/g, '-');
            const subcategoryCount = category.subcategories ? category.subcategories.length : 0;
            const countText = subcategoryCount > 0 ? ` (${subcategoryCount})` : '';
            
            buttonsHTML += `
                <button class="filter-btn filter-btn--${slug}" data-filter="${slug}" data-has-subcategories="${subcategoryCount > 0}">
                    <i class="${iconClass}"></i> ${category.name}${countText}
                </button>
            `;
        });
        
        container.innerHTML = buttonsHTML;
        
        // Re-initialize filter functionality
        initializeFilterButtons();
        
    } catch (error) {
        console.error('Error loading category filters:', error);
        // Keep loading state if error occurs
    }
}

// Load category cards for index page
async function loadCategoryCards() {
    const container = document.getElementById('categoryCardsContainer');
    if (!container) return;
    
    try {
        const categoriesData = await loadCategoriesFromAPI();
        const parentCategories = categoriesData.hierarchical || categoriesData;
        
        let cardsHTML = '';
        parentCategories.forEach(category => {
            const iconClass = category.icon || 'fas fa-folder';
            const slug = category.slug || category.name.toLowerCase().replace(/\s+/g, '-');
            const description = category.description || `${category.name} services and more`;
            const subcategoryCount = category.subcategories ? category.subcategories.length : 0;
            const serviceCountText = subcategoryCount > 0 ? ` (${subcategoryCount} categories)` : '';
            
            cardsHTML += `
                <div class="service-card">
                    <div class="service-icon">
                        <i class="${iconClass}"></i>
                    </div>
                    <h3 class="service-title">${category.name}${serviceCountText}</h3>
                    <p class="service-desc">${description}</p>
                    <a href="services.html#${slug}" class="btn btn-primary">View Services</a>
                </div>
            `;
        });
        
        container.innerHTML = cardsHTML;
        
    } catch (error) {
        console.error('Error loading category cards:', error);
        // Fallback to default categories in case of error
        const defaultCategories = getDefaultCategories();
        let cardsHTML = '';
        defaultCategories.forEach(category => {
            cardsHTML += `
                <div class="service-card">
                    <div class="service-icon">
                        <i class="${category.icon}"></i>
                    </div>
                    <h3 class="service-title">${category.name}</h3>
                    <p class="service-desc">${category.description}</p>
                    <a href="services.html#${category.slug}" class="btn btn-primary">View Services</a>
                </div>
            `;
        });
        container.innerHTML = cardsHTML;
    }
}

// Initialize filter buttons functionality
function initializeFilterButtons() {
    filterButtons = document.querySelectorAll('.filter-btn');
    
    filterButtons.forEach(btn => {
        btn.addEventListener('click', async function() {
            // Remove active class from all buttons
            filterButtons.forEach(b => b.classList.remove('active'));
            // Add active class to clicked button
            this.classList.add('active');
            
            const filter = this.dataset.filter;
            const hasSubcategories = this.dataset.hasSubcategories === 'true';
            
            if (hasSubcategories && categoriesCache) {
                // Show subcategories for this parent category
                showSubcategoryOptions(filter);
            } else {
                await filterServices(filter);
            }
        });
    });
}

// Show subcategory selection modal
function showSubcategoryOptions(parentSlug) {
    const categoriesData = categoriesCache;
    if (!categoriesData || !categoriesData.hierarchical) return;
    
    const parentCategory = categoriesData.hierarchical.find(cat => cat.slug === parentSlug);
    if (!parentCategory || !parentCategory.subcategories) return;
    
    const subcategories = parentCategory.subcategories;
    
    // Create subcategory selection modal with black design palette
    let modalHTML = `
        <div class="subcategory-modal" id="subcategoryModal">
            <div class="subcategory-modal-overlay" onclick="closeSubcategoryModal()"></div>
            <div class="subcategory-modal-content">
                <div class="subcategory-header">
                    <h3><i class="${parentCategory.icon} subcategory-header-icon"></i>${parentCategory.name} Categories</h3>
                    <button class="close-subcategory" onclick="closeSubcategoryModal()">&times;</button>
                </div>
                <div class="subcategory-options">
                    <button class="subcategory-btn subcategory-btn--all" data-filter="${parentSlug}" data-type="parent">
                        <i class="fas fa-th"></i> All ${parentCategory.name} Services
                    </button>
    `;
    
    subcategories.forEach(sub => {
        const iconClass = sub.icon || 'fas fa-folder';
        modalHTML += `
            <button class="subcategory-btn" data-filter="${sub.slug}" data-type="subcategory" data-category-id="${sub.id}">
                <i class="${iconClass}"></i> ${sub.name}
            </button>
        `;
    });
    
    modalHTML += `
                </div>
            </div>
        </div>
    `;
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Add smooth animation
    setTimeout(() => {
        const modal = document.getElementById('subcategoryModal');
        if (modal) modal.classList.add('show');
    }, 10);
    
    // Add event listeners
    document.querySelectorAll('.subcategory-btn').forEach(btn => {
        btn.addEventListener('click', async function() {
            const filter = this.dataset.filter;
            const categoryId = this.dataset.categoryId;
            const type = this.dataset.type;
            
            // Update active button styling
            document.querySelectorAll('.subcategory-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            // Filter and load services for this subcategory
            if (type === 'subcategory' && categoryId) {
                await loadServicesForSubcategory(categoryId, filter);
            } else {
                await filterServices(filter);
            }
            
            // Close modal after selection
            setTimeout(() => closeSubcategoryModal(), 300);
        });
    });
}

// Close subcategory modal with animation
function closeSubcategoryModal() {
    const modal = document.getElementById('subcategoryModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => {
            if (modal.parentNode) {
                modal.remove();
            }
        }, 300);
    }
}

async function filterServices(filterSlug) {
    const normalizedSlug = normalizeCategorySlug(filterSlug) || 'all';
    if (normalizedSlug === 'all') {
        await resetFiltersToAll();
        return;
    }

    if (!approvedServicesCache.length) {
        const loaded = await loadServicesFromAPI();
        if (!loaded) {
            return;
        }
    }

    if (!categoriesCache) {
        categoriesCache = await loadCategoriesFromAPI();
    }

    const selectedCategory = findCategoryBySlug(normalizedSlug);
    const parentCategory = selectedCategory?.parent_id
        ? resolveParentCategory(selectedCategory)
        : selectedCategory;

    const slugsToMatch = new Set([normalizedSlug]);
    const parentSlug = normalizeCategorySlug(parentCategory?.slug || parentCategory?.name);
    if (parentSlug) {
        slugsToMatch.add(parentSlug);
    }

    collectChildSlugSet(parentCategory).forEach(slug => slugsToMatch.add(slug));

    let filteredServices = approvedServicesCache.filter(service => {
        const serviceSlug = getServiceCategorySlug(service);
        return serviceSlug && slugsToMatch.has(serviceSlug);
    });

    if (filteredServices.length === 0) {
        const fallbackTerms = normalizedSlug.split('-').filter(Boolean);
        filteredServices = approvedServicesCache.filter(service => {
            const serviceName = String(service.name || '').toLowerCase();
            const serviceCategory = (service.category || '').toLowerCase();
            return fallbackTerms.some(term =>
                serviceName.includes(term) || serviceCategory.includes(term)
            );
        });
    }

    await displayFilteredServices(filteredServices, {
        slug: normalizedSlug,
        label: parentCategory?.name || formatCategoryLabel(normalizedSlug),
        parentSlug: parentSlug || normalizedSlug
    });

    const currentUrl = new URL(window.location);
    currentUrl.searchParams.set('category', normalizedSlug);
    window.history.pushState({}, '', currentUrl);
}

async function displayFilteredServices(services, options = {}) {
    const container = document.getElementById('servicesContainer');
    if (!container) return;

    const label = options.label || formatCategoryLabel(options.slug || 'filtered');
    const suffix = options.subcategoryLabel ? ` · ${options.subcategoryLabel}` : '';
    const headline = `${label}${suffix}`;
    const categoryIcons = await getCategoryIconsMap();
    const iconClass = options.icon || categoryIcons[options.parentSlug || options.slug] || 'fas fa-star';

    activeFilterContext = {
        slug: options.slug,
        label,
        subcategoryLabel: options.subcategoryLabel || ''
    };

    if (!Array.isArray(services) || services.length === 0) {
        container.innerHTML = `
            ${buildFilterContextBar(`No services found for ${headline}`)}
            <div class="no-services-message">
                <i class="fas fa-search"></i>
                <h3>No services found</h3>
                <p>Try selecting a different category or reset the filters.</p>
            </div>
        `;
        attachResetFiltersHandler(container);
        return;
    }

    const rowsHtml = buildServiceRowsHtml(sortServicesForDisplay(services));
    container.innerHTML = `
        ${buildFilterContextBar(`Showing ${headline}`)}
        <div class="service-category service-category--filtered" data-category="${options.slug || 'filtered'}">
            <h2 class="category-title">${renderCategoryIcon(iconClass)} ${headline}</h2>
            <div class="service-subcategory">
                <div class="services-table">
                    <div class="service-row service-row-header">
                        <div class="service-col">Service Name</div>
                        <div class="service-col">Rate (per 1000)</div>
                        <div class="service-col">Min/Max</div>
                        <div class="service-col">Description</div>
                        <div class="service-col">Action</div>
                    </div>
                    ${rowsHtml}
                </div>
            </div>
        </div>
    `;

    attachResetFiltersHandler(container);
}

function buildFilterContextBar(labelText) {
    return `
        <div class="services-filter-context">
            <button type="button" class="btn btn-secondary btn-sm" data-reset-filters>
                <i class="fas fa-arrow-left"></i> View All Services
            </button>
            <span class="services-filter-label">${labelText}</span>
        </div>
    `;
}

function attachResetFiltersHandler(scope) {
    const resetBtn = scope.querySelector('[data-reset-filters]');
    if (resetBtn) {
        resetBtn.addEventListener('click', async () => {
            await resetFiltersToAll();
        });
    }
}

async function resetFiltersToAll() {
    activeFilterContext = null;
    await restoreFullServicesView();
    closeSubcategoryModal();

    if (filterButtons?.length) {
        filterButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === 'all');
        });
    }

    const currentUrl = new URL(window.location);
    currentUrl.searchParams.delete('category');
    window.history.pushState({}, '', currentUrl);
}

async function restoreFullServicesView() {
    const container = document.getElementById('servicesContainer');
    if (!container) return;

    if (fullServicesHTMLCache) {
        container.innerHTML = fullServicesHTMLCache;
        servicesStatusController?.setState('success');
        return;
    }

    await loadServicesFromAPI();
}

function buildSubcategorySearchTerms(name = '') {
    const normalized = String(name || '').toLowerCase();
    if (!normalized) {
        return [];
    }

    const terms = new Set(normalized.split(/[^a-z0-9]+/).filter(Boolean));

    if (normalized.includes('followers')) terms.add('follower');
    if (normalized.includes('likes')) terms.add('like');
    if (normalized.includes('views')) terms.add('view');
    if (normalized.includes('comments')) terms.add('comment');
    if (normalized.includes('shares')) terms.add('share');

    return Array.from(terms);
}

// Load services for a specific subcategory
async function loadServicesForSubcategory(categoryId, categorySlug) {
    servicesStatusController?.setState('loading');

    try {
        if (!approvedServicesCache.length) {
            const loaded = await loadServicesFromAPI();
            if (!loaded) {
                servicesStatusController?.setState('error');
                return;
            }
        }

        if (!categoriesCache) {
            categoriesCache = await loadCategoriesFromAPI();
        }

        const normalizedSlug = normalizeCategorySlug(categorySlug);
        const { parents, children } = getCategoryCollections();
        const allCategories = [...parents, ...children];

        let selectedCategory = allCategories.find(cat => {
            if (categoryId && Number(cat.id) === Number(categoryId)) {
                return true;
            }
            return normalizeCategorySlug(cat.slug || cat.name) === normalizedSlug;
        }) || null;

        if (!selectedCategory && normalizedSlug) {
            selectedCategory = findCategoryBySlug(normalizedSlug);
        }

        let parentCategory = selectedCategory
            ? (selectedCategory.parent_id ? resolveParentCategory(selectedCategory) : selectedCategory)
            : findCategoryBySlug(normalizedSlug);

        const parentSlug = normalizeCategorySlug(parentCategory?.slug || parentCategory?.name || normalizedSlug);
        const targetSlug = normalizeCategorySlug(selectedCategory?.slug || selectedCategory?.name || normalizedSlug);
        const slugTargets = new Set([parentSlug, targetSlug].filter(Boolean));
        const subcategoryTerms = buildSubcategorySearchTerms(selectedCategory?.name || categorySlug);

        let filteredServices = approvedServicesCache.filter(service => {
            const serviceSlug = getServiceCategorySlug(service);
            if (!serviceSlug) {
                return false;
            }

            if (slugTargets.has(serviceSlug)) {
                if (selectedCategory?.parent_id && serviceSlug === parentSlug && subcategoryTerms.length) {
                    const serviceName = String(service.name || '').toLowerCase();
                    return subcategoryTerms.some(term => serviceName.includes(term));
                }
                return true;
            }

            return false;
        });

        if (filteredServices.length === 0 && subcategoryTerms.length) {
            filteredServices = approvedServicesCache.filter(service => {
                const serviceSlug = getServiceCategorySlug(service);
                const serviceName = String(service.name || '').toLowerCase();
                const belongsToParent = parentSlug ? serviceSlug === parentSlug : true;
                return belongsToParent && subcategoryTerms.some(term => serviceName.includes(term));
            });
        }

        if (filteredServices.length === 0) {
            const fallbackTerms = (categorySlug || '').replace(/-/g, ' ').toLowerCase().split(' ').filter(Boolean);
            filteredServices = approvedServicesCache.filter(service => {
                const serviceName = String(service.name || '').toLowerCase();
                const serviceCategory = (service.category || '').toLowerCase();
                return fallbackTerms.some(term =>
                    serviceName.includes(term) || serviceCategory.includes(term)
                );
            });
        }

        await displayFilteredServices(filteredServices, {
            slug: targetSlug || parentSlug || normalizedSlug,
            label: parentCategory?.name || formatCategoryLabel(targetSlug || parentSlug || normalizedSlug),
            subcategoryLabel: selectedCategory && selectedCategory.parent_id ? selectedCategory.name : '',
            parentSlug: parentSlug || normalizedSlug
        });

        const currentUrl = new URL(window.location);
        currentUrl.searchParams.set('category', categorySlug);
        window.history.pushState({}, '', currentUrl);

        servicesStatusController?.setState('success');
    } catch (error) {
        console.error('Error loading subcategory services:', error);
        servicesStatusController?.setState('error');
    }
}

// Check if we're on the index page or services page and load appropriate content
function initializeCategoryLoading() {
    // Load category cards for index page
    if (document.getElementById('categoryCardsContainer')) {
        loadCategoryCards();
    }
    
    // Load category filters for services page
    if (document.getElementById('categoryFilterButtons')) {
        loadCategoryFilters();
    }
}

function resolveAuthToken(reason) {
    const token = getAuthToken();
    return token;
}

function getAuthToken() {
    try {
        return localStorage.getItem('token');
    } catch (error) {
        console.warn('[SERVICES] Unable to read auth token from storage.', error);
        return null;
    }
}

function handleMissingAuth(reason) {
    // Fully disabled for public access - no alerts, no redirects
    void reason;
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
// ==========================================
// Real-Time Services Updates
// ==========================================

let servicesRealtimeListener = null;
const REALTIME_CHECK_INTERVAL = 5000; // Poll every 5 seconds for changes

/**
 * Setup real-time listener for service updates
 * Monitors for changes in customer_portal_slot and reloads if needed
 */
function setupServicesRealTimeListener() {
    if (servicesRealtimeListener) {
        return;
    }

    // Use Supabase real-time if available
    if (typeof supabase !== 'undefined' && supabase.realtime) {
        subscribeToServiceUpdates();
    } else {
        // Fallback to polling for changes
        startServicesPolling();
    }
}

/**
 * Subscribe to service updates via Supabase real-time
 */
function subscribeToServiceUpdates() {
    try {
        // Listen to services table for any updates
        const subscription = supabase
            .from('services')
            .on('UPDATE', (payload) => {
                const updatedService = payload.new;
                if (updatedService && updatedService.customer_portal_slot !== undefined) {
                    // Reload services to reflect new order
                    reloadServicesForReordering();
                }
            })
            .subscribe();

        servicesRealtimeListener = subscription;
    } catch (error) {
        console.warn('[REALTIME] Failed to subscribe to updates, falling back to polling:', error);
        startServicesPolling();
    }
}

/**
 * Poll for service changes periodically (fallback method)
 */
function startServicesPolling() {
    // Store initial slot state
    let previousSlotState = JSON.stringify(
        approvedServicesCache.map(s => ({ id: s.id, slot: s.customer_portal_slot }))
    );

    servicesRealtimeListener = setInterval(async () => {
        try {
            // Fetch current services from API
            const headers = { 'Content-Type': 'application/json' };
            let response = await fetch('/.netlify/functions/services', { headers }).catch(() => null);

            if (!response || !response.ok) {
                response = await fetch('/v2?action=services', { headers });
            }

            if (!response || !response.ok) return;

            const data = await response.json();
            let services = Array.isArray(data) ? data : (Array.isArray(data.services) ? data.services : []);

            // Compare slot states
            const currentSlotState = JSON.stringify(
                services.map(s => ({ id: s.id ?? s.public_id, slot: s.customer_portal_slot }))
            );

            if (currentSlotState !== previousSlotState) {
                previousSlotState = currentSlotState;
                reloadServicesForReordering();
            }
        } catch (error) {
            // Ignore transient polling errors silently
        }
    }, REALTIME_CHECK_INTERVAL);
}

/**
 * Reload services when reordering is detected
 */
async function reloadServicesForReordering() {
    // Show subtle notification
    showReorderingNotification();
    
    // Reload services (which will trigger UI update)
    await loadServicesFromAPI({ skipNotification: true });
}

/**
 * Show a subtle notification about service reordering
 */
function showReorderingNotification() {
    // Only show if there's an existing toast area
    const container = document.getElementById('servicesContainer');
    if (!container) return;

    // Create a subtle banner
    let banner = document.querySelector('[data-realtime-banner]');
    if (banner) return; // Already showing

    banner = document.createElement('div');
    banner.setAttribute('data-realtime-banner', 'true');
    banner.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border-radius: 6px;
        font-size: 13px;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        animation: slideInRight 0.3s ease-out;
    `;
    banner.textContent = '✓ Services order updated';
    
    document.body.appendChild(banner);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
        banner.style.animation = 'slideOutRight 0.3s ease-in';
        setTimeout(() => banner.remove(), 300);
    }, 3000);
}

/**
 * Cleanup real-time listener when page unloads
 */
window.addEventListener('beforeunload', () => {
    if (servicesRealtimeListener) {
        if (servicesRealtimeListener.unsubscribe) {
            servicesRealtimeListener.unsubscribe();
        } else if (typeof servicesRealtimeListener === 'number') {
            clearInterval(servicesRealtimeListener);
        }
    }
});