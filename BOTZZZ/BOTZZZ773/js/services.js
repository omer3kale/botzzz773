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
    const token = resolveAuthToken('load-services');
    authToken = token;
    
    try {
        // Show loading state
        container.innerHTML = '<div class="loading-spinner" style="text-align: center; padding: 60px;"><div style="display: inline-block; width: 50px; height: 50px; border: 4px solid rgba(255,20,148,0.2); border-top-color: #FF1494; border-radius: 50%; animation: spin 1s linear infinite;"></div><p style="margin-top: 20px; color: #94A3B8;">Loading services...</p></div>';
        servicesStatusController?.setState(isRetry ? 'retrying' : 'loading');
        
        const headers = {
            'Content-Type': 'application/json'
        };

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        const endpoint = token
            ? '/.netlify/functions/services?audience=customer'
            : '/api?action=services';

        const response = await fetch(endpoint, {
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
            servicesStatusController?.setState('error');
            handleMissingAuth('services-response-unauthorized');
            return false;
        }

        if (!response.ok) {
            throw new Error(data.error || 'Failed to load services');
        }

        const services = Array.isArray(data.services) ? data.services : Array.isArray(data) ? data : [];
        
        // For public/unauthenticated users, show all active services (no admin approval filter)
        // For authenticated users, still filter by admin_approved
        const approvedServices = token 
            ? services.filter(service => service.admin_approved === true || service.adminApproved === true)
            : services; // Show all services to public users
            
        approvedServicesCache = approvedServices;
        console.log('[DEBUG] Loaded services:', services.length, 'approved:', approvedServices.length, 'auth:', !!token);
        
        if (approvedServices.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 80px 20px;">
                    <div style="font-size: 80px; margin-bottom: 20px;">📦</div>
                    <h3 style="color: #1E293B; margin-bottom: 12px; font-size: 24px;">No Services Available</h3>
                    <p style="color: #64748B; font-size: 16px;">Services will appear once an admin approves them for customers.</p>
                </div>
            `;
            servicesStatusController?.setState('empty');
            return true;
        }
        
        // Group services by category
        const grouped = groupServicesByCategory(approvedServices);
        Object.keys(serviceDetailsMap).forEach((key) => delete serviceDetailsMap[key]);
        approvedServices.forEach(service => {
            const serviceKey = assignServiceKey(service);
            serviceDetailsMap[serviceKey] = service;
        });

        const html = await buildGroupedServicesHtml(grouped);
        container.innerHTML = html;
        fullServicesHTMLCache = html;
        console.log('[SUCCESS] Services loaded and displayed');
        servicesStatusController?.setState('success');
        
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
    const serviceHeading = Number.isFinite(publicIdValue)
        ? `#${publicIdValue} · ${escapeHtml(service.name)}`
        : escapeHtml(service.name);
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
    const serviceMetaMarkup = metaRows.join('');

    return `
        <div class="service-row" data-service-id="${service.id}">
            <div class="service-col">
                <strong>${serviceHeading}</strong>
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
    
    
    const description = escapeHtml(service.description || 'No description available');
    const currency = (service.currency || 'USD').toUpperCase();
    const priceLabel = formatCurrencyValue(service.rate, currency);
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
        <div id="serviceDescriptionModal" class="modal" style="display: flex !important; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; backdrop-filter: blur(4px);">
            <div class="modal-content" style="background: white; border-radius: 16px; padding: 32px; max-width: 720px; width: 92%; box-shadow: 0 20px 60px rgba(0,0,0,0.35); animation: modalSlideIn 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: start; gap: 16px; margin-bottom: 24px;">
                    <div>
                        <p style="margin: 0; color: #94A3B8; font-size: 0.85rem;">${labelId}</p>
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
    
    /* Subcategory Modal Styles */
    .subcategory-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        animation: fadeIn 0.2s ease-out;
    }
    
    .subcategory-modal-content {
        background: white;
        border-radius: 12px;
        padding: 0;
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow: hidden;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
        animation: slideIn 0.3s ease-out;
    }
    
    .subcategory-header {
        padding: 20px 24px;
        border-bottom: 1px solid #e5e7eb;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: linear-gradient(135deg, #ff1494, #ff6b6b);
        color: white;
    }
    
    .subcategory-header h3 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
    }
    
    .close-subcategory {
        background: none;
        border: none;
        font-size: 24px;
        color: white;
        cursor: pointer;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        transition: background-color 0.2s;
    }
    
    .close-subcategory:hover {
        background-color: rgba(255, 255, 255, 0.2);
    }
    
    .subcategory-options {
        padding: 20px;
        display: grid;
        gap: 12px;
        max-height: 60vh;
        overflow-y: auto;
    }
    
    .subcategory-btn {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: #f8fafc;
        border: 2px solid #e2e8f0;
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.2s;
        font-size: 14px;
        font-weight: 500;
        text-align: left;
        color: #374151;
    }
    
    .subcategory-btn:hover {
        background: #eff6ff;
        border-color: #3b82f6;
        color: #1d4ed8;
        transform: translateY(-1px);
    }
    
    .subcategory-btn[data-type="parent"] {
        background: linear-gradient(135deg, #ff1494, #ff6b6b);
        color: white;
        border-color: transparent;
    }
    
    .subcategory-btn[data-type="parent"]:hover {
        background: linear-gradient(135deg, #e11d48, #ef4444);
        transform: translateY(-1px);
    }
    
    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    
    @keyframes slideIn {
        from { 
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
        }
        to { 
            opacity: 1;
            transform: translateY(0) scale(1);
        }
    }

    .services-filter-context {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 20px;
        padding: 16px;
        border: 1px solid #e2e8f0;
        border-radius: 12px;
        background: #1e0613;
    }

    .services-filter-label {
        font-weight: 600;
        color: #ffffff;
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
                    <h3><i class="${parentCategory.icon}" style="color: #e91e63; margin-right: 8px;"></i>${parentCategory.name} Categories</h3>
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
    console.debug('[SERVICES] Auth check skipped (public mode).', { reason });
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
