// Admin Services Management with Real Modals

if (typeof window !== 'undefined') {
    window.initializeAdminPopupSurface?.('Admin services window');
}

// Modal Helper Functions
function createModal(title, content, actions = '') {
    const modalHTML = `
        <div class="modal-overlay" id="activeModal" onclick="if(event.target === this) closeModal()">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3>${title}</h3>
                    <button class="modal-close" onclick="closeModal()">&times;</button>
                </div>
                <div class="modal-body">
                    ${content}
                </div>
                ${actions ? `<div class="modal-footer">${actions}</div>` : ''}
            </div>
        </div>
    `;
    
    const existing = document.querySelector('#activeModal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    setTimeout(() => document.querySelector('#activeModal')?.classList.add('show'), 10);
}

function closeModal() {
    const modal = document.querySelector('#activeModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// Provider utilities for form dropdowns
let providersCache = null;
let servicesCache = [];
let categoriesCache = {
    active: null,
    all: null
};
const selectedServiceIds = new Set();
const ADMIN_SERVICES_BASE_ENDPOINT = '/.netlify/functions/services';
// Unlimited curated services for customers
const CUSTOMER_PORTAL_MAX_SLOTS = null;
const HAS_PORTAL_SLOT_LIMIT = false; // Always unlimited
const PORTAL_SLOT_RANGE_LABEL = '1+';
const PORTAL_SLOT_LIMIT_MESSAGE = 'Feature unlimited curated services for customers.';
const PORTAL_SLOT_MAX_ATTR = HAS_PORTAL_SLOT_LIMIT ? `max="${CUSTOMER_PORTAL_MAX_SLOTS}"` : '';
const PORTAL_SLOT_SHORT_NOTE = HAS_PORTAL_SLOT_LIMIT
    ? `(max ${CUSTOMER_PORTAL_MAX_SLOTS} total)`
    : '(unlimited curated slots)';
function buildAdminServicesUrl(query = {}) {
    const params = new URLSearchParams({ audience: 'admin', ...query });
    const queryString = params.toString();
    return queryString
        ? `${ADMIN_SERVICES_BASE_ENDPOINT}?${queryString}`
        : ADMIN_SERVICES_BASE_ENDPOINT;
}
const currencySymbols = {
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

function getServiceById(serviceId) {
    if (!serviceId) {
        return undefined;
    }
    return servicesCache.find(service => String(service.id) === String(serviceId));
}

function getServiceDisplayName(service) {
    if (!service) {
        return '';
    }
    if (service.name) {
        return service.name;
    }
    if (service.id !== undefined && service.id !== null) {
        const idString = String(service.id);
        return idString.length > 8 ? `Service ${idString.substring(0, 8)}…` : `Service ${idString}`;
    }
    return 'Service';
}

// Expose cache invalidation globally
window.invalidateProvidersCache = function() {
    providersCache = null;
    console.log('[DEBUG] Providers cache invalidated');
};

function ensureCategoriesCacheShape() {
    if (!categoriesCache || typeof categoriesCache !== 'object') {
        categoriesCache = { active: null, all: null };
    }
}

window.invalidateCategoriesCache = function(scope = 'all') {
    ensureCategoriesCacheShape();
    if (scope === 'active') {
        categoriesCache.active = null;
    } else {
        categoriesCache.active = null;
        categoriesCache.all = null;
    }
    console.log(`[DEBUG] Categories cache invalidated (${scope})`);
};

async function fetchProvidersList(force = false) {
    if (!force && Array.isArray(providersCache)) {
        return providersCache;
    }

    const token = localStorage.getItem('token');
    if (!token) {
        providersCache = [];
        return providersCache;
    }

    try {
        const response = await fetch('/.netlify/functions/providers', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        providersCache = data.success ? (data.providers || []) : [];
        console.log(`[DEBUG] Fetched ${providersCache.length} providers`);
    } catch (error) {
        console.error('Fetch providers error:', error);
        providersCache = [];
    }

    return providersCache;
}

async function fetchCategoriesList(force = false, options = {}) {
    ensureCategoriesCacheShape();
    const includeInactive = Boolean(options.includeInactive);
    const cacheKey = includeInactive ? 'all' : 'active';

    if (!force && Array.isArray(categoriesCache[cacheKey])) {
        return categoriesCache[cacheKey];
    }

    const token = localStorage.getItem('token');
    if (!token) {
        categoriesCache[cacheKey] = [];
        return categoriesCache[cacheKey];
    }

    const queryParams = { type: 'categories' };
    if (includeInactive) {
        queryParams.status = 'all';
    }

    const url = buildAdminServicesUrl(queryParams);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        categoriesCache[cacheKey] = data.success ? (data.categories || []) : [];
        console.log(`[DEBUG] Fetched ${categoriesCache[cacheKey].length} ${includeInactive ? 'total' : 'active'} categories`);
    } catch (error) {
        console.error('Fetch categories error:', error);
        categoriesCache[cacheKey] = [];
    }

    return categoriesCache[cacheKey];
}

function getCachedCategories(includeInactive = false) {
    ensureCategoriesCacheShape();
    const cacheKey = includeInactive ? 'all' : 'active';
    const cached = categoriesCache[cacheKey];
    return Array.isArray(cached) ? cached : [];
}

function normalizeSlugInput(value) {
    return value ? String(value).trim().toLowerCase() : '';
}

function findCachedCategory(identifier) {
    if (!identifier) {
        return null;
    }

    const lookup = getCachedCategories(true);
    const normalizedId = String(identifier).trim();
    const normalizedSlug = normalizeSlugInput(identifier);

    return lookup.find(cat => {
        if (!cat) {
            return false;
        }

        if (cat.id && String(cat.id) === normalizedId) {
            return true;
        }

        if (cat.slug) {
            const catSlug = normalizeSlugInput(cat.slug);
            if (catSlug && (catSlug === normalizedSlug || catSlug === normalizedId.toLowerCase())) {
                return true;
            }
        }

        return false;
    }) || null;
}

function buildParentCategoryOptions(categories = [], selectedId = '', excludeId = '') {
    const safeSelected = selectedId ? String(selectedId) : '';
    const safeExclude = excludeId ? String(excludeId) : '';

    const dynamicOptions = categories
        .filter(category => !!category && String(category.id) !== safeExclude)
        .map(category => {
            const isSelected = String(category.id) === safeSelected;
            return `<option value="${category.id}"${isSelected ? ' selected' : ''}>${escapeHtml(category.name)}</option>`;
        })
        .join('');

    return `<option value="">None (Top Level)</option>${dynamicOptions}`;
}

function escapeHtml(text = '') {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Group services by parent/child category hierarchy
function groupServicesWithHierarchy(services = []) {
    const categories = categoriesCache?.all || categoriesCache?.active || [];
    const categoryMap = {};
    
    // Build category lookup map
    categories.forEach(cat => {
        const slug = (cat.slug || cat.name || '').toLowerCase().replace(/\s+/g, '-');
        categoryMap[slug] = cat;
    });
    
    // Sort services by category, then by name
    const sortedServices = [...services].sort((a, b) => {
        const catA = (a.category || 'other').toLowerCase();
        const catB = (b.category || 'other').toLowerCase();
        if (catA !== catB) return catA.localeCompare(catB);
        return (a.name || '').localeCompare(b.name || '');
    });
    
    // Build grouped structure
    return sortedServices.map(service => {
        const categorySlug = (service.category || 'other').toLowerCase();
        const categoryData = categoryMap[categorySlug] || {};
        const parentId = categoryData.parent_id;
        
        let parentCategory = null;
        let parentIcon = null;
        let childCategory = null;
        let childIcon = null;
        
        if (parentId) {
            // This is a child category
            const parent = categories.find(c => c.id === parentId);
            parentCategory = parent ? (parent.name || parent.slug) : null;
            parentIcon = parent?.icon || 'fas fa-folder';
            childCategory = categoryData.name || categorySlug;
            childIcon = categoryData.icon || 'fas fa-folder';
        } else {
            // This is a parent category or no hierarchy
            parentCategory = categoryData.name || categorySlug.charAt(0).toUpperCase() + categorySlug.slice(1);
            parentIcon = categoryData.icon || getCategoryIcon(categorySlug);
        }
        
        return {
            service,
            parentCategory,
            parentIcon,
            childCategory,
            childIcon
        };
    });
}

function getCategoryIcon(slug) {
    const iconMap = {
        'instagram': 'fab fa-instagram',
        'tiktok': 'fab fa-tiktok',
        'youtube': 'fab fa-youtube',
        'twitter': 'fab fa-twitter',
        'facebook': 'fab fa-facebook',
        'telegram': 'fab fa-telegram',
        'spotify': 'fab fa-spotify',
        'discord': 'fab fa-discord',
        'reddit': 'fab fa-reddit'
    };
    return iconMap[slug] || 'fas fa-folder';
}

function buildCategoryHeaderRow(categoryName, icon, isParent = true, parentName = null) {
    const iconClass = icon || 'fas fa-folder';
    const indentClass = isParent ? '' : 'category-header--child';
    const bgClass = isParent ? 'category-header--parent' : 'category-header--child';
    const label = isParent ? categoryName : `↳ ${categoryName}`;

    return `
        <tr class="category-header-row ${bgClass}" data-category="${escapeHtml(categoryName)}">
            <td colspan="8">
                <div class="category-header-content ${indentClass}">
                    <i class="${escapeHtml(iconClass)}"></i>
                    <span class="category-header-label">${escapeHtml(label)}</span>
                    ${!isParent && parentName ? `<span class="category-header-parent">(under ${escapeHtml(parentName)})</span>` : ''}
                </div>
            </td>
        </tr>
    `;
}

// Robustly parse API responses (handles JSON and plain text errors)
async function parseApiResponse(response) {
    try {
        const ct = response.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
            const json = await response.json();
            return json && typeof json === 'object' ? json : { success: response.ok, error: json };
        }
        const text = await response.text();
        return { success: response.ok, error: text };
    } catch (err) {
        console.error('parseApiResponse error:', err);
        return { success: response.ok, error: `HTTP ${response.status} ${response.statusText}` };
    }
}

function buildProviderOptions(providers, includePlaceholder = true) {
    const placeholder = includePlaceholder ? '<option value="">Select provider</option>' : '';
    const options = (providers || []).map(provider => {
            const statusLabel = provider.status ? ` (${provider.status})` : '';
            const healthWarning = provider.health_status === 'degraded' ? ' ⚠️ Unhealthy' : '';
            return `<option value="${provider.id}">${escapeHtml(provider.name)}${statusLabel}${healthWarning}</option>`;
    }).join('');
    return placeholder + (options || (includePlaceholder ? '' : '<option value="" disabled>No providers available</option>'));
}

function buildCategoryOptions(categories, includePlaceholder = true) {
    const placeholder = includePlaceholder ? '<option value="">Select Category</option>' : '';
    
    if (!Array.isArray(categories) || categories.length === 0) {
        // Fallback to default categories if none exist
        const defaultOptions = [
            '<option value="instagram">Instagram</option>',
            '<option value="tiktok">TikTok</option>',
            '<option value="youtube">YouTube</option>',
            '<option value="twitter">Twitter</option>',
            '<option value="facebook">Facebook</option>',
            '<option value="other">Other</option>'
        ].join('');
        return placeholder + defaultOptions;
    }
    
    const options = categories.map(category => {
                const slug = category.slug || category.name.toLowerCase().replace(/\s+/g, '-');
                if (category.child_category) {
                    options.setAttribute('data-child-category', String(category.child_category));
                }
        const serviceCount = category.service_count ? ` (${category.service_count})` : '';
        return `<option value="${escapeHtml(slug)}">${escapeHtml(category.name)}${serviceCount}</option>`;
    }).join('');
    return placeholder + options;
}

// Validate and suggest category based on service name
function suggestCategoryFromServiceName(serviceName, categories = []) {
    if (!serviceName) return null;
    
    const nameLower = serviceName.toLowerCase();
    const categoryKeywords = {
        'instagram': ['instagram', 'ig ', 'insta'],
        'tiktok': ['tiktok', 'tik tok', 'tt '],
        'youtube': ['youtube', 'yt ', 'subscriber'],
        'twitter': ['twitter', 'tweet', 'x.com'],
        'facebook': ['facebook', 'fb ', 'meta'],
        'telegram': ['telegram', 'tg '],
        'spotify': ['spotify'],
        'discord': ['discord'],
        'linkedin': ['linkedin'],
        'reddit': ['reddit'],
        'twitch': ['twitch']
    };
    
    // First check for exact category match
    for (const [slug, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(kw => nameLower.includes(kw))) {
            // Verify this category exists in our list
            const matchingCategory = categories.find(c => 
                (c.slug || '').toLowerCase() === slug || 
                (c.name || '').toLowerCase() === slug
            );
            if (matchingCategory) {
                return matchingCategory.slug || slug;
            }
            return slug; // Return suggested even if not in DB yet
        }
    }
    
    return null;
}

// Show category suggestion when entering service name
function setupCategorySuggestion(formId) {
    const form = document.getElementById(formId);
    if (!form) return;
    
    const nameInput = form.querySelector('input[name="serviceName"]');
    const categorySelect = form.querySelector('select[name="category"]');
    
    if (!nameInput || !categorySelect) return;
    
    let debounceTimer = null;
    
    nameInput.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(async () => {
            const categories = await fetchCategoriesList();
            const suggested = suggestCategoryFromServiceName(this.value, categories);
            
            if (suggested && categorySelect.value === '') {
                // Auto-select the suggested category
                const option = categorySelect.querySelector(`option[value="${suggested}"]`);
                if (option) {
                    categorySelect.value = suggested;
                    // Show a subtle notification
                    const hint = form.querySelector('.category-hint');
                    if (!hint) {
                        const hintEl = document.createElement('small');
                        hintEl.className = 'category-hint';
                        hintEl.style.cssText = 'color: #10b981; display: block; margin-top: 4px;';
                        hintEl.textContent = `Auto-selected "${option.textContent}" based on service name`;
                        categorySelect.parentNode.appendChild(hintEl);
                        setTimeout(() => hintEl.remove(), 3000);
                    }
                }
            }
        }, 500);
    });
}

function buildProviderOptionsWithSelected(providers, selectedId) {
    const placeholder = `<option value=""${selectedId ? '' : ' selected'}>No provider linked</option>`;
    const options = (providers || []).map(provider => {
        const isSelected = provider.id === selectedId;
        const statusLabel = provider.status ? ` (${provider.status})` : '';
        return `<option value="${provider.id}"${isSelected ? ' selected' : ''}>${escapeHtml(provider.name)}${statusLabel}</option>`;
    }).join('');
    return placeholder + options;
}

function toNumeric(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function formatRatePerThousand(value, currency = 'USD') {
    // Return only the currency + value without "per 1k" text
    const numeric = toNumeric(value);
    if (numeric === null) {
        return '—';
    }

    const normalizedCurrency = currency ? String(currency).toUpperCase().slice(0, 10) : 'USD';
    const symbol = currencySymbols[normalizedCurrency] || `${normalizedCurrency} `;
    const ambiguousSymbols = new Set(['C$', 'A$', 'S$']);
    const trimmed = formatTrimZeros(numeric, 4);
    const formatted = `${symbol}${trimmed}`;
    return (!currencySymbols[normalizedCurrency] || ambiguousSymbols.has(symbol))
        ? `${formatted} ${normalizedCurrency}`
        : formatted;
}

function formatQuantityValue(value) {
    if (value === undefined || value === null) {
        return '—';
    }

    if (value === 'Infinity') {
        return 'Unlimited';
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 'Unlimited';
    }

    return numeric.toLocaleString();
}

function parseNumberInput(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const trimmed = String(value).trim();
    if (trimmed === '') {
        return null;
    }
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return null;
    // DB numeric(10,4) max: 999999.9999
    if (Math.abs(numeric) > 999999) return null;
    return numeric;
}

function parseIntegerInput(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const trimmed = String(value).trim();
    if (trimmed === '') {
        return null;
    }
    const numeric = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(numeric)) return null;
    // PostgreSQL integer max: 2147483647
    if (Math.abs(numeric) > 2147483647) return null;
    return numeric;
}

function toBooleanInput(value) {
    if (value === undefined || value === null) {
        return false;
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value > 0;
    }
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
        return false;
    }
    return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
}

function normalizePortalSlotInput(value) {
    const numeric = parseIntegerInput(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    // Limit to reasonable slot range (1-9999)
    const bounded = Math.max(1, Math.min(numeric, 9999));
    return bounded;
}

function getCuratedServicesCount(excludeServiceId = null) {
    if (!Array.isArray(servicesCache) || servicesCache.length === 0) {
        return 0;
    }
    return servicesCache.filter(service => {
        if (!service) {
            return false;
        }
        if (excludeServiceId && String(service.id) === String(excludeServiceId)) {
            return false;
        }
        return Boolean(service.customer_portal_enabled);
    }).length;
}

function getNextAvailablePortalSlot(excludeServiceId = null) {
    if (!Array.isArray(servicesCache) || servicesCache.length === 0) {
        return 1;
    }

    const takenSlots = new Set(
        servicesCache
            .filter(service => {
                if (!service || !service.customer_portal_enabled) {
                    return false;
                }
                if (excludeServiceId && String(service.id) === String(excludeServiceId)) {
                    return false;
                }
                return Number.isFinite(toNumeric(service.customer_portal_slot));
            })
            .map(service => Number(toNumeric(service.customer_portal_slot)))
            .filter(slot => Number.isFinite(slot) && slot >= 1) // No upper limit
    );

    // Always unlimited slots now
    let slot = 1;
    while (takenSlots.has(slot)) {
        slot += 1;
    }
    return slot;
}

function getNextCategoryPortalSlot(categoryValue, excludeServiceId = null) {
    if (!categoryValue) {
        return 1;
    }

    const normalizedCategory = String(categoryValue).trim().toLowerCase();
    if (!normalizedCategory) {
        return 1;
    }

    let maxSlot = 0;
    if (Array.isArray(servicesCache) && servicesCache.length > 0) {
        servicesCache.forEach(service => {
            if (!service) return;
            if (excludeServiceId && String(service.id) === String(excludeServiceId)) return;
            const serviceCategory = String(service.category || '').trim().toLowerCase();
            if (serviceCategory !== normalizedCategory) return;
            const slot = toNumeric(service.customer_portal_slot);
            if (Number.isFinite(slot) && slot >= 1) {
                if (slot > maxSlot) maxSlot = slot;
            }
        });
    }

    return maxSlot + 1;
}

function formatTrimZeros(value, maxDecimals = 5) {
    if (!Number.isFinite(value)) return '';
    const fixed = Number(value).toFixed(maxDecimals);
    // Remove trailing zeros and optional trailing decimal point
    return fixed.replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function calculateMarkupPercent(providerRate, retailRate) {
    if (!Number.isFinite(providerRate) || !Number.isFinite(retailRate) || providerRate <= 0) {
        return null;
    }
    const markup = ((retailRate - providerRate) / providerRate) * 100;
    return Number.isFinite(markup) ? Number(markup.toFixed(5)) : null;
}

const serviceCapabilityFields = [
    { key: 'refill_supported', label: 'Refill' },
    { key: 'cancel_supported', label: 'Cancel' },
    { key: 'dripfeed_supported', label: 'Dripfeed' },
    { key: 'subscription_supported', label: 'Subscription' }
];

function buildCapabilityBadges(service, includeDisabled = true) {
    if (!service) {
        return '';
    }

    const badges = serviceCapabilityFields
        .map(({ key, label }) => {
            const enabled = Boolean(service[key]);
            if (!enabled && !includeDisabled) {
                return '';
            }
            const stateClass = enabled ? 'service-capability--on' : 'service-capability--off';
            return `<span class="service-meta-tag service-capability ${stateClass}" title="${label} ${enabled ? 'supported' : 'not supported'}">${label}</span>`;
        })
        .filter(Boolean);

    return badges.join('');
}

function formatNumberForInput(value, decimals = 4) {
    if (!Number.isFinite(value)) {
        return '';
    }
    return formatTrimZeros(Number(value), decimals);
}

function updateMarkupForForm(form, options = {}) {
    if (!form) return;
    const providerInput = form.querySelector('[name="providerRate"]');
    const retailInput = form.querySelector('[name="rate"]');
    const markupInput = form.querySelector('[name="markup"]');
    if (!markupInput) return;

    if (options.onlyIfEmpty) {
        const current = String(markupInput.value || '').trim();
        if (current !== '') {
            return;
        }
    }

    const providerValue = parseNumberInput(providerInput?.value);
    const retailValue = parseNumberInput(retailInput?.value);
    const markup = calculateMarkupPercent(providerValue, retailValue);

    if (markup !== null) {
        markupInput.value = formatTrimZeros(markup, 5);
    } else if (options.force) {
        markupInput.value = '';
    }
}

function calculateRetailRateFromMarkup(form) {
    if (!form) return;
    const providerInput = form.querySelector('[name="providerRate"]');
    const retailInput = form.querySelector('[name="rate"]');
    const markupInput = form.querySelector('[name="markup"]');
    
    if (!providerInput || !retailInput || !markupInput) return;
    
    const providerCost = parseNumberInput(providerInput.value);
    const markupPercent = parseNumberInput(markupInput.value);
    
    if (providerCost !== null && providerCost > 0 && markupPercent !== null && markupPercent >= 0) {
        // Formula: Retail Rate = Provider Cost * (1 + Markup / 100)
        const retailRate = providerCost * (1 + markupPercent / 100);
        retailInput.value = formatTrimZeros(retailRate, 4);
    }
}

function setupPricingInteraction(formId) {
    const form = document.getElementById(formId);
    if (!form) return;

    const providerInput = form.querySelector('[name="providerRate"]');
    const retailInput = form.querySelector('[name="rate"]');

    const handler = () => updateMarkupForForm(form);

    if (providerInput) {
        providerInput.addEventListener('input', handler);
    }
    if (retailInput) {
        retailInput.addEventListener('input', handler);
    }

    updateMarkupForForm(form, { onlyIfEmpty: true });
}

function pruneSelectedServiceIds() {
    if (selectedServiceIds.size === 0) {
        return;
    }
    const validIds = new Set(servicesCache.map(service => String(service.id)));
    for (const id of Array.from(selectedServiceIds)) {
        if (!validIds.has(String(id))) {
            selectedServiceIds.delete(id);
        }
    }
}

function bindServiceSelectionEvents() {
    document.querySelectorAll('.service-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', handleServiceSelectionChange);
    });
}

function handleServiceSelectionChange(event) {
    const checkbox = event?.target;
    if (!checkbox || !checkbox.dataset.serviceId) {
        return;
    }

    const serviceId = checkbox.dataset.serviceId;
    if (checkbox.checked) {
        selectedServiceIds.add(serviceId);
    } else {
        selectedServiceIds.delete(serviceId);
    }

    const row = checkbox.closest('tr');
    if (row) {
        row.classList.toggle('is-selected', checkbox.checked);
    }

    updateSelectedServicesSummary();
}

function restoreServiceSelectionState() {
    document.querySelectorAll('.service-checkbox').forEach(checkbox => {
        const isSelected = selectedServiceIds.has(checkbox.dataset.serviceId);
        checkbox.checked = isSelected;
        const row = checkbox.closest('tr');
        if (row) {
            row.classList.toggle('is-selected', isSelected);
        }
    });
}

function updateSelectedServicesSummary() {
    const countEl = document.getElementById('selectedServicesCount');
    const detailEl = document.getElementById('selectedServicesDetail');
    const cardEl = document.getElementById('selectedServicesCard');

    const count = selectedServiceIds.size;

    if (countEl) {
        countEl.textContent = `${count} selected`;
    }

    if (detailEl) {
        if (count === 0) {
            detailEl.textContent = 'Choose services to edit, duplicate, or toggle quickly.';
        } else {
            const names = [];
            selectedServiceIds.forEach(id => {
                const displayName = getServiceDisplayName(getServiceById(id));
                if (displayName) {
                    names.push(displayName);
                }
            });
            const preview = names.slice(0, 2).filter(Boolean).join(', ');
            const overflow = names.length > 2 ? ` +${names.length - 2}` : '';
            detailEl.textContent = preview ? `${preview}${overflow}` : `${count} selected`;
        }
    }

    if (cardEl) {
        const isActive = count > 0;
        cardEl.classList.toggle('is-active', isActive);
        cardEl.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }

    syncServiceMasterToggle();
}

function syncServiceMasterToggle() {
    const masterToggle = document.querySelector('th input[type="checkbox"][aria-label="Select all services"]');
    if (!masterToggle) {
        return;
    }

    const checkboxes = Array.from(document.querySelectorAll('.service-checkbox'));
    if (checkboxes.length === 0) {
        masterToggle.checked = false;
        masterToggle.indeterminate = false;
        return;
    }

    const selectedCount = checkboxes.filter(cb => cb.checked).length;
    masterToggle.checked = selectedCount > 0 && selectedCount === checkboxes.length;
    masterToggle.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
}

function openSelectedServiceModal() {
    if (selectedServiceIds.size === 0) {
        showNotification('Select a service from the table first', 'error');
        return;
    }
    const iterator = selectedServiceIds.values();
    const serviceId = iterator.next().value;
    if (serviceId) {
        editService(serviceId);
    }
}

function openAddServiceQuickAction() {
    addService();
}

function openImportServicesQuickAction() {
    importServices();
}

function openCreateCategoryQuickAction() {
    createCategory();
}

function openAddSubscriptionQuickAction() {
    addSubscription();
}

function attachServiceQuickActionCard(element, handler) {
    if (!element || typeof handler !== 'function') {
        return;
    }

    element.addEventListener('click', handler);
    element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handler();
        }
    });
}

function initializeServicesQuickActions() {
    attachServiceQuickActionCard(document.getElementById('selectedServicesCard'), openSelectedServiceModal);
    attachServiceQuickActionCard(document.getElementById('addServiceCard'), openAddServiceQuickAction);
    attachServiceQuickActionCard(document.getElementById('importServicesCard'), openImportServicesQuickAction);
    attachServiceQuickActionCard(document.getElementById('createCategoryCard'), openCreateCategoryQuickAction);
    attachServiceQuickActionCard(document.getElementById('addSubscriptionCard'), openAddSubscriptionQuickAction);
    updateSelectedServicesSummary();
}

function toggleAllServices(masterCheckbox) {
    if (!masterCheckbox) {
        return;
    }

    const checkboxes = document.querySelectorAll('.service-checkbox');
    const shouldSelectAll = masterCheckbox.checked;
    masterCheckbox.indeterminate = false;

    selectedServiceIds.clear();
    checkboxes.forEach(checkbox => {
        checkbox.checked = shouldSelectAll;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function isAdminCreatedService(service = {}) {
    if (!service) return false;
    if (service.origin && String(service.origin).toLowerCase() === 'manual') {
        return true;
    }
    if (service.is_manual === true) {
        return true;
    }
    if (service.type && String(service.type).toLowerCase() === 'custom') {
        return true;
    }
    return !service.provider_service_id;
}

// Bulk Add Services
async function bulkAddService() {
    const providers = await fetchProvidersList();
    const categories = await fetchCategoriesList();
    const providerOptions = providers.length > 0
        ? buildProviderOptions(providers)
        : '<option value="">No providers</option>';
    const categoryOptions = categories.length > 0
        ? buildCategoryOptions(categories)
        : '<option value="">Default</option>';

    const content = `
        <div class="bulk-add-container">
            <div class="bulk-add-defaults">
                <h4 style="margin:0 0 10px; font-size:13px; color:var(--admin-light-text);">Default Settings (applied to all)</h4>
                <div class="form-row">
                    <div class="form-group">
                        <label>Provider</label>
                        <select id="bulkDefaultProvider">${providerOptions}</select>
                    </div>
                    <div class="form-group">
                        <label>Category</label>
                        <select id="bulkDefaultCategory">${categoryOptions}</select>
                    </div>
                    <div class="form-group">
                        <label>Type</label>
                        <select id="bulkDefaultType">
                            <option value="service">Standard</option>
                            <option value="subscription">Subscription</option>
                            <option value="custom_comments">Custom Comments</option>
                            <option value="package">Package</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Status</label>
                        <select id="bulkDefaultStatus">
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Markup %</label>
                        <input type="number" id="bulkDefaultMarkup" placeholder="40" step="0.01" value="">
                    </div>
                    <div class="form-group">
                        <label>Overflow %</label>
                        <input type="number" id="bulkDefaultOverflow" placeholder="0" min="0" max="500" step="1" value="0">
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Customer Portal</label>
                        <select id="bulkDefaultPortal">
                            <option value="false">Hidden</option>
                            <option value="true">Visible</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Features</label>
                        <div class="bulk-checks-row">
                            <label class="bulk-check-label"><input type="checkbox" id="bulkDefaultRefill"> Refill</label>
                            <label class="bulk-check-label"><input type="checkbox" id="bulkDefaultCancel"> Cancel</label>
                            <label class="bulk-check-label"><input type="checkbox" id="bulkDefaultDripfeed"> Dripfeed</label>
                        </div>
                    </div>
                </div>
            </div>

            <div class="bulk-fetch-bar">
                <button type="button" class="btn-secondary" onclick="bulkFetchFromProvider()">
                    <i class="fas fa-cloud-download-alt"></i> Fetch Services from Provider
                </button>
                <small style="color:var(--admin-gray-text);">Fetches all services from selected provider and fills the table below.</small>
            </div>

            <div class="bulk-add-table-wrap">
                <table class="bulk-add-table">
                    <thead>
                        <tr>
                            <th style="width:35px">#</th>
                            <th>Service Name</th>
                            <th style="width:80px">Prov. ID</th>
                            <th style="width:80px">Cost/$1k</th>
                            <th style="width:80px">Rate/$1k</th>
                            <th style="width:65px">Min</th>
                            <th style="width:65px">Max</th>
                            <th style="width:32px"></th>
                        </tr>
                    </thead>
                    <tbody id="bulkAddRows">
                    </tbody>
                </table>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
                <button type="button" class="btn-secondary bulk-add-row-btn" onclick="addBulkRow()">
                    <i class="fas fa-plus"></i> Add Row
                </button>
                <button type="button" class="btn-secondary bulk-add-row-btn" onclick="for(let i=0;i<5;i++) addBulkRow();">
                    <i class="fas fa-plus"></i> +5 Rows
                </button>
            </div>
            <div class="bulk-add-status" id="bulkAddStatus"></div>
        </div>
    `;

    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" id="bulkSubmitBtn" onclick="submitBulkAdd()">
            <i class="fas fa-layer-group"></i> Create All
        </button>
    `;

    createModal('Bulk Add Services', content, actions);

    // Add initial 3 empty rows
    for (let i = 0; i < 3; i++) addBulkRow();
}

let bulkRowCounter = 0;

function addBulkRow(prefill = null) {
    bulkRowCounter++;
    const tbody = document.getElementById('bulkAddRows');
    if (!tbody) return;
    const row = document.createElement('tr');
    row.setAttribute('data-bulk-row', bulkRowCounter);
    row.innerHTML = `
        <td class="bulk-row-num">${tbody.children.length + 1}</td>
        <td><input type="text" class="bulk-input" name="name" placeholder="Service name" value="${prefill?.name ? escapeHtml(prefill.name) : ''}"></td>
        <td><input type="text" class="bulk-input" name="providerServiceId" placeholder="ID" value="${prefill?.service ? escapeHtml(String(prefill.service)) : ''}"></td>
        <td><input type="text" class="bulk-input bulk-input--right" name="cost" placeholder="0.00" value="${prefill?.rate != null ? prefill.rate : ''}"></td>
        <td><input type="text" class="bulk-input bulk-input--right" name="rate" placeholder="0.00" value=""></td>
        <td><input type="text" class="bulk-input" name="min" placeholder="100" value="${prefill?.min != null ? prefill.min : ''}"></td>
        <td><input type="text" class="bulk-input" name="max" placeholder="10000" value="${prefill?.max != null ? prefill.max : ''}"></td>
        <td><button type="button" class="bulk-remove-btn" onclick="removeBulkRow(this)" title="Remove"><i class="fas fa-times"></i></button></td>
    `;
    tbody.appendChild(row);

    // Auto-calc retail rate from cost + markup
    if (prefill?.rate != null) {
        const markupInput = document.getElementById('bulkDefaultMarkup');
        const markup = parseFloat(markupInput?.value) || 0;
        if (markup > 0) {
            const retailInput = row.querySelector('input[name="rate"]');
            if (retailInput) retailInput.value = (parseFloat(prefill.rate) * (1 + markup / 100)).toFixed(4);
        } else {
            const retailInput = row.querySelector('input[name="rate"]');
            if (retailInput) retailInput.value = prefill.rate;
        }
    }
}

function removeBulkRow(btn) {
    const row = btn.closest('tr');
    if (row) row.remove();
    const tbody = document.getElementById('bulkAddRows');
    if (tbody) {
        [...tbody.children].forEach((r, i) => {
            const numCell = r.querySelector('.bulk-row-num');
            if (numCell) numCell.textContent = i + 1;
        });
    }
}

async function bulkFetchFromProvider() {
    const providerSelect = document.getElementById('bulkDefaultProvider');
    const providerId = providerSelect?.value;
    if (!providerId) {
        showNotification('Select a provider first', 'error');
        return;
    }

    // Collect provider service IDs from table rows
    const tbody = document.getElementById('bulkAddRows');
    const rows = tbody ? [...tbody.querySelectorAll('tr')] : [];
    const serviceIds = [];
    rows.forEach(row => {
        const id = row.querySelector('input[name="providerServiceId"]')?.value?.trim();
        if (id) serviceIds.push(id);
    });

    if (serviceIds.length === 0) {
        showNotification('Enter at least one Provider ID in the table first', 'error');
        return;
    }

    const statusEl = document.getElementById('bulkAddStatus');
    if (statusEl) statusEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Fetching ' + serviceIds.length + ' service(s) from provider...';

    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/providers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'fetch-services',
                providerId: providerId,
                serviceIds: serviceIds
            })
        });

        const data = await response.json();

        if (!data.success) {
            if (statusEl) statusEl.textContent = data.error || 'Failed to fetch services.';
            return;
        }

        const services = data.services || [];

        if (!Array.isArray(services) || services.length === 0) {
            if (statusEl) statusEl.textContent = 'No matching services found from this provider.';
            return;
        }

        // Build a map of fetched services by ID
        const serviceMap = {};
        services.forEach(s => {
            const sid = String(s.service || s.id || '');
            if (sid) serviceMap[sid] = s;
        });

        // Fill in existing rows that have a matching provider ID
        let filled = 0;
        rows.forEach(row => {
            const idInput = row.querySelector('input[name="providerServiceId"]');
            const id = idInput?.value?.trim();
            if (!id || !serviceMap[id]) return;

            const s = serviceMap[id];
            const nameInput = row.querySelector('input[name="name"]');
            const costInput = row.querySelector('input[name="cost"]');
            const rateInput = row.querySelector('input[name="rate"]');
            const minInput = row.querySelector('input[name="min"]');
            const maxInput = row.querySelector('input[name="max"]');

            if (nameInput && !nameInput.value.trim()) nameInput.value = s.name || '';
            if (costInput) costInput.value = s.rate || s.price || '';
            if (minInput && !minInput.value.trim()) minInput.value = s.min || '';
            if (maxInput && !maxInput.value.trim()) maxInput.value = s.max || '';

            // Auto-calc retail rate from cost + markup
            const markupInput = document.getElementById('bulkDefaultMarkup');
            const markup = parseFloat(markupInput?.value) || 0;
            const cost = parseFloat(s.rate || s.price || 0);
            if (rateInput) {
                rateInput.value = markup > 0 ? (cost * (1 + markup / 100)).toFixed(4) : cost;
            }

            row.style.background = 'rgba(16, 185, 129, 0.08)';
            filled++;
        });

        const notFound = serviceIds.length - filled;
        let msg = `Fetched ${filled} of ${serviceIds.length} service(s).`;
        if (notFound > 0) msg += ` ${notFound} ID(s) not found at provider.`;
        msg += ' Review and click "Create All".';
        if (statusEl) statusEl.textContent = msg;
    } catch (error) {
        console.error('Bulk fetch error:', error);
        if (statusEl) statusEl.textContent = 'Failed to fetch services from provider.';
        showNotification('Failed to fetch services', 'error');
    }
}

async function submitBulkAdd() {
    const tbody = document.getElementById('bulkAddRows');
    if (!tbody) return;

    const defaultProvider = document.getElementById('bulkDefaultProvider')?.value || null;
    const defaultCategory = document.getElementById('bulkDefaultCategory')?.value || '';
    const defaultType = document.getElementById('bulkDefaultType')?.value || 'service';
    const defaultStatus = document.getElementById('bulkDefaultStatus')?.value || 'active';
    const defaultMarkup = parseFloat(document.getElementById('bulkDefaultMarkup')?.value) || 0;
    const defaultOverflow = parseFloat(document.getElementById('bulkDefaultOverflow')?.value) || 0;
    const defaultPortal = document.getElementById('bulkDefaultPortal')?.value === 'true';
    const defaultRefill = document.getElementById('bulkDefaultRefill')?.checked || false;
    const defaultCancel = document.getElementById('bulkDefaultCancel')?.checked || false;
    const defaultDripfeed = document.getElementById('bulkDefaultDripfeed')?.checked || false;

    const rows = [...tbody.querySelectorAll('tr')];
    const services = [];

    for (const row of rows) {
        const name = row.querySelector('input[name="name"]')?.value?.trim();
        if (!name) continue;

        const providerServiceId = row.querySelector('input[name="providerServiceId"]')?.value?.trim() || null;
        const cost = parseFloat(row.querySelector('input[name="cost"]')?.value) || 0;
        const rate = parseFloat(row.querySelector('input[name="rate"]')?.value) || 0;
        const min = parseInt(row.querySelector('input[name="min"]')?.value, 10) || 100;
        const max = parseInt(row.querySelector('input[name="max"]')?.value, 10) || 10000;

        services.push({ name, providerServiceId, cost, rate, min, max });
    }

    if (services.length === 0) {
        showNotification('No services to create. Fill in at least one row.', 'error');
        return;
    }

    const submitBtn = document.getElementById('bulkSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }

    const statusEl = document.getElementById('bulkAddStatus');
    let created = 0;
    let failed = 0;
    const token = localStorage.getItem('token');
    const filledRows = rows.filter(r => r.querySelector('input[name="name"]')?.value?.trim());

    for (let i = 0; i < services.length; i++) {
        const s = services[i];
        if (statusEl) statusEl.textContent = `Creating ${i + 1} of ${services.length}...`;

        try {
            const retailRate = s.rate || (s.cost && defaultMarkup ? s.cost * (1 + defaultMarkup / 100) : s.cost) || 0;

            const payload = {
                action: 'create',
                name: s.name,
                category: defaultCategory,
                type: defaultType,
                rate: retailRate,
                retailRate: retailRate,
                providerRate: s.cost || null,
                markupPercentage: defaultMarkup || null,
                min_quantity: s.min,
                max_quantity: s.max,
                status: defaultStatus,
                providerId: defaultProvider,
                providerServiceId: s.providerServiceId,
                overflowPercent: defaultOverflow,
                customerPortalEnabled: defaultPortal,
                adminApproved: defaultPortal,
                refill_supported: defaultRefill,
                cancel_supported: defaultCancel,
                dripfeed_supported: defaultDripfeed
            };

            const response = await fetch(buildAdminServicesUrl(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            const data = await parseApiResponse(response);
            if (response.ok && data?.success) {
                created++;
                if (filledRows[i]) filledRows[i].style.background = 'rgba(16, 185, 129, 0.1)';
            } else {
                failed++;
                if (filledRows[i]) filledRows[i].style.background = 'rgba(239, 68, 68, 0.1)';
            }
        } catch (err) {
            console.error('Bulk create error:', err);
            failed++;
        }
    }

    if (statusEl) statusEl.textContent = `Done: ${created} created, ${failed} failed`;
    showNotification(`Bulk add complete: ${created} created${failed ? `, ${failed} failed` : ''}`, failed ? 'warning' : 'success');

    if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="fas fa-layer-group"></i> Create All';
    }

    if (created > 0) {
        setTimeout(() => {
            closeModal();
            reloadServicesPreserveScroll();
        }, 1000);
    }
}

// Add new service
async function addService() {
    const providers = await fetchProvidersList();
    const categories = await fetchCategoriesList();
    const hasProviders = providers.length > 0;
    const hasCategories = categories.length > 0;
    const providerOptions = hasProviders
        ? buildProviderOptions(providers)
        : '<option value="" disabled>No providers available</option>';
    const categoryOptions = hasCategories
        ? buildCategoryOptions(categories)
        : '<option value="">Instagram</option><option value="">TikTok</option><option value="">YouTube</option>';

    const content = `
        <form id="addServiceForm" onsubmit="submitAddService(event)" class="admin-form">
            <div class="add-service-layout">
                <div class="add-service-grid">
                    <div class="add-service-card">
                        <h4>Service Basics</h4>
                        <div class="form-group">
                            <label>Service Name *</label>
                            <input type="text" name="serviceName" placeholder="Instagram Followers - High Quality" required>
                        </div>
                        <div class="add-service-inline">
                            <div class="form-group">
                                <label>Category *</label>
                                <select name="category" required>
                                    ${categoryOptions}
                                </select>
                                <small style="color: #94a3b8;">
                                    ${hasCategories ? `${categories.length} categories available` : 'Using default categories'}
                                    • <a href="#" onclick="event.preventDefault(); createCategory();" style="color: var(--admin-primary);">+ Create new category</a>
                                </small>
                            </div>
                            <div class="form-group">
                                <label>Type *</label>
                                <select name="type" required>
                                    <option value="service" selected>Standard</option>
                                    <option value="subscription">Subscription</option>
                                    <option value="custom_comments">Custom Comments</option>
                                    <option value="package">Package</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="add-service-card">
                        <h4>Provider Mapping</h4>
                        <div class="form-group">
                            <label>Provider ${hasProviders ? '*' : '(none available)'}</label>
                            <select name="provider" id="addServiceProviderSelect" ${hasProviders ? 'required' : 'disabled'} onchange="onProviderChange(this.value)">
                                ${providerOptions}
                            </select>
                            ${hasProviders ? '' : '<small style="color: #f87171;">Add a provider first to link services.</small>'}
                        </div>
                        <div class="form-group">
                            <label>Provider Service ID *</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" name="providerServiceId" id="providerServiceIdInput" placeholder="Enter provider\'s service ID" required style="flex: 1;">
                                <button type="button" onclick="autoFetchServiceDetails()" class="btn-secondary" style="white-space: nowrap; padding: 8px 12px;" title="Fetch details from provider">
                                    🔄
                                </button>
                            </div>
                            <small style="color: #94a3b8;">Enter service ID and click 🔄 to auto-fill details from provider.</small>
                        </div>
                    </div>
                </div>

                <div class="add-service-grid">
                    <div class="add-service-card">
                        <h4>Pricing</h4>
                        <div class="add-service-inline">
                            <div class="form-group">
                                <label>Provider Cost per 1000</label>
                                <input type="number" name="providerRate" placeholder="3.5000" min="0" step="0.0001" oninput="calculateRetailRateFromMarkup(this.closest('form'))">
                            </div>
                            <div class="form-group">
                                <label>Retail Rate per 1000 *</label>
                                <input type="number" name="rate" placeholder="5.0000" min="0" step="0.0001" required oninput="updateMarkupForForm(this.closest('form'))">
                            </div>
                            <div class="form-group">
                                <label>Markup %</label>
                                <input type="number" name="markup" placeholder="40" step="0.00001" oninput="calculateRetailRateFromMarkup(this.closest('form'))">
                            </div>
                        </div>
                        <small style="color: #94a3b8;">Auto-calculated when markup or provider cost changes.</small>
                    </div>

                    <div class="add-service-card">
                        <h4>Limits & Status</h4>
                        <div class="add-service-inline">
                            <div class="form-group">
                                <label>Min Quantity *</label>
                                <input type="number" name="min" placeholder="100" min="1" required>
                            </div>
                            <div class="form-group">
                                <label>Max Quantity *</label>
                                <input type="number" name="max" placeholder="10000" min="1">
                            </div>
                        </div>
                        <div class="add-service-inline">
                            <div class="form-group">
                                <label>Overflow %</label>
                                <input type="number" name="overflowPercent" placeholder="0" min="0" max="500" step="1" value="0">
                                <small style="color: #94a3b8;">Extra quantity sent to provider. E.g. 40 = customer orders 100, provider gets 140.</small>
                            </div>
                            <div class="form-group">
                                <label>Status</label>
                                <select name="status">
                                    <option value="active" selected>Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="add-service-grid">
                    <div class="add-service-card">
                        <h4>Customer Portal</h4>
                        <div class="add-service-inline">
                            <div class="form-group">
                                <label>Show in Customer Portal</label>
                                <select name="customerPortalEnabled">
                                    <option value="false" selected>Hidden (default)</option>
                                    <option value="true">Visible to customers</option>
                                </select>
                                <small style="color: #94a3b8;">${PORTAL_SLOT_LIMIT_MESSAGE}</small>
                            </div>
                            <div class="form-group">
                                <label>Portal Slot (${PORTAL_SLOT_RANGE_LABEL})</label>
                                <input type="number" name="customerPortalSlot" placeholder="1" min="1" ${PORTAL_SLOT_MAX_ATTR}>
                                <small style="color: #94a3b8;">Controls dropdown order when visible.</small>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Customer Portal Notes</label>
                            <textarea name="customerPortalNotes" rows="2" placeholder="Optional tagline or reminder for this curated slot"></textarea>
                        </div>
                    </div>

                    <div class="add-service-card">
                        <h4>Description</h4>
                        <div class="form-group">
                            <textarea name="description" rows="4" placeholder="Service description..."></textarea>
                        </div>
                    </div>

                    <div class="add-service-card">
                        <h4>Refill Options</h4>
                        <div class="form-group">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" name="refill_supported" style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Refill</span>
                            </label>
                        </div>
                        <div class="form-group">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" name="cancel_supported" style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Cancel</span>
                            </label>
                        </div>
                        <div class="form-group">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" name="dripfeed_supported" style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Dripfeed</span>
                            </label>
                        </div>
                        <div class="form-group">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" name="subscription_supported" style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Subscription</span>
                            </label>
                            <small style="color: #94a3b8; display: block; margin-top: 8px;">Check which features are available for this service</small>
                        </div>
                    </div>
                </div>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="addServiceForm" class="btn-primary" ${hasProviders ? '' : 'disabled'}>
            <i class="fas fa-plus"></i> Create Service
        </button>
    `;
    
    createModal('Add New Service', content, actions);
    setupPricingInteraction('addServiceForm');
    setupCategorySuggestion('addServiceForm');

    // Auto-set portal slot: use next slot within selected category
    // Automatically updates when category changes (unless user is actively typing)
    setTimeout(() => {
        try {
            const slotInput = document.querySelector('#addServiceForm input[name="customerPortalSlot"]');
            const categorySelect = document.querySelector('#addServiceForm select[name="category"]');
            let userIsTypingSlot = false;
            
            if (slotInput) {
                slotInput.addEventListener('focus', () => { userIsTypingSlot = true; });
                slotInput.addEventListener('blur', () => { userIsTypingSlot = false; });
            }
            
            if (categorySelect) {
                categorySelect.addEventListener('change', () => {
                    if (!slotInput) return;
                    const categoryValue = categorySelect.value;
                    if (!categoryValue) {
                        slotInput.value = ''; // clear slot if no category
                        return;
                    }
                    // Always update slot when category changes (unless user is actively in the field)
                    if (!userIsTypingSlot) {
                        const nextSlot = getNextCategoryPortalSlot(categoryValue);
                        console.log('Auto-updating portal slot on category change:', {
                            category: categoryValue,
                            nextSlot,
                            servicesInCategory: servicesCache.filter(s => 
                                String(s.category || '').trim().toLowerCase() === String(categoryValue || '').trim().toLowerCase()
                            ).map(s => ({ id: s.id, name: s.name, slot: s.customer_portal_slot }))
                        });
                        slotInput.value = nextSlot;
                    }
                });
            }
        } catch (error) {
            console.error('Failed to auto-set portal slot:', error);
        }
    }, 100);
}

async function submitAddService(event) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const serviceData = Object.fromEntries(formData);

    const providerRateValue = parseNumberInput(serviceData.providerRate);
    const retailRateValue = parseNumberInput(serviceData.rate);
    const markupValue = parseNumberInput(serviceData.markup);
    const minQuantityValue = parseIntegerInput(serviceData.min);
    const maxQuantityValue = parseIntegerInput(serviceData.max);
    const customerPortalEnabledFlag = toBooleanInput(serviceData.customerPortalEnabled);
    const customerPortalSlotValue = normalizePortalSlotInput(serviceData.customerPortalSlot);
    const customerPortalNotesValue = (serviceData.customerPortalNotes || '').trim();
    const refillSupportedFlag = toBooleanInput(serviceData.refill_supported);
    const cancelSupportedFlag = toBooleanInput(serviceData.cancel_supported);
    const dripfeedSupportedFlag = toBooleanInput(serviceData.dripfeed_supported);
    const subscriptionSupportedFlag = toBooleanInput(serviceData.subscription_supported);
    const overflowPercentValue = parseNumberInput(serviceData.overflowPercent) ?? 0;

    const submitBtn = document.querySelector('button[form="addServiceForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }

    try {
        const token = localStorage.getItem('token');
        
        const payload = {
            action: 'create',
            name: serviceData.serviceName,
            category: serviceData.category,
            type: serviceData.type || 'service',
            rate: retailRateValue ?? 0,
            retailRate: retailRateValue,
            providerRate: providerRateValue,
            markupPercentage: markupValue,
            min_quantity: minQuantityValue ?? 0,
            max_quantity: maxQuantityValue,
            description: serviceData.description || '',
            status: (serviceData.status || 'active').toLowerCase(),
            providerId: serviceData.provider || null,
            refill_supported: refillSupportedFlag,
            cancel_supported: cancelSupportedFlag,
            dripfeed_supported: dripfeedSupportedFlag,
            subscription_supported: subscriptionSupportedFlag,
            providerServiceId: serviceData.providerServiceId || null,
            adminApproved: customerPortalEnabledFlag,
            customerPortalEnabled: customerPortalEnabledFlag,
            customerPortalSlot: customerPortalSlotValue,
            customerPortalNotes: customerPortalNotesValue || null,
            overflowPercent: overflowPercentValue
        };
        
        console.log('Create service payload:', payload);
        
        const response = await fetch(buildAdminServicesUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await parseApiResponse(response);

        if (response.ok && data && data.success) {
            showNotification(data.message || 'Service created successfully!', 'success');
            closeModal();
            await loadServices();
        } else {
            const serverMessage = data && data.error ? data.error : `HTTP ${response.status} ${response.statusText}`;
            console.error('Create service failed:', response.status, serverMessage, data);
            showNotification(serverMessage || 'Failed to create service', 'error');
        }
    } catch (error) {
        console.error('Create service error:', error);
        showNotification('Failed to create service. Please try again.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-plus"></i> Create Service';
        }
    }
}

async function editService(serviceId) {
    const service = servicesCache.find(item => String(item.id) === String(serviceId));
    if (!service) {
        showNotification('Service not found for editing', 'error');
        return;
    }

    const providers = await fetchProvidersList();
    const categories = await fetchCategoriesList();
    const providerOptions = buildProviderOptionsWithSelected(providers, service.provider_id);

    const currentCategory = String(service.category || '').toLowerCase();
    let categoryOptions = '';
    
    if (categories.length > 0) {
        categoryOptions = categories.map(category => {
            const isSelected = currentCategory === category.slug.toLowerCase();
            return `<option value="${escapeHtml(category.slug)}"${isSelected ? ' selected' : ''}>${escapeHtml(category.name)}</option>`;
        }).join('');
    } else {
        // Fallback to default categories
        const defaultCategories = ['instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'other'];
        categoryOptions = defaultCategories.map(category => {
            const label = category.charAt(0).toUpperCase() + category.slice(1);
            const selected = currentCategory === category ? ' selected' : '';
            return `<option value="${category}"${selected}>${label}</option>`;
        }).join('');
    }

    const isManualService = isAdminCreatedService(service);
    const publicIdValue = toNumeric(service.public_id);
    const hasPublicId = Number.isFinite(publicIdValue);
    const publicIdDisplay = hasPublicId ? `#${publicIdValue}` : 'ID Pending';
    const providerIdDisplay = service.provider_service_id ? escapeHtml(service.provider_service_id) : '—';

    const providerMarkup = toNumeric(service.provider?.markup);
    const serviceMarkup = toNumeric(service.markup_percentage ?? service.markup);
    let providerCost = toNumeric(service.provider_rate ?? service.provider_cost ?? service.raw_rate);
    const retailRate = toNumeric(service.rate);
    const customerPortalEnabled = Boolean(service.customer_portal_enabled);
    const customerPortalSlot = toNumeric(service.customer_portal_slot);
    const customerPortalNotes = service.customer_portal_notes || '';

    if (providerCost === null && retailRate !== null) {
        const preferredMarkup = serviceMarkup !== null ? serviceMarkup : providerMarkup;
        if (preferredMarkup !== null && preferredMarkup > -100) {
            const factor = 1 + preferredMarkup / 100;
            if (factor !== 0) {
                providerCost = retailRate / factor;
            }
        }
    }

    const markupValue = serviceMarkup !== null
        ? serviceMarkup
        : calculateMarkupPercent(providerCost, retailRate);

    const retailDisplayRate = retailRate !== null
        ? retailRate
        : (providerCost !== null ? providerCost : null);
    const minValue = toNumeric(service.min_quantity);
    const maxValue = toNumeric(service.max_quantity);

    const normalizedType = String(service.type || 'service').trim().toLowerCase();
    const resolvedType = normalizedType.includes('custom')
        ? 'custom_comments'
        : (normalizedType.includes('subscription') ? 'subscription' 
          : (normalizedType.includes('package') ? 'package' : 'service'));

    const content = `
        <form id="editServiceForm" onsubmit="submitEditService(event, '${serviceId}')" class="admin-form">
            <div class="add-service-layout">
                <div class="form-group" style="display: flex; gap: 16px; font-size: 13px; color: #94a3b8; margin-bottom: 12px;">
                    <span><strong>Our ID:</strong> ${publicIdDisplay}</span>
                    <span><strong>Provider ID:</strong> ${providerIdDisplay}</span>
                </div>

                <div class="add-service-grid">
                    <div class="add-service-card">
                        <h4>Service Basics</h4>
                        <div class="form-group">
                            <label>Service Name *</label>
                            <input type="text" name="serviceName" value="${escapeHtml(service.name)}" required>
                        </div>
                        <div class="add-service-inline">
                            <div class="form-group">
                                <label>Category *</label>
                                <select name="category" required>
                                    ${categoryOptions}
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Type</label>
                                <select name="type">
                                    <option value="service"${resolvedType === 'service' ? ' selected' : ''}>Standard</option>
                                    <option value="subscription"${resolvedType === 'subscription' ? ' selected' : ''}>Subscription</option>
                                    <option value="custom_comments"${resolvedType === 'custom_comments' ? ' selected' : ''}>Custom Comments</option>
                                    <option value="package"${resolvedType === 'package' ? ' selected' : ''}>Package</option>
                                </select>
                                <small style="color: #94a3b8;">Use Custom Comments for comment-per-line orders.</small>
                            </div>
                        </div>
                    </div>

                    <div class="add-service-card">
                        <h4>Provider Mapping</h4>
                        <div class="form-group">
                            <label>Provider</label>
                            <select name="provider">
                                ${providerOptions}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Provider Service ID</label>
                            <div style="display: flex; gap: 8px;">
                                <input type="text" name="providerServiceId" id="editProviderServiceIdInput" value="${providerIdDisplay !== '—' ? providerIdDisplay : ''}" placeholder="Enter provider service ID" style="flex: 1;">
                                <button type="button" onclick="autoFetchServiceDetails()" class="btn-secondary" style="white-space: nowrap; padding: 8px 12px;" title="Fetch details from provider">
                                    🔄
                                </button>
                            </div>
                            <small style="color: #94a3b8;">Click 🔄 to auto-fetch details. Leave blank to detach from provider.</small>
                        </div>
                    </div>
                </div>

                <div class="add-service-grid">
                    <div class="add-service-card">
                        <h4>Pricing</h4>
                        <div class="add-service-inline">
                            <div class="form-group">
                                <label>Provider Cost per 1000</label>
                                <input type="number" name="providerRate" step="0.0001" min="0" value="${formatNumberForInput(providerCost)}" oninput="updateMarkupForForm(this.closest('form'))">
                            </div>
                            <div class="form-group">
                                <label>Retail Rate per 1000 *</label>
                                <input type="number" name="rate" step="0.0001" min="0" value="${formatNumberForInput(retailDisplayRate)}" required oninput="updateMarkupForForm(this.closest('form'))">
                            </div>
                            <div class="form-group">
                                <label>Markup %</label>
                                <input type="number" name="markup" step="0.00001" value="${markupValue !== null ? markupValue : ''}" oninput="calculateRetailRateFromMarkup(this.closest('form'))">
                            </div>
                        </div>
                        <small style="color: #94a3b8;">Auto-calculated when markup or provider cost changes.</small>
                    </div>

                    <div class="add-service-card">
                        <h4>Limits & Status</h4>
                        <div class="add-service-inline">
                            <div class="form-group">
                                <label>Min Quantity *</label>
                                <input type="number" name="min" min="1" value="${minValue !== null ? minValue : ''}" required>
                            </div>
                            <div class="form-group">
                                <label>Max Quantity *</label>
                                <input type="number" name="max" min="1" value="${maxValue !== null ? maxValue : ''}">
                            </div>
                        </div>
                        <div class="add-service-inline">
                            <div class="form-group">
                                <label>Overflow %</label>
                                <input type="number" name="overflowPercent" min="0" max="500" step="1" value="${service.overflow_percent || 0}">
                                <small style="color: #94a3b8;">Extra quantity sent to provider. E.g. 40 = customer orders 100, provider gets 140.</small>
                            </div>
                            <div class="form-group">
                                <label>Status</label>
                                <select name="status">
                                    <option value="active"${service.status === 'active' ? ' selected' : ''}>Active</option>
                                    <option value="inactive"${service.status === 'inactive' ? ' selected' : ''}>Inactive</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="add-service-grid">
                    <div class="add-service-card">
                        <h4>Customer Portal</h4>
                        <div class="add-service-inline">
                            <div class="form-group">
                                <label>Show in Customer Portal</label>
                                <select name="customerPortalEnabled">
                                    <option value="false"${customerPortalEnabled ? '' : ' selected'}>Hidden from storefront</option>
                                    <option value="true"${customerPortalEnabled ? ' selected' : ''}>Visible to customers</option>
                                </select>
                                <small style="color: #94a3b8;">${PORTAL_SLOT_LIMIT_MESSAGE}</small>
                            </div>
                            <div class="form-group">
                                <label>Portal Slot (${PORTAL_SLOT_RANGE_LABEL})</label>
                                <input type="number" name="customerPortalSlot" min="1" ${PORTAL_SLOT_MAX_ATTR} value="${customerPortalSlot !== null ? customerPortalSlot : ''}" placeholder="1">
                                <small style="color: #94a3b8;">Controls ordering in the public dropdown.</small>
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Customer Portal Notes</label>
                            <textarea name="customerPortalNotes" rows="2" placeholder="Optional">${escapeHtml(customerPortalNotes)}</textarea>
                        </div>
                    </div>

                    <div class="add-service-card">
                        <h4>Description</h4>
                        <div class="form-group">
                            <textarea name="description" rows="4" placeholder="Optional">${escapeHtml(service.description || '')}</textarea>
                        </div>
                    </div>

                    <div class="add-service-card">
                        <h4>Refill Options</h4>
                        <div class="form-group">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" name="refill_supported" ${service.refill_supported ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Refill</span>
                            </label>
                        </div>
                        <div class="form-group">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" name="cancel_supported" ${service.cancel_supported ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Cancel</span>
                            </label>
                        </div>
                        <div class="form-group">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" name="dripfeed_supported" ${service.dripfeed_supported ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Dripfeed</span>
                            </label>
                        </div>
                        <div class="form-group">
                            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                                <input type="checkbox" name="subscription_supported" ${service.subscription_supported ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                                <span>Subscription</span>
                            </label>
                            <small style="color: #94a3b8; display: block; margin-top: 8px;">Check which features are available for this service</small>
                        </div>
                    </div>
                </div>
            </div>
        </form>
    `;

    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="editServiceForm" class="btn-primary">
            <i class="fas fa-save"></i> Save Changes
        </button>
    `;

    createModal(`Edit Service`, content, actions);
    setupPricingInteraction('editServiceForm');
}
// Import services from provider
async function importServices() {
    const providers = await fetchProvidersList();
    const hasProviders = providers.length > 0;
    const providerOptions = hasProviders
        ? buildProviderOptions(providers)
        : '<option value="" disabled>No providers available</option>';

    const content = `
        <form id="importServicesForm" onsubmit="submitImportServices(event)" class="admin-form">
            <div class="form-group">
                <label>Select Provider ${hasProviders ? '*' : '(none available)'}</label>
                <select name="provider" id="importProvider" ${hasProviders ? 'required' : 'disabled'} onchange="loadProviderServices(this.value)">
                    ${providerOptions}
                </select>
                ${hasProviders ? '' : '<small style="color: #f87171;">Add a provider first to import services.</small>'}
            </div>
            <div class="form-group">
                <label>Markup Percentage *</label>
                <input type="number" name="markup" value="15" min="0" max="100" step="1" required>
                <small style="color: #888;">Add this percentage to provider rates</small>
            </div>
            <div class="form-group">
                <label>Category Mapping</label>
                <select name="categoryMapping">
                    <option value="auto">Auto-detect from provider</option>
                    <option value="instagram">Map all to Instagram</option>
                    <option value="tiktok">Map all to TikTok</option>
                    <option value="youtube">Map all to YouTube</option>
                </select>
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" name="activeOnly" checked>
                    Import only active services
                </label>
            </div>
            <div id="providerServicesPreview" style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; margin-top: 16px; display: none;">
                <h4 style="margin-bottom: 12px; color: #FF1494;">Services Preview</h4>
                <div id="servicesPreviewList"></div>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="importServicesForm" class="btn-primary" ${hasProviders ? '' : 'disabled'}>
            <i class="fas fa-file-import"></i> Import Services
        </button>
    `;
    
    createModal('Import Services from Provider', content, actions);
}

async function loadProviderServices(providerId) {
    if (!providerId) return;
    
    const preview = document.querySelector('#providerServicesPreview');
    const list = document.querySelector('#servicesPreviewList');
    
    try {
        // Fetch real provider's services from backend
        const token = localStorage.getItem('token');
    const response = await fetch(buildAdminServicesUrl({ providerId }), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            const services = result.services || [];
            
            if (services.length > 0) {
                list.innerHTML = services.slice(0, 10).map(s => 
                    `<div style="padding: 4px 0; color: #aaa;">• ${s.name}</div>`
                ).join('');
                if (services.length > 10) {
                    list.innerHTML += `<div style="padding: 4px 0; color: #FF1494; font-weight: 600;">+ ${services.length - 10} more services</div>`;
                }
            } else {
                list.innerHTML = '<div style="padding: 8px 0; color: #888;">No services found for this provider</div>';
            }
        } else {
            list.innerHTML = '<div style="padding: 8px 0; color: #ff4444;">Error loading services</div>';
        }
    } catch (error) {
        console.error('Error loading provider services:', error);
        list.innerHTML = '<div style="padding: 8px 0; color: #ff4444;">Error loading services</div>';
    }
    
    preview.style.display = 'block';
}

async function submitImportServices(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const importData = Object.fromEntries(formData);
    
    const submitBtn = document.querySelector('button[form="importServicesForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Importing...';
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/providers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'sync',
                providerId: importData.provider,
                markup: parseFloat(importData.markup) || 15
            })
        });
        
        const data = await parseApiResponse(response);
        if (response.ok && data && data.success) {
            showNotification(`Successfully imported ${data.added || 0} new services and updated ${data.updated || 0} existing services!`, 'success');
            closeModal();
            reloadServicesPreserveScroll();
        } else {
            const serverMessage = data && data.error ? data.error : `HTTP ${response.status} ${response.statusText}`;
            console.error('Import services failed:', response.status, serverMessage, data);
            showNotification(serverMessage || 'Failed to import services', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-download"></i> Import Services';
            }
        }
    } catch (error) {
        console.error('Import services error:', error);
        showNotification('Failed to import services. Please try again.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-download"></i> Import Services';
        }
    }
}

// Create category
async function createCategory() {
    const categories = await fetchCategoriesList(false, { includeInactive: true });
    const parentOptions = buildParentCategoryOptions(categories);
    const suggestedOrder = Math.max(1, (categories?.length || 0) + 1);

    const content = `
        <form id="createCategoryForm" onsubmit="submitCreateCategory(event)" class="admin-form">
            <div class="form-group">
                <label>Category Name *</label>
                <input type="text" name="categoryName" placeholder="e.g., Instagram" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Slug</label>
                    <input type="text" name="slug" placeholder="instagram-pro">
                    <small style="color: #888;">Leave blank to auto-generate.</small>
                </div>
                <div class="form-group">
                    <label>Category Icon</label>
                    <input type="text" name="icon" placeholder="fab fa-instagram" value="fas fa-folder">
                    <small style="color: #888;">Font Awesome icon class</small>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Display Order</label>
                    <input type="number" name="order" value="${suggestedOrder}" min="1">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status">
                        <option value="active" selected>Active</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Parent Category</label>
                <select name="parent">
                    ${parentOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea name="description" rows="2" placeholder="Category description..."></textarea>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="createCategoryForm" class="btn-primary">
            <i class="fas fa-folder-plus"></i> Create Category
        </button>
    `;
    
    createModal('Create New Category', content, actions);
}

async function submitCreateCategory(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const categoryData = Object.fromEntries(formData);
    
    const submitBtn = document.querySelector('button[form="createCategoryForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }
    
    try {
        const token = localStorage.getItem('token');
        const displayOrderValue = parseIntegerInput(categoryData.order);
        const payload = {
            action: 'create-category',
            name: categoryData.categoryName,
            slug: categoryData.slug || undefined,
            description: categoryData.description || '',
            icon: categoryData.icon || 'fas fa-folder',
            status: (categoryData.status || 'active').toLowerCase(),
            display_order: displayOrderValue,
            parent_id: categoryData.parent || null
        };

        const response = await fetch(buildAdminServicesUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        
        const data = await parseApiResponse(response);
        if (response.ok && data && data.success) {
            showNotification(`Category "${categoryData.categoryName}" created successfully!`, 'success');
            // Invalidate categories cache to fetch fresh data
            window.invalidateCategoriesCache('all');
            closeModal();
            reloadServicesPreserveScroll();
        } else {
            const serverMessage = data && data.error ? data.error : `HTTP ${response.status} ${response.statusText}`;
            console.error('Create category failed:', response.status, serverMessage, data);
            showNotification(serverMessage || 'Failed to create category', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-folder-plus"></i> Create Category';
            }
        }
    } catch (error) {
        console.error('Create category error:', error);
        showNotification('Failed to create category. Please try again.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-folder-plus"></i> Create Category';
        }
    }
}

async function manageCategories(force = false) {
    const categories = await fetchCategoriesList(force, { includeInactive: true });
    const content = buildCategoryManagementContent(categories);

    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Close</button>
        <button type="button" class="btn-primary" onclick="closeModal(); setTimeout(() => createCategory(), 200);">
            <i class="fas fa-folder-plus"></i> New Category
        </button>
    `;

    createModal('Manage Categories', content, actions);
    initCategoryDragDrop();
}

function buildCategoryManagementContent(categories = []) {
    if (!Array.isArray(categories) || categories.length === 0) {
        return `
            <div class="empty-state">
                <p>No categories found yet.</p>
                <button class="btn-primary" onclick="closeModal(); setTimeout(() => createCategory(), 200);">
                    <i class="fas fa-folder-plus"></i> Create your first category
                </button>
            </div>
        `;
    }

    // Group: parents first, then children under their parent
    const parentCats = categories.filter(c => !c.parent_id);
    const childCats = categories.filter(c => c.parent_id);
    const childMap = {};
    childCats.forEach(c => {
        if (!childMap[c.parent_id]) childMap[c.parent_id] = [];
        childMap[c.parent_id].push(c);
    });

    let html = '<div class="cat-mgmt-list">';

    parentCats.sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999)).forEach(parent => {
        html += buildCategoryCard(parent, true);
        const children = childMap[parent.id] || [];
        children.sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999)).forEach(child => {
            html += buildCategoryCard(child, false);
        });
    });

    // Orphan children (parent not in list)
    const parentIds = new Set(parentCats.map(p => p.id));
    childCats.filter(c => !parentIds.has(c.parent_id)).forEach(orphan => {
        html += buildCategoryCard(orphan, false);
    });

    html += '</div>';
    return html;
}

function buildCategoryCard(category, isParent) {
    const isInactive = (category.status || '').toLowerCase() === 'inactive';
    const statusLabel = isInactive ? 'Inactive' : 'Active';
    const statusClass = isInactive ? 'cat-status--inactive' : 'cat-status--active';
    const iconClass = category.icon || 'fas fa-folder';
    const indent = isParent ? '' : ' cat-card--child';
    const serviceCount = (window.servicesCache || []).filter(s => {
        const cat = String(s.category || '').toLowerCase();
        return cat === String(category.name || '').toLowerCase() || cat === String(category.slug || '').toLowerCase();
    }).length;

    return `
        <div class="cat-card${indent}" data-category-id="${category.id}" data-display-order="${category.display_order ?? 999}">
            <div class="cat-card__drag"><i class="fas fa-grip-vertical"></i></div>
            <div class="cat-card__icon"><i class="${escapeHtml(iconClass)}"></i></div>
            <div class="cat-card__body">
                <div class="cat-card__header">
                    <span class="cat-card__name">${isParent ? '' : '<span class="cat-card__indent">↳</span> '}${escapeHtml(category.name)}</span>
                    <span class="cat-card__status ${statusClass}">${statusLabel}</span>
                </div>
                <div class="cat-card__details">
                    ${category.slug ? `<span class="cat-card__detail"><i class="fas fa-link"></i> ${escapeHtml(category.slug)}</span>` : ''}
                    <span class="cat-card__detail"><i class="fas fa-sort-numeric-down"></i> Order: ${category.display_order ?? '—'}</span>
                    <span class="cat-card__detail"><i class="fas fa-box"></i> ${serviceCount} service${serviceCount !== 1 ? 's' : ''}</span>
                </div>
                ${category.description ? `<p class="cat-card__desc">${escapeHtml(category.description)}</p>` : ''}
            </div>
            <div class="cat-card__actions">
                <button type="button" class="cat-action-btn" onclick="openEditCategoryModal('${category.id}')" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button type="button" class="cat-action-btn cat-action-btn--danger" onclick="confirmDeleteCategory('${category.id}')" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
    `;
}

async function openEditCategoryModal(categoryId) {
    const categories = await fetchCategoriesList(false, { includeInactive: true });
    const category = categories.find(cat => String(cat.id) === String(categoryId));

    if (!category) {
        showNotification('Category not found', 'error');
        return;
    }

    const parentOptions = buildParentCategoryOptions(categories, category.parent_id || '', category.id);
    const content = `
        <form id="editCategoryForm" data-category-id="${category.id}" onsubmit="submitEditCategory(event)" class="admin-form">
            <div class="form-group">
                <label>Category Name *</label>
                <input type="text" name="categoryName" value="${escapeHtml(category.name)}" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Slug</label>
                    <input type="text" name="slug" value="${escapeHtml(category.slug || '')}" placeholder="instagram-pro">
                    <small style="color: #888;">Leave blank to auto-generate.</small>
                </div>
                <div class="form-group">
                    <label>Category Icon</label>
                    <input type="text" name="icon" value="${escapeHtml(category.icon || 'fas fa-folder')}" placeholder="fab fa-instagram">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Display Order</label>
                    <input type="number" name="order" value="${category.display_order ?? 1}" min="1">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status">
                        <option value="active" ${category.status === 'active' ? 'selected' : ''}>Active</option>
                        <option value="inactive" ${category.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Parent Category</label>
                <select name="parent">
                    ${parentOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea name="description" rows="2" placeholder="Category description...">${escapeHtml(category.description || '')}</textarea>
            </div>
        </form>
    `;

    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal(); setTimeout(() => manageCategories(), 200);">Back</button>
        <button type="submit" form="editCategoryForm" class="btn-primary">
            <i class="fas fa-save"></i> Save Changes
        </button>
    `;

    createModal('Edit Category', content, actions);
}

async function submitEditCategory(event) {
    event.preventDefault();
    const form = event.target;
    const categoryId = form.dataset.categoryId;
    const formData = new FormData(form);

    const payload = {
        action: 'update-category',
        categoryId,
        name: formData.get('categoryName'),
        slug: formData.get('slug') || undefined,
        description: formData.get('description') || '',
        icon: formData.get('icon') || 'fas fa-folder',
        status: (formData.get('status') || 'active').toLowerCase(),
        display_order: parseIntegerInput(formData.get('order')),
        parent_id: formData.get('parent') || null
    };

    const submitBtn = document.querySelector('button[form="editCategoryForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(buildAdminServicesUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await parseApiResponse(response);
        if (response.ok && data && data.success) {
            showNotification('Category updated successfully!', 'success');
            window.invalidateCategoriesCache('all');
            closeModal();
            setTimeout(() => manageCategories(true), 250);
        } else {
            const serverMessage = data && data.error ? data.error : `HTTP ${response.status} ${response.statusText}`;
            showNotification(serverMessage || 'Failed to update category', 'error');
        }
    } catch (error) {
        console.error('Update category error:', error);
        showNotification('Failed to update category. Please try again.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
        }
    }
}

function confirmDeleteCategory(categoryId) {
    const category = findCachedCategory(categoryId);
    if (!category) {
        showNotification('Category not found', 'error');
        return;
    }

    const content = `
        <form id="deleteCategoryForm" data-category-id="${category.id}" onsubmit="submitDeleteCategory(event)">
            <p>Are you sure you want to remove <strong>${escapeHtml(category.name)}</strong>?</p>
            <div class="form-group" style="margin-top: 12px;">
                <label style="display:flex; gap:8px; align-items:center;">
                    <input type="checkbox" name="hardDelete">
                    <span>Delete permanently (cannot be undone)</span>
                </label>
            </div>
        </form>
    `;

    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal(); setTimeout(() => manageCategories(), 200);">Cancel</button>
        <button type="submit" form="deleteCategoryForm" class="btn-primary" style="background:#ef4444; border-color:#ef4444;">
            <i class="fas fa-trash"></i> Delete
        </button>
    `;

    createModal('Delete Category', content, actions);
}

async function submitDeleteCategory(event) {
    event.preventDefault();
    const form = event.target;
    const categoryId = form.dataset.categoryId;
    const hardDelete = form.querySelector('input[name="hardDelete"]')?.checked || false;

    const submitBtn = document.querySelector('button[form="deleteCategoryForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
    }

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(buildAdminServicesUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'delete-category',
                categoryId,
                hardDelete
            })
        });

        const data = await parseApiResponse(response);
        if (response.ok && data && data.success) {
            showNotification(data.message || 'Category updated', 'success');
            window.invalidateCategoriesCache('all');
            closeModal();
            setTimeout(() => manageCategories(true), 250);
        } else {
            const serverMessage = data && data.error ? data.error : `HTTP ${response.status} ${response.statusText}`;
            showNotification(serverMessage || 'Failed to delete category', 'error');
        }
    } catch (error) {
        console.error('Delete category error:', error);
        showNotification('Failed to delete category. Please try again.', 'error');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
        }
    }
}

// Add subscription service
async function addSubscription() {
    const providers = await fetchProvidersList();
    const hasProviders = providers.length > 0;
    const providerOptions = hasProviders
        ? buildProviderOptions(providers)
        : '<option value="" disabled>No providers available</option>';

    const content = `
        <form id="addSubscriptionForm" onsubmit="submitAddSubscription(event)" class="admin-form">
            <div class="form-group">
                <label>Service Name *</label>
                <input type="text" name="serviceName" placeholder="Instagram Auto Likes" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Category *</label>
                    <select name="category" required>
                        <option value="instagram">Instagram</option>
                        <option value="tiktok">TikTok</option>
                        <option value="youtube">YouTube</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Provider ${hasProviders ? '*' : '(none available)'}</label>
                    <select name="provider" ${hasProviders ? 'required' : 'disabled'}>
                        ${providerOptions}
                    </select>
                    ${hasProviders ? '' : '<small style="color: #f87171;">Add a provider first to configure subscriptions.</small>'}
                </div>
            </div>
            <h4 style="margin: 20px 0 12px; color: #FF1494;">Subscription Settings</h4>
            <div class="form-row">
                <div class="form-group">
                    <label>Interval (minutes) *</label>
                    <input type="number" name="interval" value="60" min="1" required>
                </div>
                <div class="form-group">
                    <label>Posts Quantity *</label>
                    <input type="number" name="posts" value="10" min="1" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Min Quantity per Post *</label>
                    <input type="number" name="minQty" value="100" min="1" required>
                </div>
                <div class="form-group">
                    <label>Max Quantity per Post *</label>
                    <input type="number" name="maxQty" value="1000" min="1" required>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Delay (minutes)</label>
                    <input type="number" name="delay" value="0" min="0">
                </div>
                <div class="form-group">
                    <label>Expiry (days)</label>
                    <input type="number" name="expiry" value="30" min="1">
                </div>
            </div>
            <div class="form-group">
                <label>Rate per 1000 *</label>
                <input type="number" name="rate" placeholder="5.00" min="0" step="0.01" required>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="addSubscriptionForm" class="btn-primary" ${hasProviders ? '' : 'disabled'}>
            <i class="fas fa-sync-alt"></i> Create Subscription
        </button>
    `;
    
    createModal('Add Subscription Service', content, actions);
}

async function submitAddSubscription(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const subscriptionData = Object.fromEntries(formData);
    
    const submitBtn = document.querySelector('button[form="addSubscriptionForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }
    
    try {
        const token = localStorage.getItem('token');
    const response = await fetch(buildAdminServicesUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'create',
                name: subscriptionData.serviceName,
                category: subscriptionData.category,
                type: 'subscription',
                rate: parseFloat(subscriptionData.rate),
                min_quantity: parseInt(subscriptionData.minQty, 10),
                max_quantity: parseInt(subscriptionData.maxQty, 10),
                description: subscriptionData.description || '',
                status: 'active',
                providerId: subscriptionData.provider || null,
                metadata: {
                    intervalMinutes: parseInt(subscriptionData.interval, 10) || null,
                    postsQuantity: parseInt(subscriptionData.posts, 10) || null,
                    delayMinutes: parseInt(subscriptionData.delay, 10) || 0,
                    expiryDays: parseInt(subscriptionData.expiry, 10) || null,
                    planType: 'subscription'
                }
            })
        });
        
        const data = await parseApiResponse(response);
        if (response.ok && data && data.success) {
            showNotification('Subscription service created successfully!', 'success');
            closeModal();
            loadServices();
        } else {
            const serverMessage = data && data.error ? data.error : `HTTP ${response.status} ${response.statusText}`;
            console.error('Create subscription failed:', response.status, serverMessage, data);
            showNotification(serverMessage || 'Failed to create subscription', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Create Subscription';
            }
        }
    } catch (error) {
        console.error('Create subscription error:', error);
        showNotification('Failed to create subscription. Please try again.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Create Subscription';
        }
    }
}

async function submitEditService(event, serviceId) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const serviceData = Object.fromEntries(formData);
    
    console.debug('[DEBUG] editServiceForm serviceData:', serviceData);

    const retailRateValue = parseNumberInput(serviceData.rate);
    const providerRateValue = parseNumberInput(serviceData.providerRate);
    const markupValue = parseNumberInput(serviceData.markup);
    const providerRateRaw = (serviceData.providerRate ?? '').toString().trim();
    const markupRaw = (serviceData.markup ?? '').toString().trim();
    const minQuantityValue = parseIntegerInput(serviceData.min);
    const maxQuantityValue = parseIntegerInput(serviceData.max);
    const customerPortalEnabledFlag = toBooleanInput(serviceData.customerPortalEnabled);
    const customerPortalSlotValue = normalizePortalSlotInput(serviceData.customerPortalSlot);
    const customerPortalNotesValue = (serviceData.customerPortalNotes || '').trim();
    const refillSupportedFlag = toBooleanInput(serviceData.refill_supported);
    const cancelSupportedFlag = toBooleanInput(serviceData.cancel_supported);
    const dripfeedSupportedFlag = toBooleanInput(serviceData.dripfeed_supported);
    const subscriptionSupportedFlag = toBooleanInput(serviceData.subscription_supported);
    const overflowPercentValue = parseNumberInput(serviceData.overflowPercent);
    const numericServiceId = Number.isFinite(Number(serviceId)) ? Number(serviceId) : serviceId;
    const payload = {
        serviceId: numericServiceId,
        name: serviceData.serviceName,
        category: serviceData.category,
        type: serviceData.type || 'service',
        min_quantity: Number.isFinite(minQuantityValue) ? minQuantityValue : null,
        max_quantity: Number.isFinite(maxQuantityValue) ? maxQuantityValue : null,
        description: serviceData.description || '',
        status: (serviceData.status || 'active').toLowerCase(),
        providerId: serviceData.provider || null,
        providerServiceId: (serviceData.providerServiceId || '').trim() || null,
        adminApproved: customerPortalEnabledFlag,
        customerPortalEnabled: customerPortalEnabledFlag,
        customerPortalSlot: customerPortalSlotValue,
        customerPortalNotes: customerPortalNotesValue || null,
        refill_supported: refillSupportedFlag,
        cancel_supported: cancelSupportedFlag,
        dripfeed_supported: dripfeedSupportedFlag,
        subscription_supported: subscriptionSupportedFlag,
        overflowPercent: overflowPercentValue
    };

    if (retailRateValue !== null) {
        payload.rate = retailRateValue;
        payload.retailRate = retailRateValue;
    }

    if (providerRateRaw === '') {
        payload.providerRate = null;
    } else if (providerRateValue !== null) {
        payload.providerRate = providerRateValue;
    }

    if (markupRaw === '') {
        payload.markupPercentage = null;
    } else if (markupValue !== null) {
        payload.markupPercentage = markupValue;
    }
    
    const submitBtn = document.querySelector('button[form="editServiceForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    }
    
    try {
        const token = localStorage.getItem('token');
        // Debug: log final payload and token presence to help server-side debugging
        try {
            console.debug('[DEBUG] submitEditService final payload:', JSON.parse(JSON.stringify(payload)));
            console.debug('[DEBUG] token present:', !!token);
        } catch (e) {
            /* ignore logging errors */
        }
    const response = await fetch(buildAdminServicesUrl(), {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        
        // Parse response robustly (handle non-JSON errors too)
        let data = null;
        try {
            const ct = response.headers.get('content-type') || '';
            if (ct.includes('application/json')) {
                data = await response.json();
            } else {
                const text = await response.text();
                data = { success: response.ok, error: text };
            }
        } catch (parseErr) {
            console.error('Failed to parse response body', parseErr);
            data = { success: response.ok, error: `HTTP ${response.status} ${response.statusText}` };
        }

        if (!response.ok || !data || !data.success) {
            const serverMessage = data && data.error ? data.error : `HTTP ${response.status} ${response.statusText}`;
            console.error('Update service failed:', response.status, serverMessage, data);
            showNotification(serverMessage || 'Failed to update service', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
            }
        } else {
            showNotification(`Service #${serviceId} updated successfully!`, 'success');
            closeModal();
            await loadServices();
        }
    } catch (error) {
        console.error('Update service error:', error);
        showNotification(error.message || 'Failed to update service. Please try again.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
        }
    }
}

// Duplicate service
function duplicateService(serviceId) {
    const content = `
        <div class="confirmation-message">
            <i class="fas fa-copy" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>Duplicate service #${serviceId}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will create an exact copy of the service. You can edit it after creation.
            </p>
        </div>
    `;
    
    const safeId = String(serviceId).replace(/'/g, "\\'");
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="confirmDuplicateService('${safeId}')">
            <i class="fas fa-copy"></i> Duplicate Service
        </button>
    `;
    
    createModal('Duplicate Service', content, actions);
}

async function confirmDuplicateService(serviceId) {
    try {
        const token = localStorage.getItem('token');
        const numericServiceId = Number.isFinite(Number(serviceId)) ? Number(serviceId) : serviceId;
        const bodyPayload = { action: 'duplicate', serviceId: numericServiceId };
        try {
            console.debug('[DEBUG] confirmDuplicateService payload:', bodyPayload, 'token present:', !!token);
        } catch (e) {/* ignore */}

    const response = await fetch(buildAdminServicesUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(bodyPayload)
        });
        
        const data = await parseApiResponse(response);
        if (response.ok && data && data.success) {
            showNotification(`Service #${serviceId} duplicated successfully!`, 'success');
            closeModal();
            reloadServicesPreserveScroll();
        } else {
            const serverMessage = data && data.error ? data.error : `HTTP ${response.status} ${response.statusText}`;
            console.error('Duplicate service failed:', response.status, serverMessage, data);
            showNotification(serverMessage || 'Failed to duplicate service', 'error');
        }
    } catch (error) {
        console.error('Duplicate service error:', error);
        showNotification('Failed to duplicate service. Please try again.', 'error');
    }
}

// Toggle service status
function toggleService(serviceId) {
    const service = getServiceById(serviceId);
    if (!service) {
        showNotification('Service not found. Please refresh and try again.', 'error');
        return;
    }

    const currentlyCurated = Boolean(service.customer_portal_enabled);
    // No portal slot limits - unlimited curation supported

    const actionVerb = currentlyCurated ? 'Remove from Customer Portal' : 'Feature in Customer Portal';
    const iconClass = currentlyCurated ? 'fas fa-eye-slash' : 'fas fa-eye';
    const description = currentlyCurated
        ? 'This service will stay in your catalog but disappear from the public order form.'
    : `Customers will see this service in the curated dropdown ${PORTAL_SLOT_SHORT_NOTE}.`;

    const content = `
        <div class="confirmation-message">
            <i class="${iconClass}" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>${actionVerb} for service <strong>#${serviceId}</strong>?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">${description}</p>
        </div>
    `;
    
    const safeId = String(serviceId).replace(/'/g, "\\'");
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" id="toggleVisibilityConfirm" onclick="confirmToggleService('${safeId}')">
            <i class="${iconClass}"></i> ${actionVerb}
        </button>
    `;
    
    createModal('Customer Portal Visibility', content, actions);
}

async function confirmToggleService(serviceId) {
    const service = getServiceById(serviceId);
    if (!service) {
        showNotification('Service not found. Please refresh and try again.', 'error');
        return;
    }

    const targetState = !Boolean(service.customer_portal_enabled);
    const confirmButtonLabel = targetState
        ? '<i class="fas fa-eye"></i> Feature in Customer Portal'
        : '<i class="fas fa-eye-slash"></i> Remove from Customer Portal';
    const confirmButton = document.querySelector('#toggleVisibilityConfirm');
    if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
    }

    // Unlimited customer service curation - no slot limit checks needed

    let desiredSlot = normalizePortalSlotInput(service.customer_portal_slot);
    if (targetState && !Number.isFinite(desiredSlot)) {
        desiredSlot = getNextAvailablePortalSlot(service.id);
    }
    if (!targetState) {
        desiredSlot = null;
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Missing admin authentication token');
        }

        const numericServiceId = Number.isFinite(Number(serviceId)) ? Number(serviceId) : serviceId;
        const bodyPayload = {
            serviceId: numericServiceId,
            adminApproved: targetState,
            customerPortalEnabled: targetState,
            customerPortalSlot: desiredSlot
        };
        try {
            console.debug('[DEBUG] confirmToggleService payload:', bodyPayload, 'token present:', !!token);
        } catch (e) {/* ignore */}

        const response = await fetch(buildAdminServicesUrl(), {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(bodyPayload)
        });

        const data = await parseApiResponse(response);
        if (!response.ok || !data || !data.success) {
            const serverMessage = data && data.error ? data.error : `HTTP ${response.status} ${response.statusText}`;
            console.error('Toggle service visibility failed:', response.status, serverMessage, data);
            showNotification(serverMessage || 'Failed to update visibility. Please try again.', 'error');
            if (confirmButton) {
                confirmButton.disabled = false;
                confirmButton.innerHTML = confirmButtonLabel;
            }
            return;
        }

        showNotification(`Service #${serviceId} ${targetState ? 'added to the customer portal.' : 'removed from the customer portal.'}`, 'success');
        closeModal();
        await loadServices();
    } catch (error) {
        console.error('Toggle service visibility error:', error);
        showNotification(error.message || 'Failed to update visibility. Please try again.', 'error');
        if (confirmButton) {
            confirmButton.disabled = false;
            confirmButton.innerHTML = confirmButtonLabel;
        }
    }
}

// Delete service
function deleteService(serviceId) {
    const content = `
        <div class="confirmation-message danger">
            <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #ef4444; margin-bottom: 20px;"></i>
            <p>Delete service #${serviceId}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will permanently delete the service. This action cannot be undone.
            </p>
        </div>
    `;
    
    const safeId = String(serviceId).replace(/'/g, "\\'");
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-danger" onclick="confirmDeleteService('${safeId}')">
            <i class="fas fa-trash"></i> Delete Service
        </button>
    `;
    
    createModal('Delete Service', content, actions);
}

async function confirmDeleteService(serviceId) {
    try {
        const token = localStorage.getItem('token');
        const numericServiceId = Number.isFinite(Number(serviceId)) ? Number(serviceId) : serviceId;
        const bodyPayload = { serviceId: numericServiceId };
        try {
            console.debug('[DEBUG] confirmDeleteService payload:', bodyPayload, 'token present:', !!token);
        } catch (e) {/* ignore */}

    const response = await fetch(buildAdminServicesUrl(), {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(bodyPayload)
        });
        
        const data = await parseApiResponse(response);
        if (response.ok && data && data.success) {
            showNotification(`Service #${serviceId} deleted successfully`, 'success');
            closeModal();
            reloadServicesPreserveScroll();
        } else {
            const serverMessage = data && data.error ? data.error : `HTTP ${response.status} ${response.statusText}`;
            console.error('Delete service failed:', response.status, serverMessage, data);
            showNotification(serverMessage || 'Failed to delete service', 'error');
        }
    } catch (error) {
        console.error('Delete service error:', error);
        showNotification('Failed to delete service. Please try again.', 'error');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initializeServicesQuickActions();
    await loadServices();
    initServicesFilter();
    initInlineEditing();
});

// Load real services from database
async function loadServices() {
    const tbody = document.getElementById('servicesTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading services...</td></tr>';

    try {
        const token = localStorage.getItem('token');
    const response = await fetch(buildAdminServicesUrl(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

    const data = await response.json();
    servicesCache = Array.isArray(data.services) ? data.services : [];
    // Expose cache globally for DnD module lookups
    window.servicesCache = servicesCache;
    pruneSelectedServiceIds();

        if (servicesCache.length > 0) {
            tbody.innerHTML = '';
            
            // Group services by category hierarchy
            const groupedByCategory = groupServicesWithHierarchy(servicesCache);
            
            let activeCount = 0;
            let lastRenderedParent = null;
            let lastRenderedChild = null;
            
            // Sort groups: within each child category by customer_portal_slot (1,2,3..)
            groupedByCategory.sort((a, b) => {
                const pa = String(a.parentCategory || '').toLowerCase();
                const pb = String(b.parentCategory || '').toLowerCase();
                if (pa !== pb) return pa.localeCompare(pb);
                const ca = String(a.childCategory || '').toLowerCase();
                const cb = String(b.childCategory || '').toLowerCase();
                if (ca !== cb) return ca.localeCompare(cb);
                const sa = toNumeric(a.service?.customer_portal_slot);
                const sb = toNumeric(b.service?.customer_portal_slot);
                const na = Number.isFinite(sa) ? sa : Number.MAX_SAFE_INTEGER;
                const nb = Number.isFinite(sb) ? sb : Number.MAX_SAFE_INTEGER;
                if (na !== nb) return na - nb;
                // secondary tie-breaker: name
                const naName = String(a.service?.name || '').toLowerCase();
                const nbName = String(b.service?.name || '').toLowerCase();
                return naName.localeCompare(nbName);
            });

            // Render services grouped by category in sorted order
            groupedByCategory.forEach(group => {
                // Render parent category header if different from last
                if (group.parentCategory && group.parentCategory !== lastRenderedParent) {
                    tbody.insertAdjacentHTML('beforeend', buildCategoryHeaderRow(group.parentCategory, group.parentIcon, true));
                    lastRenderedParent = group.parentCategory;
                    lastRenderedChild = null;
                }
                
                // Render child category header if applicable
                if (group.childCategory && group.childCategory !== lastRenderedChild) {
                    tbody.insertAdjacentHTML('beforeend', buildCategoryHeaderRow(group.childCategory, group.childIcon, false, group.parentCategory));
                    lastRenderedChild = group.childCategory;
                }
                
                // Render the service row
                const service = group.service;
                if (service.status === 'active') activeCount++;

        const serviceIdRaw = service.id !== undefined && service.id !== null ? String(service.id) : '';
        const publicIdRaw = service.public_id !== undefined && service.public_id !== null ? String(service.public_id) : '';
        const serviceIdAttr = escapeHtml(serviceIdRaw);
        const publicIdAttr = escapeHtml(publicIdRaw);
        const ariaLabelId = serviceIdRaw ? `Select service ${serviceIdRaw}` : 'Select service';
                
                const statusClass = service.status === 'active' ? 'completed' : 'pending';
                const isPortalEnabled = Boolean(service.customer_portal_enabled);
                const isAdminApproved = Boolean(service.admin_approved);
                const portalSlotValue = toNumeric(service.customer_portal_slot);
                const isCustomerVisible = isPortalEnabled && isAdminApproved;
                const visibilityClass = isCustomerVisible ? 'completed' : isPortalEnabled ? 'pending' : 'pending';
                const visibilityLabel = isCustomerVisible
                    ? (Number.isFinite(portalSlotValue) ? `Customer Portal · Slot #${portalSlotValue}` : 'Customer Portal')
                    : isPortalEnabled
                        ? 'Portal Enabled (awaiting approval)'
                        : 'Hidden from Customers';
                const toggleActionLabel = isCustomerVisible ? 'Remove from Portal' : 'Feature in Portal';
                const icon = service.category === 'instagram' ? 'fab fa-instagram' :
                           service.category === 'tiktok' ? 'fab fa-tiktok' :
                           service.category === 'youtube' ? 'fab fa-youtube' :
                           service.category === 'twitter' ? 'fab fa-twitter' :
                           service.category === 'facebook' ? 'fab fa-facebook' :
                           'fas fa-box';

                const isManualService = isAdminCreatedService(service);
                const publicIdValue = toNumeric(service.public_id);
                const hasPublicId = Number.isFinite(publicIdValue);
                const ourIdLabel = hasPublicId ? `${publicIdValue}` : 'Pending';
                const providerIdRaw = service.provider_service_id ? String(service.provider_service_id) : '';
                const providerId = providerIdRaw ? escapeHtml(providerIdRaw) : null;
                const providerLabel = providerId ? providerId : 'Provider order pending';

                const providerMarkupRaw = toNumeric(service.provider?.markup);
                const serviceMarkupOverride = toNumeric(service.markup_percentage ?? service.markup);
                let markupPercent = Number.isFinite(serviceMarkupOverride)
                    ? serviceMarkupOverride
                    : Number.isFinite(providerMarkupRaw)
                        ? providerMarkupRaw
                        : DEFAULT_MARKUP_PERCENT;

                if (!Number.isFinite(markupPercent) || markupPercent <= -100) {
                    markupPercent = DEFAULT_MARKUP_PERCENT;
                }

                const markupFactor = 1 + markupPercent / 100;

                let providerCost = toNumeric(
                    service.provider_rate ??
                    service.provider_cost ??
                    service.raw_rate ??
                    service.rate
                );

                const storedRetailRate = toNumeric(
                    service.retail_rate ??
                    service.customer_rate ??
                    service.catalog_rate ??
                    service.price ??
                    service.public_rate ??
                    null
                );

                let retailRateValue = Number.isFinite(storedRetailRate)
                    ? storedRetailRate
                    : Number.isFinite(providerCost)
                        ? providerCost * markupFactor
                        : null;

                if (!Number.isFinite(providerCost) && Number.isFinite(retailRateValue) && markupFactor !== 0) {
                    providerCost = retailRateValue / markupFactor;
                }

                const currencyCode = (service.currency || 'USD').toUpperCase();
                const providerRateDisplay = formatRatePerThousand(providerCost, currencyCode);
                const retailRateDisplay = formatRatePerThousand(retailRateValue, currencyCode);
                const calculatedMarkup = Number.isFinite(providerCost) && Number.isFinite(retailRateValue)
                    ? calculateMarkupPercent(providerCost, retailRateValue)
                    : markupPercent;
                const markupDisplay = Number.isFinite(calculatedMarkup)
                    ? `${calculatedMarkup >= 0 ? '+' : ''}${calculatedMarkup.toFixed(1)}%`
                    : '—';

                const categoryRaw = String(service.category || 'Default');
                const categoryLabel = categoryRaw.charAt(0).toUpperCase() + categoryRaw.slice(1);
                const minQuantity = formatQuantityValue(service.min_quantity);
                const maxQuantity = (service.max_quantity === null || service.max_quantity === undefined)
                    ? 'Unlimited'
                    : formatQuantityValue(service.max_quantity);
                const providerName = service.provider?.name ? escapeHtml(service.provider.name) : 'Manual';
                const serviceMetaMarkup = `<div class="service-info-badges"><span class="info-badge info-badge--category"><i class="${icon}"></i> ${escapeHtml(categoryLabel)}</span><span class="info-badge info-badge--provider"><i class="fas fa-server"></i> ${providerName}</span></div>`;
                
                const row = `
                    <tr data-service-id="${serviceIdAttr}" data-public-id="${publicIdAttr}" data-category="${service.category ? String(service.category) : 'uncategorized'}" data-provider="${providerName}" data-status="${service.status || 'unknown'}">
                        <td><input type="checkbox" class="service-checkbox" data-service-id="${serviceIdAttr}" data-public-id="${publicIdAttr}" data-category="${service.category ? String(service.category) : 'uncategorized'}" aria-label="${escapeHtml(ariaLabelId)}"></td>
                        <td>
                            <div class="id-badges">
                                <span class="id-badge id-badge--public" title="Public ID">${ourIdLabel}</span>
                                <span class="id-badge id-badge--provider" title="Provider ID">${escapeHtml(providerLabel)}</span>
                            </div>
                        </td>
                        <td>
                            <div class="service-name">
                                <i class="${icon}"></i>
                                ${escapeHtml(service.name)}
                            </div>
                            ${serviceMetaMarkup}
                        </td>
                        <td class="editable-cell" data-field="rate" data-service-id="${serviceIdAttr}">
                            <div class="cell-stack cell-stack-right">
                                <span class="cell-primary cell-retail">$${retailRateValue != null ? formatTrimZeros(retailRateValue, 10) : '—'}</span>
                                <span class="cell-secondary">Cost: $${Number.isFinite(providerCost) ? formatTrimZeros(providerCost, 10) : '—'}</span>
                                <span class="cell-secondary cell-markup">Markup: ${markupDisplay}</span>
                            </div>
                        </td>
                        <td class="editable-cell" data-field="min_quantity" data-service-id="${serviceIdAttr}">${minQuantity}</td>
                        <td class="editable-cell" data-field="max_quantity" data-service-id="${serviceIdAttr}">${maxQuantity}</td>
                        <td>
                            <span class="status-badge ${statusClass}">${escapeHtml(String(service.status || 'unknown'))}</span>
                        </td>
                        <td>
                            <div class="actions-cell">
                                <button class="action-icon-btn" onclick="editService('${service.id}')" title="Edit"><i class="fas fa-edit"></i></button>
                                <button class="action-icon-btn" onclick="duplicateService('${service.id}')" title="Duplicate"><i class="fas fa-copy"></i></button>
                                <button class="action-icon-btn action-danger" onclick="deleteService('${service.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                            </div>
                        </td>
                    </tr>
                `;
                tbody.insertAdjacentHTML('beforeend', row);
            });

            restoreServiceSelectionState();
            bindServiceSelectionEvents();
            updateSelectedServicesSummary();
            
            // Update stats
            document.getElementById('totalServices').textContent = servicesCache.length;
            document.getElementById('activeServices').textContent = activeCount;
            document.getElementById('lastSync').textContent = new Date().toLocaleDateString();
            
            // Update pagination
            const paginationInfo = document.getElementById('paginationInfo');
            if (paginationInfo) {
                paginationInfo.textContent = `Showing 1-${Math.min(servicesCache.length, 50)} of ${servicesCache.length}`;
            }
        } else {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #888;">No services found</td></tr>';
            document.getElementById('totalServices').textContent = '0';
            document.getElementById('activeServices').textContent = '0';
            selectedServiceIds.clear();
            updateSelectedServicesSummary();
        }
    } catch (error) {
        console.error('Load services error:', error);
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load services. Please refresh the page.</td></tr>';
        selectedServiceIds.clear();
        updateSelectedServicesSummary();
    }
}

// Expose loadServices globally for DnD module
window.loadServices = loadServices;

// ==========================================
// Scroll-preserving reload
// ==========================================
async function reloadServicesPreserveScroll() {
    const container = document.querySelector('.table-container');
    const scrollPos = container ? container.scrollTop : 0;
    const pageScrollPos = window.scrollY;
    await loadServices();
    populateFilterDropdowns();
    applyFilters();
    if (container) container.scrollTop = scrollPos;
    window.scrollTo(0, pageScrollPos);
}

// ==========================================
// Filter bar logic
// ==========================================
let filterDebounceTimer = null;

function initServicesFilter() {
    const searchInput = document.getElementById('serviceSearch');
    const filterCategory = document.getElementById('filterCategory');
    const filterStatus = document.getElementById('filterStatus');
    const filterProvider = document.getElementById('filterProvider');

    if (searchInput) {
        searchInput.addEventListener('keyup', () => {
            clearTimeout(filterDebounceTimer);
            filterDebounceTimer = setTimeout(applyFilters, 300);
        });
    }
    if (filterCategory) filterCategory.addEventListener('change', applyFilters);
    if (filterStatus) filterStatus.addEventListener('change', applyFilters);
    if (filterProvider) filterProvider.addEventListener('change', applyFilters);

    populateFilterDropdowns();
}

function populateFilterDropdowns() {
    const cache = window.servicesCache || [];
    const categories = new Set();
    const providers = new Set();

    cache.forEach(s => {
        if (s.category) categories.add(String(s.category));
        const pName = s.provider?.name || (s.provider_service_id ? 'External' : 'Manual');
        providers.add(pName);
    });

    const catSelect = document.getElementById('filterCategory');
    if (catSelect) {
        const current = catSelect.value;
        catSelect.innerHTML = '<option value="">All Categories</option>';
        [...categories].sort().forEach(c => {
            catSelect.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c.charAt(0).toUpperCase() + c.slice(1))}</option>`;
        });
        catSelect.value = current;
    }

    const provSelect = document.getElementById('filterProvider');
    if (provSelect) {
        const current = provSelect.value;
        provSelect.innerHTML = '<option value="">All Providers</option>';
        [...providers].sort().forEach(p => {
            provSelect.innerHTML += `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`;
        });
        provSelect.value = current;
    }
}

function applyFilters() {
    const searchVal = (document.getElementById('serviceSearch')?.value || '').toLowerCase().trim();
    const catVal = document.getElementById('filterCategory')?.value || '';
    const statusVal = document.getElementById('filterStatus')?.value || '';
    const provVal = document.getElementById('filterProvider')?.value || '';

    const searchTerms = searchVal ? searchVal.split(',').map(t => t.trim()).filter(Boolean) : [];

    const rows = document.querySelectorAll('#servicesTableBody tr');
    const visibleCategories = new Set();

    rows.forEach(row => {
        // Skip category header rows — we'll handle visibility after
        if (row.classList.contains('category-header-row')) return;

        const rowCategory = row.getAttribute('data-category') || '';
        const rowProvider = row.getAttribute('data-provider') || '';
        const rowStatus = row.getAttribute('data-status') || '';
        const rowText = row.textContent.toLowerCase();

        let show = true;

        if (catVal && rowCategory !== catVal) show = false;
        if (statusVal && rowStatus !== statusVal) show = false;
        if (provVal && rowProvider !== provVal) show = false;
        if (searchTerms.length > 0) {
            const matchesSearch = searchTerms.some(term => rowText.includes(term));
            if (!matchesSearch) show = false;
        }

        row.style.display = show ? '' : 'none';
        if (show) visibleCategories.add(rowCategory);
    });

    // Show/hide category headers based on whether any of their services are visible
    rows.forEach(row => {
        if (!row.classList.contains('category-header-row')) return;
        const headerCat = row.getAttribute('data-category') || '';
        // Show if any category filter matches or if we have visible services in this category
        const hasVisibleServices = visibleCategories.has(headerCat);
        row.style.display = hasVisibleServices ? '' : 'none';
    });
}

// ==========================================
// Inline editing
// ==========================================
function initInlineEditing() {
    const tbody = document.getElementById('servicesTableBody');
    if (!tbody) return;

    tbody.addEventListener('click', (e) => {
        const td = e.target.closest('.editable-cell');
        if (!td || td.querySelector('.inline-edit-input, .inline-edit-select')) return;
        startCellEdit(td);
    });
}

function startCellEdit(td) {
    const field = td.getAttribute('data-field');
    const serviceId = td.getAttribute('data-service-id');
    if (!field || !serviceId) return;

    // Get original raw value (strip locale formatting like commas)
    let originalValue = '';
    if (field === 'rate') {
        const retailSpan = td.querySelector('.cell-retail');
        if (retailSpan) {
            originalValue = retailSpan.textContent.replace(/[^0-9.]/g, '');
        }
    } else {
        const rawText = td.textContent.trim();
        // Strip commas from locale-formatted numbers (e.g. "1,000" → "1000")
        if (rawText.toLowerCase() === 'unlimited' || rawText === '—') {
            originalValue = rawText;
        } else {
            originalValue = rawText.replace(/,/g, '');
        }
    }

    // Store original HTML for cancel
    td._originalHTML = td.innerHTML;
    td._originalValue = originalValue;

    if (field === 'status') {
        const select = document.createElement('select');
        select.className = 'inline-edit-select';
        select.innerHTML = `<option value="active"${originalValue === 'active' ? ' selected' : ''}>Active</option><option value="inactive"${originalValue === 'inactive' ? ' selected' : ''}>Inactive</option>`;
        td.innerHTML = '';
        td.appendChild(select);
        select.focus();
        select.addEventListener('change', () => saveCellEdit(td, serviceId, field, select.value));
        select.addEventListener('blur', () => {
            setTimeout(() => {
                if (td.contains(select)) cancelCellEdit(td);
            }, 150);
        });
        select.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') cancelCellEdit(td);
        });
    } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'inline-edit-input';
        input.value = originalValue;
        td.innerHTML = '';
        td.appendChild(input);
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveCellEdit(td, serviceId, field, input.value);
            }
            if (e.key === 'Escape') cancelCellEdit(td);
        });
        input.addEventListener('blur', () => {
            setTimeout(() => {
                if (td.contains(input)) saveCellEdit(td, serviceId, field, input.value);
            }, 150);
        });
    }
}

async function saveCellEdit(td, serviceId, field, newValue) {
    const originalValue = td._originalValue;
    // Strip commas from input too for comparison
    const cleanNew = String(newValue).replace(/,/g, '').trim();
    const cleanOrig = String(originalValue).replace(/,/g, '').trim();
    if (cleanNew === cleanOrig) {
        cancelCellEdit(td);
        return;
    }

    // Build update payload
    const payload = { serviceId };

    if (field === 'rate') {
        payload.retail_rate = parseFloat(cleanNew) || 0;
    } else if (field === 'min_quantity') {
        payload.min_quantity = parseInt(cleanNew, 10) || 0;
    } else if (field === 'max_quantity') {
        const val = cleanNew.toLowerCase();
        payload.max_quantity = (val === 'unlimited' || val === '—' || val === '') ? null : (parseInt(cleanNew, 10) || 0);
    } else if (field === 'status') {
        payload.status = newValue;
    } else {
        payload[field] = newValue;
    }

    // Show saving indicator
    const savingHTML = td.innerHTML;
    td.innerHTML = '<i class="fas fa-spinner fa-spin" style="color: var(--admin-primary);"></i>';

    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/services', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            // Flash green to indicate success
            td.classList.add('cell-save-flash');
            setTimeout(() => td.classList.remove('cell-save-flash'), 600);
            // Reload to get fresh data
            reloadServicesPreserveScroll();
        } else {
            const err = await response.json().catch(() => null);
            showNotification(err?.error || 'Failed to save', 'error');
            cancelCellEdit(td);
        }
    } catch (error) {
        console.error('Inline edit save error:', error);
        showNotification('Failed to save changes', 'error');
        cancelCellEdit(td);
    }
}

function cancelCellEdit(td) {
    if (td._originalHTML) {
        td.innerHTML = td._originalHTML;
        delete td._originalHTML;
        delete td._originalValue;
    }
}

// ==========================================
// Page actions "More" dropdown toggle
// ==========================================
function togglePageActionsMore(e) {
    e.stopPropagation();
    const moreContainer = document.getElementById('pageActionsMore');
    if (!moreContainer) return;
    moreContainer.classList.toggle('open');

    // Close on outside click
    const closeHandler = (ev) => {
        if (!moreContainer.contains(ev.target)) {
            moreContainer.classList.remove('open');
            document.removeEventListener('click', closeHandler);
        }
    };
    if (moreContainer.classList.contains('open')) {
        setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }
}

// ==========================================
// Category Drag & Drop reordering
// ==========================================
let categorySortableInstance = null;

function initCategoryDragDrop() {
    setTimeout(() => {
        const list = document.querySelector('.cat-mgmt-list');
        if (!list) return;
        if (categorySortableInstance) {
            categorySortableInstance.destroy();
            categorySortableInstance = null;
        }
        categorySortableInstance = Sortable.create(list, {
            handle: '.cat-card__drag',
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            animation: 150,
            onEnd: handleCategoryReorder
        });
    }, 100);
}

async function handleCategoryReorder() {
    const list = document.querySelector('.cat-mgmt-list');
    if (!list) return;

    const cards = list.querySelectorAll('.cat-card');
    const updates = [];
    let order = 1;

    cards.forEach(card => {
        const categoryId = card.getAttribute('data-category-id');
        const oldOrder = parseInt(card.getAttribute('data-display-order'), 10) || 999;
        if (categoryId) {
            if (order !== oldOrder) {
                updates.push({ categoryId, display_order: order });
            }
            // Update data attribute immediately
            card.setAttribute('data-display-order', order);
            // Update visible order text
            const orderDetail = card.querySelector('.cat-card__detail i.fa-sort-numeric-down');
            if (orderDetail && orderDetail.parentElement) {
                orderDetail.parentElement.innerHTML = `<i class="fas fa-sort-numeric-down"></i> Order: ${order}`;
            }
            order++;
        }
    });

    if (updates.length === 0) return;

    try {
        const token = localStorage.getItem('token');
        const promises = updates.map(u =>
            fetch(buildAdminServicesUrl(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    action: 'update-category',
                    categoryId: u.categoryId,
                    display_order: u.display_order
                })
            })
        );
        await Promise.all(promises);
        showNotification('Category order updated', 'success');
        // Invalidate cache
        if (window.invalidateCategoriesCache) window.invalidateCategoriesCache('all');
    } catch (error) {
        console.error('Category reorder error:', error);
        showNotification('Failed to save category order', 'error');
    }
}

// ==========================================
// Show Synced Services from Provider
// ==========================================

async function showSyncedServices() {
    const providerSelect = document.querySelector('#addServiceProviderSelect');
    const providerId = providerSelect?.value;
    
    if (!providerId) {
        showNotification('Please select a provider first', 'error');
        return;
    }
    
    const provider = providersCache.find(p => p.id == providerId);
    if (!provider) {
        showNotification('Provider not found', 'error');
        return;
    }
    
    // Show loading modal
    createModal('Loading Services...', '<div style="text-align: center; padding: 40px;"><div style="display: inline-block; width: 50px; height: 50px; border: 4px solid rgba(255,20,148,0.2); border-top-color: #FF1494; border-radius: 50%; animation: spin 1s linear infinite;"></div><p style="margin-top: 20px;">Fetching services from provider...</p></div>');
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/providers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'sync',
                providerId: providerId
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to fetch services');
        }
        
        const services = data.services || [];
        
        if (services.length === 0) {
            createModal('No Services Found', '<p style="text-align: center; padding: 20px;">No services found from this provider. Try syncing the provider first.</p>', '<button class="btn-primary" onclick="closeModal()">OK</button>');
            return;
        }
        
        // Build services selection table
        let tableHTML = `
            <div style="max-height: 500px; overflow-y: auto;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead style="position: sticky; top: 0; background: #1e293b; z-index: 1;">
                        <tr>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #334155;">ID</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #334155;">Service Name</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #334155;">Rate</th>
                            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #334155;">Action</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        services.forEach(service => {
            const serviceId = service.service || service.id || 'N/A';
            const serviceName = escapeHtml(service.name || 'Unnamed Service');
            const rate = formatTrimZeros(parseFloat(service.rate || 0), 2);
            
            tableHTML += `
                <tr style="border-bottom: 1px solid #334155;">
                    <td style="padding: 12px;">${escapeHtml(String(serviceId))}</td>
                    <td style="padding: 12px;">${serviceName}</td>
                    <td style="padding: 12px;">$${rate}/1k</td>
                    <td style="padding: 12px; text-align: center;">
                        <button onclick="selectSyncedService('${escapeHtml(String(serviceId))}', '${serviceName.replace(/'/g, "\\'")}', ${rate})" class="btn-primary btn-sm">
                            Select
                        </button>
                    </td>
                </tr>
            `;
        });
        
        tableHTML += `
                    </tbody>
                </table>
            </div>
        `;
        
        createModal(`Select Service from ${provider.name}`, tableHTML, '<button class="btn-secondary" onclick="closeModal()">Cancel</button>');
        
    } catch (error) {
        console.error('Failed to load synced services:', error);
        createModal('Error', `<p style="text-align: center; padding: 20px; color: #ef4444;">${error.message}</p>`, '<button class="btn-primary" onclick="closeModal()">OK</button>');
    }
}

function selectSyncedService(serviceId, serviceName, rate) {
    // Fill the form with selected service data
    const serviceIdInput = document.querySelector('#providerServiceIdInput');
    const serviceNameInput = document.querySelector('input[name="serviceName"]');
    const rateInput = document.querySelector('input[name="rate"]');
    const providerRateInput = document.querySelector('input[name="providerRate"]');
    
    if (serviceIdInput) serviceIdInput.value = serviceId;
    if (serviceNameInput) serviceNameInput.value = serviceName;
    if (rateInput) rateInput.value = rate;
    if (providerRateInput) providerRateInput.value = rate;

    const addServiceForm = document.querySelector('#addServiceForm');
    if (addServiceForm) {
        updateMarkupForForm(addServiceForm, { force: true });
    }
    
    closeModal();
    showNotification('Service selected! Update other fields as needed.', 'success');
}

function onProviderChange(providerId) {
    // Optional: Could auto-clear or validate fields when provider changes
    console.log('Provider changed to:', providerId);
}

// Auto-fetch service details from provider API when service ID is entered
async function autoFetchServiceDetails() {
    // Support both add and edit modals
    const serviceIdInput = document.querySelector('#providerServiceIdInput') || document.querySelector('#editProviderServiceIdInput');
    const providerSelect = document.querySelector('#addServiceProviderSelect') || document.querySelector('select[name="provider"]');
    
    if (!serviceIdInput || !providerSelect) {
        showNotification('Provider or Service ID field not found', 'error');
        return;
    }
    
    const serviceId = serviceIdInput.value.trim();
    const providerId = providerSelect.value;
    
    if (!serviceId) {
        showNotification('Please enter a Provider Service ID first', 'error');
        return;
    }
    
    if (!providerId) {
        showNotification('Please select a Provider first', 'error');
        return;
    }
    
    try {
        // Show loading indicator
        serviceIdInput.disabled = true;
        serviceIdInput.style.opacity = '0.5';
        
        // Fetch service details through backend proxy
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/providers', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'fetch-service-details',
                provider_id: providerId,
                service_id: serviceId
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch service details');
        }
        
        const result = await response.json();
        
        if (!result.success || !result.service) {
            throw new Error('Invalid response from server');
        }
        
        const service = result.service;
        
        // Auto-fill form fields (excluding service name)
        const providerRateInput = document.querySelector('input[name="providerRate"]');
        const minInput = document.querySelector('input[name="min"]');
        const maxInput = document.querySelector('input[name="max"]');
        
        if (providerRateInput && service.rate) {
            providerRateInput.value = service.rate;
        }
        if (minInput && service.min) {
            minInput.value = service.min;
        }
        if (maxInput && service.max) {
            maxInput.value = service.max;
        }
        
        // Trigger pricing calculation if available
        const form = document.querySelector('#addServiceForm') || document.querySelector('#editServiceForm');
        if (form && typeof updateMarkupForForm === 'function') {
            updateMarkupForForm(form, { force: true });
        }
        
        showNotification('Service details loaded successfully! ✓', 'success');
        
    } catch (error) {
        console.error('Failed to fetch service details:', error);
        showNotification(error.message || 'Failed to load service details', 'error');
    } finally {
        serviceIdInput.disabled = false;
        serviceIdInput.style.opacity = '1';
    }
}

// ==========================================
// PRICE CHANGE LOGS (Modal)
// ==========================================

let priceLogCurrentPage = 1;
const PRICE_LOG_PAGE_SIZE = 25;

async function showPriceChangeHistory() {
    const providers = await fetchProvidersList();
    const providerOptions = providers.map(p =>
        `<option value="${p.id}">${escapeHtml(p.name)}</option>`
    ).join('');

    const content = `
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;">
            <select id="priceLogFilterProvider" class="filter-select" onchange="loadPriceChangeLogs(1)">
                <option value="">All Providers</option>
                ${providerOptions}
            </select>
            <select id="priceLogFilterDirection" class="filter-select" onchange="loadPriceChangeLogs(1)">
                <option value="">All Changes</option>
                <option value="up">Price Increases</option>
                <option value="down">Price Decreases</option>
            </select>
            <button class="btn-secondary" style="padding:6px 12px;font-size:12px;" onclick="loadPriceChangeLogs(1)">
                <i class="fas fa-sync-alt"></i> Refresh
            </button>
        </div>
        <div class="table-container" style="max-height:450px;overflow:auto;">
            <table class="admin-table" style="min-width:850px;">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Provider</th>
                        <th>Service</th>
                        <th>Old Cost</th>
                        <th>New Cost</th>
                        <th>Change</th>
                        <th>Old Retail</th>
                        <th>New Retail</th>
                        <th>Markup</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody id="priceChangeLogsBody">
                    <tr><td colspan="10" style="text-align:center;padding:20px;color:var(--admin-gray-text);"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>
                </tbody>
            </table>
        </div>
        <div id="priceLogPagination" style="display:none;justify-content:center;align-items:center;gap:12px;margin-top:12px;">
            <button class="btn-secondary" id="priceLogPrevPage" onclick="changePriceLogPage(-1)" disabled>Previous</button>
            <span id="priceLogPaginationInfo" style="font-size:13px;color:var(--admin-gray-text);"></span>
            <button class="btn-secondary" id="priceLogNextPage" onclick="changePriceLogPage(1)">Next</button>
        </div>
    `;

    const actions = `<button type="button" class="btn-secondary" onclick="closeModal()">Close</button>`;
    createModal('Price Change History', content, actions);

    // Widen modal for the wide table
    const modalContent = document.querySelector('.modal-content');
    if (modalContent) modalContent.style.maxWidth = '960px';

    // Auto-load first page
    priceLogCurrentPage = 1;
    loadPriceChangeLogs(1);
}

async function loadPriceChangeLogs(page) {
    if (page !== undefined) priceLogCurrentPage = page;

    const tbody = document.getElementById('priceChangeLogsBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>';

    try {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams({
            page: priceLogCurrentPage,
            limit: PRICE_LOG_PAGE_SIZE
        });

        const providerId = document.getElementById('priceLogFilterProvider')?.value;
        const direction = document.getElementById('priceLogFilterDirection')?.value;
        if (providerId) params.append('provider_id', providerId);
        if (direction) params.append('direction', direction);

        const response = await fetch(`/.netlify/functions/price-change-logs?${params.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (!data.success || !data.logs || data.logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:var(--admin-gray-text);">No price changes found</td></tr>';
            const pag = document.getElementById('priceLogPagination');
            if (pag) pag.style.display = 'none';
            return;
        }

        tbody.innerHTML = data.logs.map(log => {
            const date = new Date(log.detected_at).toLocaleString();
            const providerName = escapeHtml(log.providers?.name || 'Unknown');
            const serviceName = escapeHtml(log.services?.name || log.provider_service_id || 'Unknown');
            const oldCost = parseFloat(log.old_provider_rate || 0).toFixed(4);
            const newCost = parseFloat(log.new_provider_rate || 0).toFixed(4);
            const oldRetail = parseFloat(log.old_retail_rate || 0).toFixed(4);
            const newRetail = parseFloat(log.new_retail_rate || 0).toFixed(4);
            const markup = log.markup_used !== null && log.markup_used !== undefined ? `${log.markup_used}%` : '-';

            const costDiff = parseFloat(log.new_provider_rate) - parseFloat(log.old_provider_rate);
            const changePercent = parseFloat(log.old_provider_rate) > 0
                ? ((costDiff / parseFloat(log.old_provider_rate)) * 100).toFixed(1)
                : '0.0';
            const isUp = costDiff > 0;
            const changeClass = isUp ? 'price-log-up' : 'price-log-down';
            const changeIcon = isUp ? 'fa-arrow-up' : 'fa-arrow-down';

            const strategyMap = {
                'provider_increase_markup_fixed': 'Auto ↑',
                'provider_decrease_retail_fixed': 'Kept ↓',
                'retail_manual_adjustment': 'Manual',
                'provider_change_no_retail_adjustment': 'Prov only',
                'no_change': '-'
            };
            const strategyLabel = strategyMap[log.strategy_applied] || log.strategy_applied || '-';
            const strategyClass = log.strategy_applied || '';

            return `<tr>
                <td style="font-size:12px;white-space:nowrap;">${date}</td>
                <td>${providerName}</td>
                <td title="${escapeHtml(log.services?.name || '')}" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${serviceName}</td>
                <td>$${oldCost}</td>
                <td class="${changeClass}">$${newCost}</td>
                <td class="${changeClass}"><i class="fas ${changeIcon}"></i> ${changePercent}%</td>
                <td>$${oldRetail}</td>
                <td>$${newRetail}</td>
                <td>${markup}</td>
                <td><span class="strategy-badge ${strategyClass}">${strategyLabel}</span></td>
            </tr>`;
        }).join('');

        // Pagination
        const pag = document.getElementById('priceLogPagination');
        const info = document.getElementById('priceLogPaginationInfo');
        const prevBtn = document.getElementById('priceLogPrevPage');
        const nextBtn = document.getElementById('priceLogNextPage');
        const { page: pg, totalPages, total } = data.pagination;

        if (totalPages > 1) {
            if (pag) pag.style.display = 'flex';
            if (info) info.textContent = `Page ${pg} of ${totalPages} (${total} total)`;
            if (prevBtn) prevBtn.disabled = pg <= 1;
            if (nextBtn) nextBtn.disabled = pg >= totalPages;
        } else {
            if (pag) pag.style.display = 'none';
        }
    } catch (error) {
        console.error('[PriceChangeLogs] Error:', error);
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:20px;color:#ef4444;">Failed to load price change logs</td></tr>';
    }
}

function changePriceLogPage(delta) {
    loadPriceChangeLogs(priceLogCurrentPage + delta);
}

