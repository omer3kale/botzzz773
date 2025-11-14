// Admin Services Management with Real Modals

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
    
    const existing = document.getElementById('activeModal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    setTimeout(() => document.getElementById('activeModal').classList.add('show'), 10);
}

function closeModal() {
    const modal = document.getElementById('activeModal');
    if (modal) {
        modal.classList.remove('show');
        setTimeout(() => modal.remove(), 300);
    }
}

// Provider utilities for form dropdowns
let providersCache = null;
let servicesCache = [];
const selectedServiceIds = new Set();
const ADMIN_SERVICES_BASE_ENDPOINT = '/.netlify/functions/services';
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

function escapeHtml(text = '') {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildProviderOptions(providers, includePlaceholder = true) {
    const placeholder = includePlaceholder ? '<option value="">Select provider</option>' : '';
    const options = (providers || []).map(provider => {
        const statusLabel = provider.status ? ` (${provider.status})` : '';
        return `<option value="${provider.id}">${escapeHtml(provider.name)}${statusLabel}</option>`;
    }).join('');
    return placeholder + (options || (includePlaceholder ? '' : '<option value="" disabled>No providers available</option>'));
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
    const numeric = toNumeric(value);
    if (numeric === null) {
        return '—';
    }

    const normalizedCurrency = currency ? String(currency).toUpperCase().slice(0, 10) : 'USD';
    const symbol = currencySymbols[normalizedCurrency] || `${normalizedCurrency} `;
    const ambiguousSymbols = new Set(['C$', 'A$', 'S$']);
    const formatted = `${symbol}${numeric.toFixed(4)}`;
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
    return Number.isFinite(numeric) ? numeric : null;
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
    return Number.isFinite(numeric) ? numeric : null;
}

function calculateMarkupPercent(providerRate, retailRate) {
    if (!Number.isFinite(providerRate) || !Number.isFinite(retailRate) || providerRate <= 0) {
        return null;
    }
    const markup = ((retailRate - providerRate) / providerRate) * 100;
    return Number.isFinite(markup) ? Number(markup.toFixed(2)) : null;
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
    return Number(value).toFixed(decimals);
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
        markupInput.value = markup.toFixed(2);
    } else if (options.force) {
        markupInput.value = '';
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

// Add new service
async function addService() {
    const providers = await fetchProvidersList();
    const hasProviders = providers.length > 0;
    const providerOptions = hasProviders
        ? buildProviderOptions(providers)
        : '<option value="" disabled>No providers available</option>';

    const content = `
        <form id="addServiceForm" onsubmit="submitAddService(event)" class="admin-form">
            <div class="form-group">
                <label>Service Name *</label>
                <input type="text" name="serviceName" placeholder="Instagram Followers - High Quality" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Category *</label>
                    <select name="category" required>
                        <option value="">Select Category</option>
                        <option value="instagram">Instagram</option>
                        <option value="tiktok">TikTok</option>
                        <option value="youtube">YouTube</option>
                        <option value="twitter">Twitter</option>
                        <option value="facebook">Facebook</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Type *</label>
                    <select name="type" required>
                        <option value="service" selected>Standard</option>
                        <option value="subscription">Subscription</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
            </div>
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
                    <input type="text" name="providerServiceId" id="providerServiceIdInput" placeholder="Enter provider's service ID" required style="flex: 1;">
                    <button type="button" onclick="showSyncedServices()" class="btn-secondary" style="white-space: nowrap;">
                        📋 Select from Synced
                    </button>
                </div>
                <small style="color: #94a3b8;">Get this ID from your provider panel or sync list.</small>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Provider Cost per 1000</label>
                    <input type="number" name="providerRate" placeholder="3.5000" min="0" step="0.0001">
                </div>
                <div class="form-group">
                    <label>Retail Rate per 1000 *</label>
                    <input type="number" name="rate" placeholder="5.0000" min="0" step="0.0001" required>
                </div>
                <div class="form-group">
                    <label>Markup %</label>
                    <input type="number" name="markup" placeholder="40" step="0.01">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Min Quantity *</label>
                    <input type="number" name="min" placeholder="100" min="1" required>
                </div>
                <div class="form-group">
                    <label>Max Quantity *</label>
                    <input type="number" name="max" placeholder="10000" min="1">
                </div>
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea name="description" rows="3" placeholder="Service description..."></textarea>
            </div>
            <div class="form-group">
                <label>Status</label>
                <select name="status">
                    <option value="active" selected>Active</option>
                    <option value="inactive">Inactive</option>
                </select>
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

    const submitBtn = document.querySelector('button[form="addServiceForm"]');
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
                providerServiceId: serviceData.providerServiceId || null
            })
        });

        const data = await response.json();

        if (data.success) {
            showNotification(data.message || 'Service created successfully!', 'success');
            closeModal();
            await loadServices();
        } else {
            showNotification(data.error || 'Failed to create service', 'error');
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
    const providerOptions = buildProviderOptionsWithSelected(providers, service.provider_id);

    const categories = ['instagram', 'tiktok', 'youtube', 'twitter', 'facebook', 'other'];
    const currentCategory = String(service.category || 'other').toLowerCase();
    const categoryOptions = categories.map(category => {
        const label = category.charAt(0).toUpperCase() + category.slice(1);
        const selected = currentCategory === category ? ' selected' : '';
        return `<option value="${category}"${selected}>${label}</option>`;
    }).join('');

    const isManualService = isAdminCreatedService(service);
    const publicIdValue = toNumeric(service.public_id);
    const hasPublicId = Number.isFinite(publicIdValue);
    const publicIdDisplay = hasPublicId ? `#${publicIdValue}` : 'ID Pending';
    const providerIdDisplay = service.provider_service_id ? escapeHtml(service.provider_service_id) : '—';

    const providerMarkup = toNumeric(service.provider?.markup);
    const serviceMarkup = toNumeric(service.markup_percentage ?? service.markup);
    let providerCost = toNumeric(service.provider_rate ?? service.provider_cost ?? service.raw_rate);
    const retailRate = toNumeric(service.rate);

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

    const content = `
        <form id="editServiceForm" onsubmit="submitEditService(event, '${serviceId}')" class="admin-form">
            <div class="form-group" style="display: flex; gap: 16px; font-size: 13px; color: #94a3b8;">
                <span><strong>Our ID:</strong> ${publicIdDisplay}</span>
                <span><strong>Provider ID:</strong> ${providerIdDisplay}</span>
            </div>
            <div class="form-group">
                <label>Service Name *</label>
                <input type="text" name="serviceName" value="${escapeHtml(service.name)}" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Category *</label>
                    <select name="category" required>
                        ${categoryOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status">
                        <option value="active"${service.status === 'active' ? ' selected' : ''}>Active</option>
                        <option value="inactive"${service.status === 'inactive' ? ' selected' : ''}>Inactive</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Provider</label>
                <select name="provider">
                    ${providerOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Provider Service ID</label>
                <input type="text" name="providerServiceId" value="${providerIdDisplay !== '—' ? providerIdDisplay : ''}" placeholder="Enter provider service ID">
                <small style="color: #94a3b8;">Leave blank to detach from provider.</small>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Provider Cost per 1000</label>
                    <input type="number" name="providerRate" step="0.0001" min="0" value="${formatNumberForInput(providerCost)}">
                </div>
                <div class="form-group">
                    <label>Retail Rate per 1000 *</label>
                    <input type="number" name="rate" step="0.0001" min="0" value="${formatNumberForInput(retailDisplayRate)}" required>
                </div>
                <div class="form-group">
                    <label>Markup %</label>
                    <input type="number" name="markup" step="0.01" value="${markupValue !== null ? markupValue : ''}">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Min Quantity *</label>
                    <input type="number" name="min" min="1" value="${minValue !== null ? minValue : ''}" required>
                </div>
                <div class="form-group">
                    <label>Max Quantity *</label>
                    <input type="number" name="max" min="1" value="${maxValue !== null ? maxValue : ''}">
                </div>
            </div>
            <div class="form-group">
                <label>Description</label>
                <textarea name="description" rows="3" placeholder="Optional">${escapeHtml(service.description || '')}</textarea>
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
    
    const preview = document.getElementById('providerServicesPreview');
    const list = document.getElementById('servicesPreviewList');
    
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
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Successfully imported ${data.added || 0} new services and updated ${data.updated || 0} existing services!`, 'success');
            closeModal();
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to import services', 'error');
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
function createCategory() {
    const content = `
        <form id="createCategoryForm" onsubmit="submitCreateCategory(event)" class="admin-form">
            <div class="form-group">
                <label>Category Name *</label>
                <input type="text" name="categoryName" placeholder="e.g., Instagram" required>
            </div>
            <div class="form-group">
                <label>Category Icon</label>
                <input type="text" name="icon" placeholder="fab fa-instagram" value="fab fa-">
                <small style="color: #888;">Font Awesome icon class</small>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Display Order</label>
                    <input type="number" name="order" value="1" min="1">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status">
                        <option value="Active" selected>Active</option>
                        <option value="Inactive">Inactive</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Parent Category</label>
                <select name="parent">
                    <option value="">None (Top Level)</option>
                    <option value="social-media">Social Media</option>
                    <option value="video">Video Platforms</option>
                    <option value="music">Music Platforms</option>
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
    const response = await fetch(buildAdminServicesUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'create-category',
                name: categoryData.categoryName,
                description: categoryData.description || '',
                icon: categoryData.icon || 'folder'
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Category "${categoryData.categoryName}" created successfully!`, 'success');
            closeModal();
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to create category', 'error');
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
        
        const data = await response.json();
        if (data.success) {
            showNotification('Subscription service created successfully!', 'success');
            closeModal();
            loadServices();
        } else {
            showNotification(data.error || 'Failed to create subscription', 'error');
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

    const retailRateValue = parseNumberInput(serviceData.rate);
    const providerRateValue = parseNumberInput(serviceData.providerRate);
    const markupValue = parseNumberInput(serviceData.markup);
    const providerRateRaw = (serviceData.providerRate ?? '').toString().trim();
    const markupRaw = (serviceData.markup ?? '').toString().trim();
    const minQuantityValue = parseIntegerInput(serviceData.min);
    const maxQuantityValue = parseIntegerInput(serviceData.max);
    const payload = {
        serviceId,
        name: serviceData.serviceName,
        category: serviceData.category,
        min_quantity: Number.isFinite(minQuantityValue) ? minQuantityValue : null,
        max_quantity: Number.isFinite(maxQuantityValue) ? maxQuantityValue : null,
        description: serviceData.description || '',
        status: (serviceData.status || 'active').toLowerCase(),
        providerId: serviceData.provider || null,
        providerServiceId: (serviceData.providerServiceId || '').trim() || null
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
    const response = await fetch(buildAdminServicesUrl(), {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Service #${serviceId} updated successfully!`, 'success');
            closeModal();
            await loadServices();
        } else {
            showNotification(data.error || 'Failed to update service', 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
            }
        }
    } catch (error) {
        console.error('Update service error:', error);
        showNotification('Failed to update service. Please try again.', 'error');
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
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="confirmDuplicateService(${serviceId})">
            <i class="fas fa-copy"></i> Duplicate Service
        </button>
    `;
    
    createModal('Duplicate Service', content, actions);
}

async function confirmDuplicateService(serviceId) {
    try {
        const token = localStorage.getItem('token');
    const response = await fetch(buildAdminServicesUrl(), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'duplicate',
                serviceId: serviceId
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Service #${serviceId} duplicated successfully!`, 'success');
            closeModal();
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to duplicate service', 'error');
        }
    } catch (error) {
        console.error('Duplicate service error:', error);
        showNotification('Failed to duplicate service. Please try again.', 'error');
    }
}

// Toggle service status
function toggleService(serviceId) {
    const content = `
        <div class="confirmation-message">
            <i class="fas fa-power-off" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>Toggle status for service #${serviceId}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will change the service status between Active and Inactive.
            </p>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="confirmToggleService(${serviceId})">
            <i class="fas fa-power-off"></i> Toggle Status
        </button>
    `;
    
    createModal('Toggle Service Status', content, actions);
}

function confirmToggleService(serviceId) {
    showNotification(`Service #${serviceId} status updated`, 'success');
    closeModal();
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
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-danger" onclick="confirmDeleteService(${serviceId})">
            <i class="fas fa-trash"></i> Delete Service
        </button>
    `;
    
    createModal('Delete Service', content, actions);
}

async function confirmDeleteService(serviceId) {
    try {
        const token = localStorage.getItem('token');
    const response = await fetch(buildAdminServicesUrl(), {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                serviceId: serviceId
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Service #${serviceId} deleted successfully`, 'success');
            closeModal();
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to delete service', 'error');
        }
    } catch (error) {
        console.error('Delete service error:', error);
        showNotification('Failed to delete service. Please try again.', 'error');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    initializeServicesQuickActions();
    if (typeof handleSearch === 'function') {
        handleSearch('serviceSearch', 'servicesTable');
    }
    await loadServices();
});

// Load real services from database
async function loadServices() {
    const tbody = document.getElementById('servicesTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading services...</td></tr>';

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
    pruneSelectedServiceIds();

        if (servicesCache.length > 0) {
            tbody.innerHTML = '';
            
            let activeCount = 0;
            servicesCache.forEach(service => {
                if (service.status === 'active') activeCount++;

        const serviceIdRaw = service.id !== undefined && service.id !== null ? String(service.id) : '';
        const serviceIdAttr = escapeHtml(serviceIdRaw);
        const ariaLabelId = serviceIdRaw ? `Select service ${serviceIdRaw}` : 'Select service';
                
                const statusClass = service.status === 'active' ? 'completed' : 'pending';
                const icon = service.category === 'instagram' ? 'fab fa-instagram' :
                           service.category === 'tiktok' ? 'fab fa-tiktok' :
                           service.category === 'youtube' ? 'fab fa-youtube' :
                           service.category === 'twitter' ? 'fab fa-twitter' :
                           service.category === 'facebook' ? 'fab fa-facebook' :
                           'fas fa-box';

                const isManualService = isAdminCreatedService(service);
                const publicIdValue = toNumeric(service.public_id);
                const hasPublicId = Number.isFinite(publicIdValue);
                const ourIdLabel = hasPublicId ? `#${publicIdValue}` : 'ID Pending';
                const providerIdRaw = service.provider_service_id ? String(service.provider_service_id) : '';
                const providerId = providerIdRaw ? escapeHtml(providerIdRaw) : null;
                const providerLabel = providerId ? `Provider ID ${providerId}` : 'Provider ID not set';

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

                let retailRateValue = Number.isFinite(providerCost)
                    ? providerCost * markupFactor
                    : null;

                if (!Number.isFinite(retailRateValue) && Number.isFinite(storedRetailRate)) {
                    retailRateValue = storedRetailRate;
                }

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
                const averageTimeTag = service.average_time
                    ? `<span class="service-meta-tag" title="Average completion time">${escapeHtml(service.average_time)}</span>`
                    : '';
                const currencyTag = `<span class="service-meta-tag service-meta-tag--muted">Currency: ${currencyCode}</span>`;
                const capabilityBadges = buildCapabilityBadges(service, true);
                const metaRows = [];
                const primaryTags = [currencyTag];
                if (averageTimeTag) {
                    primaryTags.unshift(averageTimeTag);
                }
                metaRows.push(`<div class="service-meta-row">${primaryTags.join('')}</div>`);
                if (capabilityBadges) {
                    metaRows.push(`<div class="service-meta-row service-meta-row--compact">${capabilityBadges}</div>`);
                }
                const serviceMetaMarkup = metaRows.join('');
                
                const row = `
                    <tr data-service-id="${serviceIdAttr}">
                        <td><input type="checkbox" class="service-checkbox" data-service-id="${serviceIdAttr}" aria-label="${escapeHtml(ariaLabelId)}"></td>
                        <td>
                            <div class="cell-stack cell-stack-ids">
                                <span class="cell-primary${hasPublicId ? '' : ' cell-muted'}" title="Customer-facing service ID">${ourIdLabel}</span>
                                <span class="cell-secondary${providerId ? '' : ' cell-muted'}" title="Provider reference">${providerLabel}</span>
                            </div>
                        </td>
                        <td>
                            <div class="service-name">
                                <i class="${icon}"></i>
                                ${escapeHtml(service.name)}
                            </div>
                            ${serviceMetaMarkup}
                        </td>
                        <td>${escapeHtml(categoryLabel)}</td>
                        <td>${providerName}</td>
                        <td>
                            <div class="cell-stack cell-stack-right">
                                <span class="cell-secondary">Retail: ${retailRateDisplay}</span>
                                <span class="cell-primary cell-highlight">Provider: ${providerRateDisplay}</span>
                                <span class="cell-secondary">Markup: ${markupDisplay}</span>
                            </div>
                        </td>
                        <td>${minQuantity}</td>
                        <td>${maxQuantity}</td>
                        <td><span class="status-badge ${statusClass}">${service.status}</span></td>
                        <td>
                            <div class="actions-dropdown">
                                <button class="btn-icon"><i class="fas fa-ellipsis-v"></i></button>
                                <div class="dropdown-menu">
                                    <a href="#" onclick="editService('${service.id}')">Edit</a>
                                    <a href="#" onclick="duplicateService('${service.id}')">Duplicate</a>
                                    <a href="#" onclick="toggleService('${service.id}')">Toggle</a>
                                    <a href="#" onclick="deleteService('${service.id}')">Delete</a>
                                </div>
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
            tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 20px; color: #888;">No services found</td></tr>';
            document.getElementById('totalServices').textContent = '0';
            document.getElementById('activeServices').textContent = '0';
            selectedServiceIds.clear();
            updateSelectedServicesSummary();
        }
    } catch (error) {
        console.error('Load services error:', error);
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load services. Please refresh the page.</td></tr>';
        selectedServiceIds.clear();
        updateSelectedServicesSummary();
    }
}

// ==========================================
// Show Synced Services from Provider
// ==========================================

async function showSyncedServices() {
    const providerSelect = document.getElementById('addServiceProviderSelect');
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
            const rate = parseFloat(service.rate || 0).toFixed(2);
            
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
    const serviceIdInput = document.getElementById('providerServiceIdInput');
    const serviceNameInput = document.querySelector('input[name="serviceName"]');
    const rateInput = document.querySelector('input[name="rate"]');
    const providerRateInput = document.querySelector('input[name="providerRate"]');
    
    if (serviceIdInput) serviceIdInput.value = serviceId;
    if (serviceNameInput) serviceNameInput.value = serviceName;
    if (rateInput) rateInput.value = rate;
    if (providerRateInput) providerRateInput.value = rate;

    updateMarkupForForm(document.getElementById('addServiceForm'), { force: true });
    
    closeModal();
    showNotification('Service selected! Update other fields as needed.', 'success');
}

function onProviderChange(providerId) {
    // Optional: Could auto-clear or validate fields when provider changes
    console.log('Provider changed to:', providerId);
}
