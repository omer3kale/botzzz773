// Admin Orders Management with Real Modals

// ========================================
// SECURITY: XSS Prevention
// ========================================

/**
 * Safely escapes HTML special characters to prevent XSS attacks
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text safe for HTML
 */
function escapeHtml(text) {
    if (!text || typeof text !== 'string') return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, char => map[char]);
}

/**
 * Create a text node instead of using innerHTML for error messages
 * @param {string} message - Error message to display
 * @returns {Text} - Safe text node
 */
function createSafeTextNode(message) {
    return document.createTextNode(escapeHtml(message));
}

let servicesCache = [];
const ADMIN_SERVICES_ENDPOINT = '/.netlify/functions/services?audience=admin';
let ordersCache = [];
let providersCache = new Map(); // Provider ID → Provider Name cache
let ordersAutoRefreshTimer = null;
let lastOrderSyncTime = 0;
let ordersSyncInFlight = false;
const ORDERS_SYNC_MIN_INTERVAL = 30000; // 30 seconds
// Fallback polling interval (only used when realtime yok). 30s'e çektik: daha az titreşim, daha az yük.
const ORDERS_AUTO_REFRESH_INTERVAL = 30000; // 30 seconds - fallback polling interval
const DEFAULT_ORDER_REFERENCE_BASE = 7000000;
let highestOrderIdHint = DEFAULT_ORDER_REFERENCE_BASE;
const selectedOrderIds = new Set();
const servicesOptionsState = {
    lastUpdated: null,
    hasServices: false,
    error: null
};
const failedOrdersRegistry = new Map();
const ORDER_STATUS_OPTIONS = ['pending', 'processing', 'in progress', 'completed', 'partial', 'canceled', 'failed', 'error'];
let orderIdSelectionShortcutAttached = false;

// Track current view state explicitly
let currentOrdersView = 'all'; // 'all' | 'failed' | 'provider-errors'

// BOTZZZ773 Real-time WebSocket state
let realtimeEnabled = false;
// Configurable debounce for search input (can be overridden via localStorage)
window.ordersSearchDebounceMs = (function(){
    const raw = localStorage.getItem('ordersSearchDebounceMs');
    const ms = raw ? parseInt(raw, 10) : 300;
    return Number.isFinite(ms) && ms >= 100 ? ms : 300;
})();

const adminOrdersPopupShell = (() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return { isPopup: false, close: () => {} };
    }

    const params = new URLSearchParams(window.location.search);
    const isPopup = params.get('popup') === '1';

    function closePopupSurface() {
        if (window.opener && !window.opener.closed) {
            try {
                window.opener.focus();
            } catch (error) {
                console.warn('[ADMIN ORDERS] Failed to refocus opener window.', error);
            }
            window.close();
            return;
        }

        document.body.classList.remove('popup-mode');
        const panel = document.querySelector('[data-popup-surface]');
        if (panel) {
            panel.removeAttribute('role');
            panel.removeAttribute('aria-modal');
            panel.removeAttribute('aria-label');
            panel.removeAttribute('tabindex');
        }
        const closeButton = document.querySelector('[data-popup-close]');
        if (closeButton) {
            closeButton.style.display = 'none';
        }
    }

    function mountPopupSurface() {
        if (!isPopup) {
            return;
        }

        document.body.classList.add('popup-mode');
        const panel = document.querySelector('[data-popup-surface]');
        if (panel) {
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-label', 'Admin orders window');
            panel.setAttribute('tabindex', '-1');
            requestAnimationFrame(() => panel.focus());
        }

        const closeButton = document.querySelector('[data-popup-close]');
        if (closeButton) {
            closeButton.addEventListener('click', closePopupSurface);
        }

        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closePopupSurface();
            }
        });
    }

    if (isPopup) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mountPopupSurface, { once: true });
        } else {
            mountPopupSurface();
        }
    }

    return {
        isPopup,
        close: closePopupSurface
    };
})();

function doesOrderMatchLookup(order, lookup) {
    if (!order) {
        return false;
    }

    const normalizedLookup = String(lookup).trim();
    
    // Support comma-separated order IDs
    // Example: 37054567,37054538,37054533
    if (normalizedLookup.includes(',')) {
        const ids = normalizedLookup.split(',').map(id => id.trim()).filter(Boolean);
        return ids.some(id => {
            // order_number is a STRING, so compare as strings first
            if (order.order_number && String(order.order_number) === id) {
                return true;
            }
            // order.id might be string or number
            if (String(order.id) === id) {
                return true;
            }
            // provider_order_id
            if (order.provider_order_id && String(order.provider_order_id) === id) {
                return true;
            }
            return false;
        });
    }

    // Single ID matching - compare as strings since order_number is a STRING
    // order_number match (primary)
    if (order.order_number && String(order.order_number) === normalizedLookup) {
        return true;
    }

    // order.id match
    if (String(order.id) === normalizedLookup) {
        return true;
    }

    // provider_order_id match
    const formattedLookup = formatProviderOrderId(normalizedLookup);
    const providerFormatted = formatProviderOrderId(order.provider_order_id);
    if (providerFormatted && formattedLookup && providerFormatted === formattedLookup) {
        return true;
    }

    if (order.provider_order_id && String(order.provider_order_id) === normalizedLookup) {
        return true;
    }

    if (order.link && String(order.link) === normalizedLookup) {
        return true;
    }

    return false;
}

function getOrderById(orderId) {
    if (orderId === undefined || orderId === null) return undefined;
    const lookup = String(orderId).trim();

    const cached = ordersCache.find(order => doesOrderMatchLookup(order, lookup));
    if (cached) {
        return cached;
    }

    for (const failed of failedOrdersRegistry.values()) {
        if (doesOrderMatchLookup(failed, lookup)) {
            return failed;
        }
    }

    return undefined;
}

// Get multiple orders by comma-separated IDs
function getOrdersByIds(idString) {
    if (!idString) return [];
    const lookup = String(idString).trim();
    
    if (!lookup.includes(',')) {
        // Single ID - return as array
        const order = getOrderById(lookup);
        return order ? [order] : [];
    }
    
    // Multiple IDs
    const ids = lookup.split(',').map(id => id.trim()).filter(Boolean);
    const results = [];
    
    for (const id of ids) {
        const order = getOrderById(id);
        if (order) {
            results.push(order);
        }
    }
    
    return results;
}

function getOrderDisplayName(order) {
    if (!order) return '';
    const orderId = order.id !== undefined && order.id !== null ? `#${order.id}` : '';
    const providerRef = formatProviderOrderId(order.provider_order_id);
    if (orderId && providerRef) {
        return `${orderId} → ${providerRef}`;
    }
    if (orderId) {
        return orderId;
    }
    if (providerRef) {
        return providerRef;
    }
    return 'Order';
}

function formatOrderLabel(order) {
    if (!order) {
        return 'order';
    }

    if (order.order_number !== undefined && order.order_number !== null) {
        return `#${order.order_number}`;
    }

    if (order.id !== undefined && order.id !== null) {
        return `#${order.id}`;
    }

    if (order.link) {
        return truncateText(order.link, 22);
    }

    return 'order';
}

function generateInternalOrderReference() {
    const base = Math.max(highestOrderIdHint, DEFAULT_ORDER_REFERENCE_BASE);
    const randomOffset = Math.floor(Math.random() * 9000) + 1000;
    return `#${base + randomOffset}`;
}

function buildOrderSelectionKey(order, index = 0) {
    if (!order) {
        return `order-${index}`;
    }

    const orderIdString = order.id !== undefined && order.id !== null ? String(order.id) : '';
    if (orderIdString) {
        return orderIdString;
    }

    const providerFormatted = formatProviderOrderId(order.provider_order_id);
    if (providerFormatted) {
        return providerFormatted;
    }

    if (order.provider_order_id) {
        return String(order.provider_order_id);
    }

    if (order.link) {
        return String(order.link);
    }

    if (order.created_at) {
        return String(order.created_at);
    }

    return `order-${index}`;
}

function toNumberOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

/**
 * Safely extract all order-related data upfront to prevent TDZ errors.
 * This function should be called at the START of any order processing loop.
 * Returns a flat object with all commonly used order properties.
 */
function extractOrderData(order) {
    if (!order || typeof order !== 'object') {
        return {
            order: null,
            orderService: null,
            orderUser: null,
            orderProvider: null,
            serviceName: 'Unknown Service',
            userName: 'Unknown',
            userEmail: '',
            providerName: 'Unknown Provider',
            providerApiUrl: '',
            isValid: false
        };
    }

    // Extract service - check multiple possible property names
    let orderService = order.service || order.services || null;
    
    // If service doesn't have public_id, try to get it from servicesCache
    if (orderService && !orderService.public_id && (orderService.id || orderService.service_id)) {
        const serviceId = orderService.id || orderService.service_id;
        const cachedService = servicesCache.find(s => s.id === serviceId);
        if (cachedService && cachedService.public_id) {
            orderService = { ...orderService, public_id: cachedService.public_id };
        }
    }
    
    // Extract user - check multiple possible property names
    const orderUser = order.user || order.users || null;
    
    // Extract provider from multiple sources
    const orderProvider = order.provider 
        || order.providers 
        || orderService?.provider 
        || orderService?.providers 
        || null;
    
    // Safely extract display values
    const serviceName = orderService?.name || 'Unknown Service';
    const userName = orderUser?.username || orderUser?.email?.split('@')[0] || 'Unknown';
    const userEmail = orderUser?.email || '';
    const providerName = orderProvider?.name 
        || order.provider_name 
        || order.failure_log?.provider?.name 
        || 'Unknown Provider';
    const providerApiUrl = orderProvider?.api_url 
        || order.failure_log?.provider?.api_url 
        || '';

    return {
        order,
        orderService,
        orderUser,
        orderProvider,
        serviceName,
        userName,
        userEmail,
        providerName,
        providerApiUrl,
        isValid: true
    };
}

function formatCurrency(value, fractionDigits = 2, fallback = 'N/A', currencyCode = 'USD') {
    const numeric = toNumberOrNull(value);
    if (numeric === null) {
        return fallback;
    }

    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currencyCode || 'USD',
            minimumFractionDigits: fractionDigits,
            maximumFractionDigits: fractionDigits
        }).format(numeric);
    } catch (error) {
        console.warn('[ORDERS] Currency formatting fallback triggered:', error?.message);
        const absolute = Math.abs(numeric).toFixed(fractionDigits);
        const sign = numeric < 0 ? '-' : '';
        return `${sign}$${absolute}`;
    }
}

function formatCurrencyDynamic(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '$0.00';
    }
    // Show up to 5 decimals, but remove trailing zeros (including decimal point if needed)
    let formatted = Math.abs(number).toFixed(5).replace(/\.?0+$/, '');
    const sign = number < 0 ? '-' : '';
    return `$${sign}${formatted}`;
}

function truncateText(text, maxLength = 48) {
    if (!text) return '';
    const normalized = String(text);
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.substring(0, maxLength)}...`;
}

function normalizeIdentifierCandidate(value) {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : null;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const lowered = trimmed.toLowerCase();
        if (lowered === 'null' || lowered === 'undefined') {
            return null;
        }
        return trimmed;
    }

    return null;
}

function resolveProviderOrderIdFromRecord(order) {
    if (!order || typeof order !== 'object') {
        return null;
    }

    const candidates = [
        order.provider_order_id,
        order.providerOrderId,
        order.external_order_id,
        order.externalOrderId,
        order.provider_ticket_id,
        order.providerTicketId,
        order.provider_ticket,
        order.providerTicket,
        order.meta?.provider_order_id,
        order.meta?.providerOrderId,
        order.meta?.provider_reference,
        order.meta?.provider_order,
        order.provider_response?.order,
        order.provider_response?.order_id,
        order.provider_response?.id,
        order.provider_response?.result?.order,
        order.provider_response?.result?.order_id,
        order.provider_response?.data?.order,
        order.provider_response?.data?.order_id,
        order.provider_response?.response?.order,
        order.provider_response?.response?.order_id,
        order.provider_response?.details?.order,
        order.provider_response?.details?.order_id,
        order.provider_response?.info?.order,
        order.provider_response?.info?.order_id,
        order.provider_status_payload?.order,
        order.provider_status_payload?.order_id,
        order.provider_sync_payload?.order,
        order.provider_sync_payload?.order_id,
        order.status_summary?.provider?.order_id,
        order.status_summary?.provider?.reference,
        order.status_summary?.provider?.raw,
        order.sync_status?.provider_order_id,
        order.providerReference,
        order.provider_reference
    ];

    if (Array.isArray(order.identifiers)) {
        order.identifiers.forEach(identifier => {
            candidates.push(identifier);
        });
    }

    if (Array.isArray(order.provider_response_history)) {
        order.provider_response_history.forEach(entry => {
            if (!entry) {
                return;
            }
            candidates.push(entry.order);
            candidates.push(entry.order_id);
        });
    }

    for (const candidate of candidates) {
        const normalized = normalizeIdentifierCandidate(candidate);
        if (normalized) {
            return normalized;
        }
    }

    return null;
}

function formatProviderOrderId(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    return normalized.startsWith('#') ? normalized : `#${normalized}`;
}

function getStatusKey(status) {
    const normalized = String(status || '').toLowerCase().trim();
    if (!normalized) return 'pending'; // Default to pending instead of unknown
    if (normalized === 'cancelled') return 'canceled';
    return normalized.replace(/[^a-z0-9]+/g, '-');
}

function formatStatusLabel(status) {
    if (!status) return 'Pending'; // Default to Pending instead of Unknown
    const value = String(status).replace(/[_-]+/g, ' ').trim();
    if (!value) return 'Pending'; // Double-check after trim
    return value.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function formatDateTimeLabel(timestamp) {
    if (!timestamp) {
        return null;
    }

    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed.toLocaleString();
}

function normalizeFailureContext(context) {
    if (!context) {
        return null;
    }

    if (typeof context === 'object') {
        return context;
    }

    if (typeof context === 'string') {
        const trimmed = context.trim();
        if (!trimmed) {
            return null;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
        } catch (error) {
            // Ignore parse errors and fall back to treating string as message
        }
        return { message: trimmed };
    }

    return null;
}

function formatFailureContextSummary(context) {
    const normalized = normalizeFailureContext(context);
    if (!normalized || typeof normalized !== 'object') {
        return null;
    }

    const entries = Object.entries(normalized).filter(([key, value]) => {
        if (!key) return false;
        if (value === undefined || value === null) return false;
        if (typeof value === 'string' && !value.trim()) return false;
        if (typeof value === 'object' && Object.keys(value).length === 0) return false;
        return true;
    });

    if (entries.length === 0) {
        return null;
    }

    const parts = entries.slice(0, 3).map(([key, value]) => {
        if (typeof value === 'object') {
            try {
                return `${key}: ${truncateText(JSON.stringify(value), 60)}`;
            } catch (error) {
                return `${key}: [object]`;
            }
        }
        return `${key}: ${truncateText(String(value), 60)}`;
    });

    return parts.join(' • ') + (entries.length > 3 ? ' +' : '');
}

function buildFailureMeta(order = {}) {
    const failureSourceRaw = order.failure_source || order.failure_log?.failure_source;
    const failureCode = order.failure_code || order.failure_log?.failure_code;
    const retryCount = typeof order.failure_log?.retry_count === 'number'
        ? order.failure_log.retry_count
        : null;
    const resolved = Boolean(order.failure_log?.resolved);
    const contextSummary = formatFailureContextSummary(order.failure_context || order.failure_log?.failure_context);
    const lastRetryLabel = formatDateTimeLabel(order.failure_log?.last_retry_at || order.failure_log?.error_timestamp);

    if (!failureSourceRaw && !failureCode && retryCount === null && !resolved && !contextSummary && !lastRetryLabel) {
        return '';
    }

    const chips = [];

    if (failureSourceRaw) {
        chips.push(`<span class="failure-chip failure-chip--source">Source: ${escapeHtml(formatStatusLabel(failureSourceRaw))}</span>`);
    }

    if (failureCode) {
        chips.push(`<span class="failure-chip failure-chip--code">Code: ${escapeHtml(String(failureCode))}</span>`);
    }

    if (retryCount !== null) {
        chips.push(`<span class="failure-chip failure-chip--retry">Retries: ${escapeHtml(String(retryCount))}</span>`);
    }

    if (resolved) {
        chips.push('<span class="failure-chip failure-chip--resolved">Resolved</span>');
    }

    const chipsMarkup = chips.length
        ? `<div class="failure-meta__chips">${chips.join('')}</div>`
        : '';

    const contextMarkup = contextSummary
        ? `<div class="failure-meta__context" title="${escapeHtml(contextSummary)}">${escapeHtml(contextSummary)}</div>`
        : '';

    const timestampMarkup = lastRetryLabel
        ? `<div class="failure-meta__timestamp">Last retry ${escapeHtml(lastRetryLabel)}</div>`
        : '';

    return `
        <div class="failure-meta">
            ${chipsMarkup}
            ${contextMarkup}
            ${timestampMarkup}
        </div>
    `;
}

function getStatusColor(statusKey) {
    switch (statusKey) {
        case 'completed':
            return '#22c55e';  // Yeşil
        case 'pending':
            return '#eab308';  // Sarı
        case 'processing':
            return '#a855f7';  // Mor
        case 'in-progress':
        case 'refilling':
            return '#3b82f6';  // Mavi
        case 'partial':
            return '#f97316';  // Turuncu
        case 'canceled':
        case 'cancelled':
        case 'fail':
        case 'failed':
            return '#ef4444';  // Kırmızı
        default:
            return '#94a3b8';
    }
}

function getOrderStatusChipClass(statusKey) {
    switch (statusKey) {
        case 'completed':
            return 'order-status-chip--completed';
        case 'pending':
            return 'order-status-chip--pending';
        case 'processing':
            return 'order-status-chip--processing';  // Mor
        case 'in-progress':
        case 'refilling':
            return 'order-status-chip--in-progress';  // Mavi (yeni class)
        case 'partial':
            return 'order-status-chip--partial';
        case 'canceled':
        case 'cancelled':
        case 'fail':
        case 'failed':
            return 'order-status-chip--failed';
        default:
            return 'order-status-chip--muted';
    }
}

function buildOrderStatusChip(label, value, statusKey) {
    if (!value) {
        return '';
    }
    const chipClass = getOrderStatusChipClass(statusKey);
    return `
        <span class="order-status-chip ${chipClass}">
            <span class="order-status-chip__label">${escapeHtml(label)}:</span>
            <span class="order-status-chip__value">${escapeHtml(value)}</span>
        </span>
    `;
}

function buildOrderStatusChipRow({
    orderStatusLabel,
    orderStatusKey,
    customerStatusLabel,
    customerStatusKey,
    providerStatusLabel,
    providerStatusKey,
    lastSyncLabel
} = {}) {
    const chips = [];

    // Sırası: Provider → Admin → Customer
    if (providerStatusLabel) {
        chips.push(buildOrderStatusChip('Provider', providerStatusLabel, providerStatusKey));
    }

    if (orderStatusLabel) {
        chips.push(buildOrderStatusChip('Admin', orderStatusLabel, orderStatusKey));
    }

    if (customerStatusLabel) {
        chips.push(buildOrderStatusChip('Customer', customerStatusLabel, customerStatusKey));
    }

    const filtered = chips.filter(Boolean);
    return filtered.length ? `<div class="order-status-chip-row">${filtered.join('')}</div>` : '';
}

function formatRelativeTime(timestamp) {
    if (!timestamp) {
        return 'Sync pending';
    }

    const time = new Date(timestamp);
    if (Number.isNaN(time.getTime())) {
        return 'Sync pending';
    }

    const diffMs = Date.now() - time.getTime();
    if (diffMs < 0) {
        return `Synced ${time.toLocaleString()}`;
    }

    const diffMinutes = Math.floor(diffMs / 60000);
    if (diffMinutes < 1) {
        return 'Synced just now';
    }
    if (diffMinutes < 60) {
        return `Synced ${diffMinutes}m ago`;
    }
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) {
        return `Synced ${diffHours}h ago`;
    }
    const diffDays = Math.floor(diffHours / 24);
    return `Synced ${diffDays}d ago`;
}

async function fetchOrderDetails(orderId) {
    const token = localStorage.getItem('token');
    if (!token) {
        throw new Error('Not authenticated. Please sign in again.');
    }

    const response = await fetch(`/.netlify/functions/orders?orderId=${encodeURIComponent(orderId)}&limit=1`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Failed to load order #${orderId}`);
    }

    const data = await response.json();
    if (Array.isArray(data.orders) && data.orders.length > 0) {
        return data.orders[0];
    }

    return null;
}

async function resolveOrderForManagement(orderId) {
    const cached = getOrderById(orderId);
    if (cached) {
        return cached;
    }

    const failedCached = failedOrdersRegistry.get(String(orderId));
    if (failedCached) {
        return failedCached;
    }

    try {
        const fetched = await fetchOrderDetails(orderId);
        if (fetched) {
            return fetched;
        }
    } catch (error) {
        console.error('[ORDERS] Failed to fetch order details:', error);
        throw error;
    }

    return null;
}

function refreshOrdersAfterAdminChange() {
    console.log('[ORDERS] Refreshing after admin change, current view:', currentOrdersView);
    if (currentOrdersView === 'failed') {
        loadFailedOrders();
    } else if (currentOrdersView === 'provider-errors') {
        showProviderErrors();
    } else {
        loadOrders({ skipSync: true });
    }
}

// Resolve provider information from the order payload regardless of shape
function resolveOrderProvider(order, orderService) {
    const service = orderService || order?.service || order?.services || null;

    // Simple priority: order.provider_name first, then service provider
    let providerName = null;
    let providerId = null;

    // Priority 1: order.provider_name (should be set when order created)
    if (order?.provider_name && typeof order.provider_name === 'string' && order.provider_name.trim().length > 0) {
        providerName = order.provider_name.trim();
        providerId = order?.provider_id;
        return { providerName, providerId };
    }

    // Priority 2: service.provider (the service object itself might have provider info - nested relationship)
    if (service?.provider && typeof service.provider === 'object') {
        providerName = service.provider.name || service.provider.title || null;
        providerId = service.provider.id || null;
        if (providerName) {
            return { providerName, providerId };
        }
    }

    // Priority 3: service.provider_id (direct provider_id field in service)
    // If service has provider_id but no nested provider object, try to use what we have
    if (service?.provider_id && !providerName) {
        providerId = service.provider_id;
        // providerName might still be null here, which is OK - frontend won't show anything
        // But if we have nested provider with just the ID (no name), this won't help
        return { providerName: null, providerId };
    }

    // Priority 4: order's provider references (legacy support)
    if (order?.provider) {
        if (typeof order.provider === 'string' && order.provider.trim().length > 0) {
            providerName = order.provider.trim();
        } else if (typeof order.provider === 'object' && order.provider?.name) {
            providerName = order.provider.name;
        }
        if (providerName) {
            return { providerName, providerId: order?.provider_id };
        }
    }

    // If nothing found, return null (no provider name)
    return { providerName: null, providerId: null };
}


// Build consistent provider order ID markup with graceful fallback
function buildProviderOrderIdMarkup(providerName, providerOrderDisplay, providerOrderRaw) {
    const safeName = providerName && providerName.trim().length > 0 ? providerName.trim() : 'Unknown Provider';

    if (providerOrderDisplay) {
        const label = truncateText(String(providerOrderDisplay), 34);
        const tooltipParts = [safeName];
        if (providerOrderRaw && providerOrderRaw !== providerOrderDisplay) {
            tooltipParts.push(String(providerOrderRaw));
        } else {
            tooltipParts.push(String(providerOrderDisplay));
        }
        const title = escapeHtml(tooltipParts.filter(Boolean).join(' · '));
        // Show "Provider order ID:" instead of provider name
        return `<span class="order-id-provider" title="${title}"><strong>Provider order ID:</strong> ${escapeHtml(label)}</span>`;
    }

    return `<span class="order-id-provider order-id-missing"><strong>Provider order ID:</strong> Not submitted</span>`;
}

// Normalize order identifiers for consistent display
function resolveOrderIdentifiers(order) {
    const uuidRaw = order?.id ? String(order.id) : null;
    const providerOrderId = resolveProviderOrderIdFromRecord(order);
    const providerOrderDisplay = providerOrderId ? formatProviderOrderId(providerOrderId) : null;

    function formatWithHash(value) {
        const trimmed = String(value).trim();
        if (!trimmed) {
            return '#—';
        }
        return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    }

    // PRIORITY 1: Use order_number (37M range) if available
    let normalizedCustomer = null;
    if (order?.order_number !== undefined && order?.order_number !== null && String(order.order_number).trim().length > 0) {
        normalizedCustomer = formatWithHash(order.order_number);
    }
    // PRIORITY 2: Fallback to other customer-facing IDs (for old orders)
    else {
        const customerCandidates = [
            order?.display_order_id,
            order?.public_id,
            order?.customer_order_number,
            order?.customer_order_id,
            order?.order_reference,
            order?.reference
        ];

        const customerReference = customerCandidates.find(value => {
            if (value === undefined || value === null) {
                return false;
            }
            if (typeof value === 'number') {
                return Number.isFinite(value);
            }
            if (typeof value === 'string') {
                return value.trim().length > 0;
            }
            return false;
        }) || null;

        if (customerReference) {
            const refString = typeof customerReference === 'number' ? String(customerReference) : customerReference;
            const trimmed = refString.trim();
            if (trimmed) {
                normalizedCustomer = formatWithHash(trimmed);
            }
        }
    }

    // PRIORITY 3: Final fallback to UUID-based ID (for very old orders)
    if (!normalizedCustomer && uuidRaw) {
        const compact = uuidRaw.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
        if (compact) {
            normalizedCustomer = formatWithHash(compact);
        }
    }

    // Ensure we never show nothing
    if (!normalizedCustomer) {
        normalizedCustomer = '#—';
    }

    const normalizedProvider = providerOrderDisplay
        ? providerOrderDisplay.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
        : null;
    const normalizedCustomerValue = normalizedCustomer
        ? normalizedCustomer.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
        : null;

    // If customer ID is same as provider ID, it means we don't have a proper customer ID
    // In this case, use the UUID fallback
    if (normalizedProvider && normalizedCustomerValue === normalizedProvider && uuidRaw) {
        const compact = uuidRaw.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
        if (compact) {
            normalizedCustomer = formatWithHash(compact);
        }
    }

    const providerLabel = providerOrderDisplay
        ? `Provider order ${providerOrderDisplay}`
        : 'Provider order pending';

    const providerTitle = providerOrderDisplay || 'Provider order pending';

    // Primary = Our Order ID (starting from 37 million)
    // Secondary = Provider Order ID
    const primaryLabel = normalizedCustomer;
    const primaryTitle = `Order ${normalizedCustomer}`;
    const secondaryLabel = providerOrderDisplay
        ? `Provider order ID: ${providerOrderDisplay}`
        : null;

    return {
        primaryLabel: primaryLabel || '#—',
        primaryTitle: primaryTitle || '#—',
        secondaryLabel,
        secondaryTitle: secondaryLabel,
        providerLabel,
        providerTitle,
        providerOrderId,
        providerOrderDisplay,
        internalUuid: uuidRaw,
        customerLabel: normalizedCustomer
    };
}

function resolveProviderStatus(order) {
    const candidates = [
        order?.provider_status,
        order?.providerStatus,
        order?.provider_status_label,
        order?.provider_status_text,
        order?.provider_status_display,
        order?.provider_status_raw,
        order?.status_provider,
        order?.statusProvider,
        order?.status_provider_label,
        order?.provider_statuses,
        order?.providerStatusText,
        order?.provider_status_detail,
        order?.service?.provider_status,
        order?.service?.providerStatus,
        order?.provider?.status,
        order?.provider?.provider_status,
        order?.meta?.provider_status,
        order?.sync_status?.provider,
        order?.status_history?.provider_status,
        order?.status_history?.provider
    ];

    for (const value of candidates) {
        if (!value) {
            continue;
        }

        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }

        if (typeof value === 'object') {
            if (Array.isArray(value)) {
                const first = value.find(entry => typeof entry === 'string' && entry.trim().length > 0);
                if (first) {
                    return first.trim();
                }
                const firstObject = value.find(entry => entry && typeof entry === 'object' && typeof entry.status === 'string');
                if (firstObject) {
                    return firstObject.status.trim();
                }
            } else if (typeof value.status === 'string' && value.status.trim().length > 0) {
                return value.status.trim();
            } else if (typeof value.label === 'string' && value.label.trim().length > 0) {
                return value.label.trim();
            }
        }
    }

    if (order?.status) {
        return String(order.status).trim();
    }

    return 'processing';
}

function resolveOrderStatusSummary(order) {
    // Prefer backend-provided status_summary for consistency, but validate it has values
    const summary = order?.status_summary;
    const hasValidSummary = summary && typeof summary === 'object' && 
        (summary.customer?.key || summary.customer?.label || summary.provider?.key || summary.provider?.label);
    
    if (hasValidSummary) {
        const customerRaw = summary.customer?.raw ?? order?.customer_status ?? order?.status;
        const resolvedCustomerLabel = summary.customer?.label 
            ?? order?.customer_status_label 
            ?? formatStatusLabel(customerRaw);
        const resolvedCustomerKey = summary.customer?.key 
            ?? order?.customer_status_key 
            ?? getStatusKey(customerRaw);

        const providerRaw = summary.provider?.raw
            ?? order?.provider_status_raw
            ?? (order?.provider_status?.trim() || null)
            ?? order?.providerStatus
            ?? null;
        const providerExists = Boolean(summary.provider) || Boolean(providerRaw);
        const providerLabel = summary.provider?.label
            ?? order?.provider_status_label
            ?? (providerRaw ? formatStatusLabel(providerRaw) : null);
        const providerKey = summary.provider?.key
            ?? order?.provider_status_key
            ?? (providerRaw ? getStatusKey(providerRaw) : null);

        return {
            admin: {
                key: order?.status ? getStatusKey(order.status) : 'pending',
                label: order?.status ? formatStatusLabel(order.status) : 'Pending'
            },
            customer: {
                key: resolvedCustomerKey,
                label: resolvedCustomerLabel
            },
            provider: providerExists ? {
                key: providerKey,
                label: providerLabel
            } : null,
            mode: summary.mode ?? order?.mode ?? 'auto',
            lastSync: summary.last_sync ?? summary.lastSync ?? order?.last_status_sync ?? null
        };
    }

    // Fallback to manual resolution if status_summary is not available or empty
    const providerRaw = order?.provider_status_raw
        ?? (order?.provider_status?.trim() || null)
        ?? order?.providerStatus
        ?? resolveProviderStatus(order);

    return {
        // Admin sees actual status, not customer-facing status
        admin: {
            key: order?.status ? getStatusKey(order.status) : 'pending',
            label: order?.status ? formatStatusLabel(order.status) : 'Pending'
        },
        // Customer sees sanitized status (failed -> pending)
        customer: {
            key: order?.customer_status_key ?? order?.customer_status ?? getStatusKey(order?.status) ?? 'pending',
            label: order?.customer_status_label ?? formatStatusLabel(order?.customer_status ?? order?.status) ?? 'Pending'
        },
        provider: providerRaw ? {
            key: order?.provider_status_key ?? getStatusKey(providerRaw),
            label: order?.provider_status_label ?? formatStatusLabel(providerRaw)
        } : null,
        mode: order?.mode ?? 'auto',
        lastSync: order?.last_status_sync ?? null
    };
}

function updateOrdersSyncStatus(message, state = 'pending') {
    const statusEl = document.getElementById('ordersSyncStatus');
    const dotEl = document.getElementById('ordersSyncDot');

    if (statusEl) {
        statusEl.textContent = message;
    }

    if (dotEl) {
        dotEl.classList.remove('sync-success', 'sync-error');
        if (state === 'success') {
            dotEl.classList.add('sync-success');
        } else if (state === 'error') {
            dotEl.classList.add('sync-error');
        }
    }
}

function pruneSelectedOrderIds() {
    if (selectedOrderIds.size === 0) {
        return;
    }

    const validIds = new Set();
    const registerOrderIdentifiers = (order, index = 0) => {
        if (!order) {
            return;
        }

        if (order.id !== undefined && order.id !== null) {
            validIds.add(String(order.id));
        }

        const selectionKey = buildOrderSelectionKey(order, index);
        if (selectionKey) {
            validIds.add(selectionKey);
        }

        const providerFormatted = formatProviderOrderId(order.provider_order_id);
        if (providerFormatted) {
            validIds.add(providerFormatted);
        }

        if (order.provider_order_id) {
            validIds.add(String(order.provider_order_id));
        }

        if (order.link) {
            validIds.add(String(order.link));
        }
    };

    ordersCache.forEach((order, index) => registerOrderIdentifiers(order, index));

    let failedIndex = ordersCache.length;
    failedOrdersRegistry.forEach(order => {
        registerOrderIdentifiers(order, failedIndex);
        failedIndex += 1;
    });

    for (const id of Array.from(selectedOrderIds)) {
        if (!validIds.has(String(id))) {
            selectedOrderIds.delete(id);
        }
    }
}

function resolveSelectedOrderIds() {
    if (selectedOrderIds.size === 0) {
        return [];
    }

    const uniqueIds = new Set();
    const resolved = [];

    selectedOrderIds.forEach(selectionKey => {
        const order = getOrderById(selectionKey);
        if (!order || order.id === undefined || order.id === null) {
            return;
        }

        const normalizedId = String(order.id);
        if (!uniqueIds.has(normalizedId)) {
            uniqueIds.add(normalizedId);
            resolved.push(order.id);
        }
    });

    return resolved;
}

function getSelectedOrders() {
    const resolved = [];
    selectedOrderIds.forEach(selectionKey => {
        const order = getOrderById(selectionKey);
        if (order) {
            resolved.push(order);
        }
    });
    return resolved;
}

function bindOrderSelectionEvents() {
    document.querySelectorAll('.order-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', handleOrderSelectionChange);
    });
    ensureOrderIdSelectionShortcut();
}

function handleOrderSelectionChange(event) {
    const checkbox = event?.target;
    if (!checkbox || !checkbox.dataset.orderId) {
        return;
    }

    const orderId = checkbox.dataset.orderId;
    if (checkbox.checked) {
        selectedOrderIds.add(orderId);
    } else {
        selectedOrderIds.delete(orderId);
    }

    const row = checkbox.closest('tr');
    if (row) {
        row.classList.toggle('is-selected', checkbox.checked);
    }

    updateSelectedOrdersSummary();
}

function restoreOrderSelectionState() {
    document.querySelectorAll('.order-checkbox').forEach(checkbox => {
        const isSelected = selectedOrderIds.has(checkbox.dataset.orderId);
        checkbox.checked = isSelected;
        const row = checkbox.closest('tr');
        if (row) {
            row.classList.toggle('is-selected', isSelected);
        }
    });
}

function ensureOrderIdSelectionShortcut() {
    if (orderIdSelectionShortcutAttached) {
        return;
    }

    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) {
        return;
    }

    tbody.addEventListener('click', event => {
        const orderIdCell = event.target.closest('.order-id-cell');
        if (!orderIdCell) {
            return;
        }

        const row = orderIdCell.closest('tr');
        if (!row) {
            return;
        }

        const checkbox = row.querySelector('.order-checkbox');
        if (!checkbox) {
            return;
        }

        event.preventDefault();
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });

    orderIdSelectionShortcutAttached = true;
}

function syncBulkActionControls({ loading = false, forceMessage = null } = {}) {
    const selectEl = document.getElementById('ordersBulkActionSelect');
    const applyBtn = document.getElementById('ordersBulkActionApply');
    const hintEl = document.getElementById('bulkActionSelectionHint');
    const selectedCount = selectedOrderIds.size;

    if (selectEl) {
        selectEl.disabled = loading;
    }

    if (applyBtn) {
        if (!applyBtn.dataset.defaultLabel) {
            applyBtn.dataset.defaultLabel = applyBtn.innerHTML;
        }

        if (loading) {
            applyBtn.disabled = true;
            applyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Working...';
        } else {
            const hasActionSelected = Boolean(selectEl && selectEl.value);
            applyBtn.disabled = !hasActionSelected || selectedCount === 0;
            applyBtn.innerHTML = applyBtn.dataset.defaultLabel;
        }
    }

    if (hintEl) {
        if (forceMessage) {
            hintEl.textContent = forceMessage;
        } else if (selectedCount === 0) {
            hintEl.textContent = 'Select orders to enable bulk actions';
        } else {
            hintEl.textContent = `${selectedCount} order${selectedCount === 1 ? '' : 's'} selected`;
        }
    }
}

function updateSelectedOrdersSummary() {
    const countEl = document.getElementById('selectedOrdersCount');
    const detailEl = document.getElementById('selectedOrdersDetail');
    const cardEl = document.getElementById('selectedOrdersCard');
    const selectedActionsEl = document.getElementById('ordersSelectedActions');

    const count = selectedOrderIds.size;

    if (countEl) {
        countEl.textContent = `${count} selected`;
    }

    if (detailEl) {
        if (count === 0) {
            detailEl.textContent = 'Pick orders to inspect provider IDs or edit quickly.';
        } else {
            const names = [];
            selectedOrderIds.forEach(id => {
                const label = getOrderDisplayName(getOrderById(id));
                if (label) {
                    names.push(label);
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

    if (selectedActionsEl) {
        selectedActionsEl.style.display = count > 0 ? 'flex' : 'none';
    }

    syncOrdersMasterToggle();
    syncBulkActionControls();
}

function syncOrdersMasterToggle() {
    const masterToggle = document.querySelector('th input[type="checkbox"][aria-label="Select all orders"]');
    if (!masterToggle) {
        return;
    }

    // Only count visible checkboxes (not display:none rows)
    const checkboxes = Array.from(document.querySelectorAll('.order-checkbox')).filter(cb => {
        const row = cb.closest('tr');
        return row && row.style.display !== 'none';
    });
    
    if (checkboxes.length === 0) {
        masterToggle.checked = false;
        masterToggle.indeterminate = false;
        return;
    }

    const selectedCount = checkboxes.filter(cb => cb.checked).length;
    masterToggle.checked = selectedCount > 0 && selectedCount === checkboxes.length;
    masterToggle.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
}

function openSelectedOrderModal() {
    if (selectedOrderIds.size === 0) {
        showNotification('Select an order from the table first', 'error');
        return;
    }
    const iterator = selectedOrderIds.values();
    const selectionKey = iterator.next().value;
    if (!selectionKey) {
        return;
    }

    const order = getOrderById(selectionKey);
    if (order && order.id !== undefined && order.id !== null) {
        viewOrder(order.id);
    } else {
        viewOrder(selectionKey);
    }
}

function openAddOrderQuickAction() {
    showAddOrderModal();
}

function openSyncOrdersQuickAction() {
    manualOrdersSync();
}

function openExportOrdersQuickAction() {
    exportData('csv');
}

function attachOrderQuickActionCard(element, handler) {
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

function initializeOrdersQuickActions() {
    attachOrderQuickActionCard(document.getElementById('selectedOrdersCard'), openSelectedOrderModal);
    attachOrderQuickActionCard(document.getElementById('addOrderCard'), openAddOrderQuickAction);
    attachOrderQuickActionCard(document.getElementById('syncOrdersCard'), openSyncOrdersQuickAction);
    attachOrderQuickActionCard(document.getElementById('exportOrdersCard'), openExportOrdersQuickAction);
    updateSelectedOrdersSummary();
}

async function handleBulkActionApply(event) {
    event?.preventDefault?.();

    const selectEl = document.getElementById('ordersBulkActionSelect');
    if (!selectEl) {
        return;
    }

    const action = selectEl.value;
    if (!action) {
        showNotification('Choose a bulk action first', 'error');
        return;
    }

    if (selectedOrderIds.size === 0) {
        showNotification('Select at least one order to continue.', 'error');
        return;
    }

    if (action === 'resend_failed') {
        await bulkResendSelectedOrders();
        return;
    }

    showNotification('Selected bulk action is not available yet.', 'error');
}

function toggleAllOrders(masterCheckbox) {
    if (!masterCheckbox) {
        return;
    }

    // Only select visible checkboxes (not display:none rows)
    const checkboxes = Array.from(document.querySelectorAll('.order-checkbox')).filter(cb => {
        const row = cb.closest('tr');
        return row && row.style.display !== 'none';
    });
    
    const shouldSelectAll = masterCheckbox.checked;
    masterCheckbox.indeterminate = false;

    selectedOrderIds.clear();
    checkboxes.forEach(checkbox => {
        checkbox.checked = shouldSelectAll;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function syncOrderStatuses({ silent = false, force = false, orderIds = null } = {}) {
    if (ordersSyncInFlight) {
        if (!silent) {
            showNotification('Provider sync already running. Please wait...', 'info');
        }
        return { skipped: true, reason: 'in-flight' };
    }

    const now = Date.now();
    if (!force && lastOrderSyncTime && now - lastOrderSyncTime < ORDERS_SYNC_MIN_INTERVAL) {
        if (!silent) {
            showNotification('Sync limit reached. Try again in a few seconds.', 'info');
        }
        return { skipped: true, reason: 'rate-limit' };
    }

    const token = localStorage.getItem('token');
    if (!token) {
        updateOrdersSyncStatus('Missing admin token', 'error');
        return { success: false, reason: 'no-token' };
    }

    ordersSyncInFlight = true;
    const syncButton = document.getElementById('ordersSyncButton');
    const originalLabel = syncButton ? syncButton.innerHTML : null;

    if (syncButton) {
        syncButton.disabled = true;
        syncButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }

    updateOrdersSyncStatus('Syncing provider statuses...', 'pending');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    try {
        console.log('[SYNC] Starting order status sync...');
        const payload = { action: 'sync-status' };
        if (Array.isArray(orderIds) && orderIds.length > 0) {
            payload.orderIds = orderIds;
        }

        const response = await fetch('/.netlify/functions/orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            console.log('[SYNC] Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('[SYNC] API error response:', errorText);
                throw new Error(`Sync failed (${response.status}): ${errorText}`);
            }
            const result = await response.json();
            console.log('[SYNC] Sync result:', result);
            
            if (result.error) {
                throw new Error(result.error);
            }

            lastOrderSyncTime = Date.now();
            const relative = formatRelativeTime(new Date(lastOrderSyncTime).toISOString());
            updateOrdersSyncStatus(relative, 'success');

            if (!silent) {
                const totalResults = Array.isArray(result.results) ? result.results.length : 0;
                const failureCount = totalResults > 0
                    ? result.results.filter(entry => !entry.success).length
                    : 0;
                const successCount = result.updated || 0;
                const targetCount = orderIds && orderIds.length > 0
                    ? orderIds.length
                    : (totalResults || successCount);

                let message;
                if (!targetCount && !successCount) {
                    message = 'Orders are already up to date';
                } else {
                    const scopeLabel = orderIds && orderIds.length > 0 ? 'selected orders' : 'pending orders';
                    message = `Synced ${successCount}/${targetCount || successCount || 0} ${scopeLabel}`;
                    if (failureCount > 0) {
                        message += ` (${failureCount} failed)`;
                    }
                    
                    // Check if any orders were refunded during sync (provider cancelled them)
                    const refundedOrders = Array.isArray(result.results) 
                        ? result.results.filter(entry => entry.refunded && entry.refundAmount > 0)
                        : [];
                    if (refundedOrders.length > 0) {
                        const totalRefunded = refundedOrders.reduce((sum, entry) => sum + (entry.refundAmount || 0), 0);
                        message += ` | ${refundedOrders.length} refunded ($${totalRefunded.toFixed(2)})`;
                        
                        // Dispatch refund events for cross-tab sync
                        refundedOrders.forEach(entry => {
                            window.dispatchEvent(new CustomEvent('refund:updated', {
                                detail: { 
                                    amount: entry.refundAmount || 0,
                                    orderId: entry.orderId,
                                    source: 'provider-sync'
                                }
                            }));
                        });
                    }
                }

                const level = failureCount > 0 ? 'warning' : 'success';
                showNotification(message, level);
            }

            console.log('[SYNC] Sync completed successfully');
            return {
                success: true,
                updated: result.updated || 0,
                results: result.results || [],
                targeted: Array.isArray(orderIds) && orderIds.length > 0
            };
        } catch (error) {
            console.error('[SYNC] Order sync error:', error);
            console.error('[SYNC] Error stack:', error.stack);
            const message = error.message || 'Failed to sync provider statuses';
            updateOrdersSyncStatus(message, 'error');
            if (!silent) {
                showNotification(message, 'error');
            }
            return { success: false, error: message };
        } finally {
            clearTimeout(timeoutId);
            ordersSyncInFlight = false;
            if (syncButton && originalLabel !== null) {
                syncButton.disabled = false;
                syncButton.innerHTML = originalLabel;
            }
        }
}

async function manualOrdersSync() {
    const selectedIds = resolveSelectedOrderIds();
    const orderIdsPayload = selectedIds.length > 0 ? selectedIds : null;
    const result = await syncOrderStatuses({ force: true, orderIds: orderIdsPayload });

    if (result?.skipped) {
        return;
    }

    // Refresh based on current view
    refreshOrdersAfterAdminChange();
}

function startOrdersAutoRefresh() {
    if (ordersAutoRefreshTimer) {
        clearInterval(ordersAutoRefreshTimer);
    }

    const intervalRaw = localStorage.getItem('ordersRefreshIntervalMs');
    const intervalMs = intervalRaw ? parseInt(intervalRaw, 10) : ORDERS_AUTO_REFRESH_INTERVAL;
    const refreshMs = Number.isFinite(intervalMs) && intervalMs >= 10000 ? intervalMs : ORDERS_AUTO_REFRESH_INTERVAL;

    ordersAutoRefreshTimer = setInterval(async () => {
        await syncOrderStatuses({ silent: true });
        // Refresh based on current view state
        if (currentOrdersView === 'failed') {
            await loadFailedOrders();
        } else if (currentOrdersView !== 'provider-errors') {
            await loadOrders({ skipSync: true });
        }
    }, refreshMs);
}

/**
 * ==========================================
 * BOTZZZ773 Real-Time Integration
 * ==========================================
 * Provides instant order updates without page refresh
 */
function initializeRealtimeOrders() {
    if (typeof window.BOTZZZ773Realtime === 'undefined') {
        console.log('[BOTZZZ773 Orders] Realtime not available, using polling');
        return false;
    }

    // Check if Supabase is ready, otherwise wait for it
    const supabaseClient = window.BOTZZZ773_SUPABASE || window.supabaseClient;
    
    if (!supabaseClient) {
        console.log('[BOTZZZ773 Orders] Waiting for Supabase ready event...');
        
        // Listen for supabase:ready event
        document.addEventListener('supabase:ready', function onSupabaseReady() {
            console.log('[BOTZZZ773 Orders] Supabase ready, initializing real-time...');
            document.removeEventListener('supabase:ready', onSupabaseReady);
            setupRealtimeSubscriptions();
        });
        
        return true; // Will initialize when ready
    }
    
    // Supabase already ready, initialize now
    return setupRealtimeSubscriptions();
}

function setupRealtimeSubscriptions() {
    try {
        // Check if init exists and returns a promise
        const initResult = window.BOTZZZ773Realtime.init();
        
        if (!initResult || typeof initResult.then !== 'function') {
            console.warn('[BOTZZZ773 Orders] Realtime init does not return a promise, using polling fallback');
            return false;
        }
        
        // Initialize realtime client
        initResult.then(function() {
            console.log('[BOTZZZ773 Orders] Real-time initialized');
            
            // Subscribe to order changes
            window.BOTZZZ773Realtime.subscribeToOrders((data) => {
                console.log('[BOTZZZ773 Orders] Update:', data.type, data.record?.id);
                handleRealtimeOrderUpdate(data);
            });

            // Listen for failed orders - instant notification
            window.BOTZZZ773Realtime.on('orders:failed', (data) => {
                console.log('[BOTZZZ773 Orders] FAILED:', data.record?.order_number);
                updateFailedOrdersBadge();
                if (currentOrdersView === 'failed') {
                    loadFailedOrders();
                }
                showNotification(`Order #${data.record?.order_number || 'Unknown'} failed`, 'error');
            });

            // Listen for completed orders
            window.BOTZZZ773Realtime.on('orders:completed', (data) => {
                console.log('[BOTZZZ773 Orders] COMPLETED:', data.record?.order_number);
                if (currentOrdersView === 'all') {
                    updateOrderRowInTable(data.record);
                }
            });

            // Listen for refunded orders
            window.BOTZZZ773Realtime.on('orders:refunded', (data) => {
                console.log('[BOTZZZ773 Orders] REFUNDED:', data.record?.order_number);
                refreshOrdersAfterAdminChange();
            });
            
            // Listen for connection status
            window.BOTZZZ773Realtime.on('connected', () => {
                realtimeEnabled = true;
                updateOrdersSyncStatus('Real-time connected');
            });

            realtimeEnabled = true;
            console.log('[BOTZZZ773 Orders] Real-time enabled');
            updateOrdersSyncStatus('Real-time active');
        }).catch(function(error) {
            console.error('[BOTZZZ773 Orders] Realtime init error:', error);
            realtimeEnabled = false;
            updateOrdersSyncStatus('Polling mode');
            // Fallback to polling when realtime fails
            startOrdersAutoRefresh();
        });
        
        return true;

    } catch (error) {
        console.error('[BOTZZZ773 Orders] Realtime setup error:', error);
        return false;
    }
}

/**
 * Handle incoming real-time order update
 * @param {Object} data - Real-time payload
 */
function handleRealtimeOrderUpdate(data) {
    const { type, record, oldRecord } = data;

    if (!record) return;

    // Update the orders cache
    const cacheIndex = ordersCache.findIndex(o => o.id === record.id);
    
    if (type === 'INSERT') {
        // New order - add to top of cache
        ordersCache.unshift(record);
        console.log('[BOTZZZ773 Orders] New order added to cache');
    } else if (type === 'UPDATE' && cacheIndex !== -1) {
        // Update existing order in cache
        ordersCache[cacheIndex] = { ...ordersCache[cacheIndex], ...record };
        console.log('[BOTZZZ773 Orders] Order updated in cache');
    } else if (type === 'DELETE' && cacheIndex !== -1) {
        // Remove from cache
        ordersCache.splice(cacheIndex, 1);
        console.log('[BOTZZZ773 Orders] Order removed from cache');
    }

    // Refresh the UI based on current view
    if (currentOrdersView === 'failed' && (record.status === 'failed' || record.status === 'error')) {
        loadFailedOrders();
    } else if (currentOrdersView === 'all') {
        // Update the specific row if visible
        updateOrderRowInTable(record);
    }
}

/**
 * Update a single order row in the table without full refresh
 * @param {Object} order - Order record from real-time or API
 */
function updateOrderRowInTable(order) {
    if (!order || !order.id) return;
    
    const row = document.querySelector(`tr[data-order-id="${order.id}"]`);
    if (!row) {
        // Order not in current view, do full refresh
        loadOrders({ skipSync: true });
        return;
    }

    // Update status cell
    const statusCell = row.querySelector('.status-badge');
    if (statusCell && order.status) {
        const statusKey = (order.status || 'pending').toLowerCase().replace(/\s+/g, '-');
        statusCell.className = `status-badge ${statusKey}`;
        statusCell.textContent = order.status.charAt(0).toUpperCase() + order.status.slice(1);
    }

    // Update row data attribute
    row.dataset.status = (order.status || '').toLowerCase();

    console.log('[BOTZZZ773 Orders] Row updated:', order.id);
}

/**
 * Update failed orders badge count
 */
async function updateFailedOrdersBadge() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const response = await fetch('/.netlify/functions/orders?status=failed&countOnly=true', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.ok) {
            const data = await response.json();
            const badge = document.getElementById('failedOrderCount');
            if (badge) {
                badge.textContent = data.count || data.orders?.length || 0;
            }
        }
    } catch (error) {
        console.error('[ORDERS] Failed to update badge:', error);
    }
}

async function initializeOrdersPage() {
    console.log('[ORDERS] Initializing orders page - loading ALL orders');
    // Reset to all view on page load
    currentOrdersView = 'all';
    
    // Ensure All tab is active
    const tabs = document.querySelectorAll('.filter-tab');
    tabs.forEach(tab => tab.classList.remove('active'));
    document.querySelector('[data-status="all"]')?.classList.add('active');

    // Load orders first for faster initial paint
    updateOrdersSyncStatus('Loading orders...');
    await loadOrders({ skipSync: true });

    // Optionally run provider sync in background
    const syncOnLoadRaw = localStorage.getItem('ordersSyncOnLoad');
    const syncOnLoad = syncOnLoadRaw === null ? true : (syncOnLoadRaw === 'true');
    if (syncOnLoad) {
        updateOrdersSyncStatus('Provider sync running...', 'info');
        try {
            await syncOrderStatuses({ silent: true, force: true });
            refreshOrdersAfterAdminChange();
        } catch (error) {
            console.warn('[ORDERS] Background provider sync failed:', error?.message || error);
            // Show friendly error instead of technical timeout
            const friendlyMsg = error?.name === 'TimeoutError' 
                ? 'Sync timeout - try manual sync later' 
                : 'Sync failed - check connection';
            updateOrdersSyncStatus(friendlyMsg, 'error');
        }
    } else {
        updateOrdersSyncStatus('Sync on load disabled', 'warning');
    }
    
    // Try to enable real-time updates first
    const realtimeActive = initializeRealtimeOrders();
    
    // If real-time failed to initialize, use polling fallback
    if (!realtimeActive) {
        console.log('[ORDERS] Real-time unavailable, starting automatic polling fallback');
        startOrdersAutoRefresh();
    }
}
function openOrdersSettings() {
    const currentPerPage = window.ordersPerPage || 50;
    const debounceMs = window.ordersSearchDebounceMs || 300;
    const refreshRaw = localStorage.getItem('ordersRefreshIntervalMs');
    const refreshMs = refreshRaw ? parseInt(refreshRaw, 10) : 30000;
    const syncOnLoadRaw = localStorage.getItem('ordersSyncOnLoad');
    const syncOnLoad = syncOnLoadRaw === null ? true : (syncOnLoadRaw === 'true');

    const content = `
        <div class="settings-modal">
            <div class="settings-header">
                <i class="fas fa-sliders-h"></i>
                <strong>Orders Settings</strong>
                <span class="settings-subtitle">Performans ve davranış tercihleri</span>
            </div>
            <div class="settings-grid">
                <div class="settings-item">
                    <label>Orders per page</label>
                    <input class="settings-input" type="number" id="cfgOrdersPerPage" min="10" max="100" step="5" value="${currentPerPage}" />
                    <div class="settings-help">10–100 • Daha az satır daha hızlı yükleme sağlar</div>
                </div>
                <div class="settings-item">
                    <label>Auto-refresh interval (seconds)</label>
                    <input class="settings-input" type="number" id="cfgRefreshSeconds" min="10" max="120" step="5" value="${Math.round(refreshMs/1000)}" />
                    <div class="settings-help">Realtime yoksa polling aralığı • 10–120 sn</div>
                </div>
                <div class="settings-item">
                    <label>Search debounce (ms)</label>
                    <input class="settings-input" type="number" id="cfgSearchDebounce" min="150" max="1000" step="50" value="${debounceMs}" />
                    <div class="settings-help">Yazarken arama gecikmesi • 150–1000 ms</div>
                </div>
                <div class="settings-item">
                    <label class="settings-inline">
                        <input type="checkbox" id="cfgSyncOnLoad" ${syncOnLoad ? 'checked' : ''} />
                        Sync providers on page load
                    </label>
                    <div class="settings-help">Açılışta provider senkronizasyonu çalıştırılır</div>
                </div>
            </div>
        </div>
    `;

    const actions = `
        <button class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn-primary" onclick="saveOrdersSettings()">Save</button>
    `;

    createModal('Orders Settings', content, actions);
}

function saveOrdersSettings() {
    const perPage = parseInt(document.getElementById('cfgOrdersPerPage')?.value || '50', 10);
    const refreshSec = parseInt(document.getElementById('cfgRefreshSeconds')?.value || '30', 10);
    const debounce = parseInt(document.getElementById('cfgSearchDebounce')?.value || '300', 10);
    const syncOnLoad = !!document.getElementById('cfgSyncOnLoad')?.checked;

    const validPerPage = Number.isFinite(perPage) ? Math.min(Math.max(perPage, 10), 100) : 50;
    const validRefreshMs = Number.isFinite(refreshSec) ? Math.min(Math.max(refreshSec, 10), 120) * 1000 : 30000;
    const validDebounce = Number.isFinite(debounce) ? Math.min(Math.max(debounce, 150), 1000) : 300;

    localStorage.setItem('ordersPerPage', String(validPerPage));
    localStorage.setItem('ordersRefreshIntervalMs', String(validRefreshMs));
    localStorage.setItem('ordersSearchDebounceMs', String(validDebounce));
    localStorage.setItem('ordersSyncOnLoad', String(syncOnLoad));

    // Apply immediately
    window.ordersPerPage = validPerPage;
    window.ordersSearchDebounceMs = validDebounce;
    startOrdersAutoRefresh();

    closeModal();
    showNotification('Settings saved', 'success');
    // Reload current view quickly to reflect per-page
    refreshOrdersAfterAdminChange();
}

// Modal Helper Functions (shared with admin-users.js pattern)
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

// Filter orders by status
async function filterOrders(status) {
    console.log('[ORDERS] filterOrders called with status:', status);
    
    // Normalize status: convert 'in-progress' to 'in progress'
    const normalizedStatus = status === 'in-progress' ? 'in progress' : status;
    
    // If we're currently in provider-errors view, hide it first to restore the orders layout
    if (currentOrdersView === 'provider-errors') {
        console.log('[ORDERS] Leaving provider-errors view, restoring orders layout');
        // Restore hidden elements manually (don't call hideProviderErrors as it reloads orders)
        const ordersLayout = document.querySelector('.orders-layout');
        const filtersBar = document.querySelector('.filter-bar');
        const bulkBar = document.getElementById('ordersBulkActionBar');
        const syncBar = document.querySelector('.sync-status-bar');
        const pagination = document.querySelector('.pagination');
        const providerErrorsView = document.getElementById('providerErrorsView');

        if (ordersLayout) ordersLayout.style.display = '';
        if (filtersBar) filtersBar.style.display = '';
        if (bulkBar) bulkBar.style.display = '';
        if (syncBar) syncBar.style.display = '';
        if (pagination) pagination.style.display = '';
        if (providerErrorsView) providerErrorsView.style.display = 'none';

        // Ensure orders are loaded before applying client-side filters
        if (status !== 'failed') {
            await loadOrders({ skipSync: true });
        }
    }
    
    const rows = document.querySelectorAll('#ordersTableBody tr');
    const tabs = document.querySelectorAll('.filter-tab');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    document.querySelector(`[data-status="${status}"]`)?.classList.add('active');
    
    // Handle 'failed' filter separately - load from API with status=failed
    if (normalizedStatus === 'failed') {
        currentOrdersView = 'failed';
        loadFailedOrders();
        return;
    }
    
    // Reset to all view
    currentOrdersView = 'all';
    
    // Clear all selections when filter changes
    selectedOrderIds.clear();
    
    if (normalizedStatus === 'all') {
        // Always reload all orders when clicking All tab
        console.log('[ORDERS] Reloading ALL orders');
        loadOrders({ skipSync: true });
    } else {
        // Load orders filtered by status from API (not client-side)
        console.log('[ORDERS] Loading orders with status filter:', normalizedStatus);
        await loadOrders({ skipSync: true, statusFilter: normalizedStatus });
    }
    
    // Update UI after filter
    restoreOrderSelectionState();
    updateSelectedOrdersSummary();
}

// View order details
async function viewOrder(orderId) {
    try {
        const order = await resolveOrderForManagement(orderId);
        if (!order) {
            showNotification(`Order #${orderId} not found`, 'error');
            return;
        }

        const providerOrderId = resolveProviderOrderIdFromRecord(order) || order.provider_order_id || 'N/A';
        const createdAt = order.created_at ? new Date(order.created_at).toLocaleString() : 'Unknown';
        const updatedAt = order.updated_at ? new Date(order.updated_at).toLocaleString() : 'Unknown';
        const statusKey = getStatusKey(order.status);
        const providerStatusKey = getStatusKey(order.provider_status);
        const failureMetaMarkup = buildFailureMeta(order);

        const content = `
            <div class="user-details">
                <div class="user-detail-section">
                    <h4><i class="fas fa-ticket-alt"></i> Core Details</h4>
                    <div class="detail-row"><span class="detail-label">Order ID:</span><span class="detail-value">${escapeHtml(String(order.id || 'Unknown'))}</span></div>
                    <div class="detail-row"><span class="detail-label">Provider Order:</span><span class="detail-value">${escapeHtml(providerOrderId)}</span></div>
                    <div class="detail-row"><span class="detail-label">Service:</span><span class="detail-value">${escapeHtml(order.service?.name || order.service_name || 'Unknown')}</span></div>
                    <div class="detail-row"><span class="detail-label">Link:</span><span class="detail-value"><a href="${order.link ? encodeURI(order.link) : '#'}" target="_blank" rel="noopener">${escapeHtml(truncateText(order.link || 'N/A', 80))}</a></span></div>
                    <div class="detail-row"><span class="detail-label">Quantity:</span><span class="detail-value">${escapeHtml(String(order.quantity || 'N/A'))}</span></div>
                    <div class="detail-row"><span class="detail-label">Charge:</span><span class="detail-value">${escapeHtml(formatCurrency(order.charge))}</span></div>
                </div>
                <div class="user-detail-section">
                    <h4><i class="fas fa-traffic-light"></i> Status</h4>
                    ${buildOrderStatusChipRow({
                        orderStatusLabel: formatStatusLabel(order.status),
                        orderStatusKey: statusKey,
                        providerStatusLabel: order.provider_status ? formatStatusLabel(order.provider_status) : null,
                        providerStatusKey: providerStatusKey,
                        lastSyncLabel: order.last_status_sync ? formatRelativeTime(order.last_status_sync) : null,
                        modeLabel: order.mode ? `Mode: ${order.mode}` : null
                    })}
                    ${failureMetaMarkup}
                </div>
                <div class="user-detail-section">
                    <h4><i class="fas fa-clock"></i> Timeline</h4>
                    <div class="detail-row"><span class="detail-label">Created:</span><span class="detail-value">${escapeHtml(createdAt)}</span></div>
                    <div class="detail-row"><span class="detail-label">Updated:</span><span class="detail-value">${escapeHtml(updatedAt)}</span></div>
                    <div class="detail-row"><span class="detail-label">Last Sync:</span><span class="detail-value">${order.last_status_sync ? escapeHtml(new Date(order.last_status_sync).toLocaleString()) : 'Never'}</span></div>
                </div>
            </div>
        `;

        const actions = `
            <button type="button" class="btn-secondary" onclick="editOrder('${escapeHtml(orderId)}')">
                <i class="fas fa-edit"></i> Edit
            </button>
            <button type="button" class="btn-primary" onclick="closeModal()">Close</button>`;

        createModal(`Order #${orderId} Details`, content, actions);
    } catch (error) {
        console.error('[ORDERS] viewOrder failed:', error);
        showNotification(`Unable to load order #${orderId}: ${error.message}`, 'error');
    }
}

// Edit order
async function editOrder(orderId) {
    try {
        const order = await resolveOrderForManagement(orderId);
        if (!order) {
            showNotification(`Order #${orderId} not found`, 'error');
            return;
        }

        const servicesOptions = await getServicesOptions(order.service?.id || order.service_id);
        const statusOptionsMarkup = ORDER_STATUS_OPTIONS.map(status => {
            const selected = getStatusKey(order.status) === getStatusKey(status);
            return `<option value="${status}"${selected ? ' selected' : ''}>${formatStatusLabel(status)}</option>`;
        }).join('');

        const content = `
            <form id="editOrderForm" onsubmit="submitEditOrder(event, '${escapeHtml(orderId)}')" class="admin-form">
                <div class="form-group">
                    <label>Service</label>
                    <select name="service" required>
                        ${servicesOptions}
                    </select>
                </div>
                <div class="form-group">
                    <label>Link</label>
                    <input type="url" name="link" value="${escapeHtml(order.link || '')}" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Quantity</label>
                        <input type="number" name="quantity" value="${escapeHtml(String(order.quantity || ''))}" min="1" required>
                    </div>
                    <div class="form-group">
                        <label>Charge (USD)</label>
                        <input type="number" name="charge" value="${escapeHtml(String(order.charge || '0'))}" min="0" step="0.00001" required>
                    </div>
                </div>
                <div class="form-group">
                    <label>Provider Order ID</label>
                    <input type="text" name="providerOrderId" value="${escapeHtml(resolveProviderOrderIdFromRecord(order) || '')}" placeholder="#123456789">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status">
                        ${statusOptionsMarkup}
                    </select>
                </div>
            </form>
        `;

        const actions = `
            <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
            <button type="submit" form="editOrderForm" class="btn-primary">
                <i class="fas fa-save"></i> Save Changes
            </button>
        `;

        createModal(`Edit Order #${orderId}`, content, actions);
    } catch (error) {
        console.error('[ORDERS] editOrder failed:', error);
        showNotification(`Unable to edit order #${orderId}: ${error.message}`, 'error');
    }
}

async function submitEditOrder(event, orderId) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const payload = {
        action: 'admin_update',
        orderId,
        serviceId: formData.get('service'),
        link: formData.get('link'),
        quantity: formData.get('quantity'),
        charge: formData.get('charge'),
        status: formData.get('status'),
        providerOrderId: formData.get('providerOrderId')
    };

    const button = event.submitter;
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving';
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch('/.netlify/functions/orders', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Failed to update order');
        }

        // Handle refund balance update if status was changed to cancelled
        if (data.refunded && typeof data.newBalance === 'number') {
            console.log('[ADMIN ORDERS] Status update triggered refund, updating balance:', data.newBalance);
            
            // Dispatch refund event for cross-tab sync (customer's tabs)
            window.dispatchEvent(new CustomEvent('refund:updated', {
                detail: { 
                    amount: data.refundAmount || 0,
                    newBalance: data.newBalance,
                    userId: data.userId,
                    source: 'admin-status-update'
                }
            }));
            
            // Also trigger BalanceSync if admin is logged in as same user (unlikely but handle it)
            if (window.BalanceSync) {
                const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
                if (currentUser.id === data.userId) {
                    window.BalanceSync.setBalance(data.newBalance, { reason: 'admin-status-refund' });
                }
            }
            
            showNotification(`Order #${orderId} cancelled and $${data.refundAmount?.toFixed(2) || '0.00'} refunded`, 'success');
        } else {
            showNotification(`Order #${orderId} updated`, 'success');
        }
        
        closeModal();
        refreshOrdersAfterAdminChange();
    } catch (error) {
        console.error('[ORDERS] submitEditOrder failed:', error);
        showNotification(error.message || 'Failed to update order', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-save"></i> Save Changes';
        }
    }
}

// Refill order
async function refillOrder(orderId) {
    try {
        const order = await resolveOrderForManagement(orderId);
        if (!order) {
            showNotification(`Order #${orderId} not found`, 'error');
            return;
        }

        const providerOrderId = resolveProviderOrderIdFromRecord(order);
        const content = `
            <div class="confirmation-message">
                <i class="fas fa-sync-alt" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
                <p>Request a refill for order #${escapeHtml(String(orderId))}?</p>
                <p style="color: #888; font-size: 14px; margin-top: 10px;">
                    Provider reference: <strong>${escapeHtml(providerOrderId || 'Unavailable')}</strong><br>
                    Service: ${escapeHtml(order.service?.name || order.service_name || 'Unknown')}
                </p>
            </div>
        `;

        const actions = `
            <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
            <button type="button" class="btn-primary" id="confirmRefillButton" onclick="confirmRefillOrder('${escapeHtml(orderId)}')">
                <i class="fas fa-sync-alt"></i> Request Refill
            </button>
        `;

        createModal('Refill Order', content, actions);
    } catch (error) {
        console.error('[ORDERS] refillOrder error:', error);
        showNotification(`Unable to open refill dialog: ${error.message}`, 'error');
    }
}

async function confirmRefillOrder(orderId) {
    const button = document.getElementById('confirmRefillButton');
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Requesting';
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch('/.netlify/functions/orders', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action: 'refill', orderId })
        });

        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Failed to request refill');
        }

        showNotification(data.message || `Refill requested for order #${orderId}`, 'success');
        closeModal();
        refreshOrdersAfterAdminChange();
    } catch (error) {
        console.error('[ORDERS] confirmRefillOrder error:', error);
        showNotification(error.message || 'Refill request failed', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-sync-alt"></i> Request Refill';
        }
    }
}

// Cancel order
async function cancelOrder(orderId) {
    try {
        const order = await resolveOrderForManagement(orderId);
        if (!order) {
            showNotification(`Order #${orderId} not found`, 'error');
            return;
        }

        const refundAmount = escapeHtml(formatCurrency(order.charge));
        const content = `
            <div class="confirmation-message danger">
                <i class="fas fa-times-circle" style="font-size: 48px; color: #ef4444; margin-bottom: 20px;"></i>
                <p>Cancel order #${escapeHtml(String(orderId))}?</p>
                <p style="color: #888; font-size: 14px; margin-top: 10px;">
                    The customer will be refunded ${refundAmount}. This action cannot be undone.
                </p>
            </div>
        `;

        const actions = `
            <button type="button" class="btn-secondary" onclick="closeModal()">Keep Order</button>
            <button type="button" class="btn-danger" id="confirmCancelButton" onclick="confirmCancelOrder('${escapeHtml(orderId)}')">
                <i class="fas fa-times"></i> Cancel Order
            </button>
        `;

        createModal('Cancel Order', content, actions);
    } catch (error) {
        console.error('[ORDERS] cancelOrder error:', error);
        showNotification(error.message || 'Unable to open cancel dialog', 'error');
    }
}

async function confirmCancelOrder(orderId) {
    const button = document.getElementById('confirmCancelButton');
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling';
    }

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch('/.netlify/functions/orders', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ orderId })
        });

        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Failed to cancel order');
        }

        // Update user balance in localStorage and trigger BalanceSync
        if (typeof data.newBalance === 'number') {
            const user = JSON.parse(localStorage.getItem('user') || '{}');
            user.balance = data.newBalance;
            localStorage.setItem('user', JSON.stringify(user));
            
            // Trigger BalanceSync to update all customer-facing pages
            if (window.BalanceSync) {
                window.BalanceSync.setBalance(data.newBalance, { reason: 'admin-cancel-refund' });
            }
            
            // Dispatch custom event for cross-tab sync
            window.dispatchEvent(new CustomEvent('refund:updated', {
                detail: { 
                    amount: data.refundAmount || 0,
                    newBalance: data.newBalance,
                    source: 'admin-cancel'
                }
            }));
        }

        showNotification(data.message || `Order #${orderId} cancelled and refunded`, 'success');
        closeModal();
        refreshOrdersAfterAdminChange();
    } catch (error) {
        console.error('[ORDERS] confirmCancelOrder error:', error);
        showNotification(error.message || 'Unable to cancel order', 'error');
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-times"></i> Cancel Order';
        }
    }
}

// Add Order Modal
async function showAddOrderModal() {
    const servicesOptions = await getServicesOptions();
    const serviceSelectDisabled = !servicesOptionsState.hasServices;
    const serviceSelectAttributes = serviceSelectDisabled ? ' disabled' : '';
    const internalReferenceValue = escapeHtml(generateInternalOrderReference());
    const servicesHelpMarkup = servicesOptionsState.error
        ? '<small style="color: #f87171;">Failed to load services. Refresh or check Netlify functions.</small>'
        : (serviceSelectDisabled
            ? '<small style="color: #94a3b8;">No active services available. Create a service before ordering.</small>'
            : '');
    const submitDisabledAttr = servicesOptionsState.error || serviceSelectDisabled ? ' disabled' : '';
    
    const content = `
        <form id="addOrderForm" onsubmit="submitAddOrder(event)" class="admin-form">
            <div class="form-group">
                <label>User *</label>
                <select name="user" required>
                    <option value="">Select User</option>
                    <option value="11009">sherry5286</option>
                    <option value="11008">azenarky</option>
                    <option value="11007">ami7456727779</option>
                    <option value="11006">yamh48378</option>
                    <option value="11005">jj1302524</option>
                </select>
            </div>
            <div class="form-group">
                <label>Service *</label>
                <select name="service" id="addOrderServiceSelect" required${serviceSelectAttributes}>
                    ${servicesOptions}
                </select>
                ${servicesHelpMarkup}
            </div>
            <div class="form-group">
                <label>Link/Username *</label>
                <input type="text" name="link" placeholder="https://instagram.com/username or @username" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Quantity *</label>
                    <input type="number" name="quantity" placeholder="1000" min="1" required>
                </div>
                <div class="form-group">
                    <label>Charge (USD)</label>
                    <input type="number" name="charge" placeholder="12.50" min="0" step="0.00001">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Internal Order Reference</label>
                    <input type="text" name="internalReference" value="${internalReferenceValue}" readonly>
                    <small style="color: #94a3b8;">Auto-generated BOTZZZ ID (#7000000+ series)</small>
                </div>
                <div class="form-group">
                    <label>Provider Order ID</label>
                    <input type="text" name="providerOrderId" placeholder="#123456789" autocomplete="off">
                    <small style="color: #94a3b8;">Optional: map to provider ticket for faster lookup.</small>
                </div>
            </div>
            <div class="form-group">
                <label>Mode</label>
                <select name="mode">
                    <option value="Auto" selected>Auto</option>
                    <option value="Manual">Manual</option>
                </select>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="addOrderForm" class="btn-primary"${submitDisabledAttr}>
            <i class="fas fa-plus"></i> Create Order
        </button>
    `;
    
    createModal('Add New Order', content, actions);
}

function submitAddOrder(event) {
    event.preventDefault();

    if (!servicesOptionsState.hasServices) {
        showNotification('Services are unavailable. Sync or add services before creating an order.', 'error');
        return;
    }

    const formData = new FormData(event.target);
    const orderData = Object.fromEntries(formData);
    
    console.log('Creating order:', orderData);
    showNotification('Order created successfully!', 'success');
    
    // Dispatch event to notify other panels (e.g., users panel) to refresh profit
    window.dispatchEvent(new CustomEvent('orderCreated', { detail: orderData }));
    
    closeModal();
}

// Export Orders
function exportData(format) {
    const content = `
        <div class="confirmation-message">
            <i class="fas fa-file-${format === 'csv' ? 'csv' : 'pdf'}" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>Export orders to ${format.toUpperCase()}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will download all visible orders in ${format.toUpperCase()} format. Current filters will be applied.
            </p>
            <div style="background: rgba(255,20,148,0.1); border: 1px solid rgba(255,20,148,0.3); border-radius: 8px; padding: 12px; margin-top: 16px;">
                <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                    <span style="color: #888;">Total Orders:</span>
                    <span style="color: #fff; font-weight: 600;">5</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                    <span style="color: #888;">Date Range:</span>
                    <span style="color: #fff;">All Time</span>
                </div>
            </div>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="confirmExport('${format}')">
            <i class="fas fa-download"></i> Export ${format.toUpperCase()}
        </button>
    `;
    
    createModal(`Export Orders`, content, actions);
}

// Toggle Actions Dropdown
function toggleOrdersActionsDropdown() {
    const dropdown = document.getElementById('ordersActionsDropdown');
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('ordersActionsDropdown');
    const button = document.getElementById('ordersActionsButton');
    if (dropdown && button && !dropdown.contains(e.target) && !button.contains(e.target)) {
        dropdown.style.display = 'none';
    }
});

// Copy Provider Order IDs
function copyProviderOrderIds() {
    const selectedOrders = getSelectedOrders();
    if (selectedOrders.length === 0) {
        showNotification('No orders selected', 'error');
        return;
    }
    
    const providerOrderIds = [];
    selectedOrders.forEach(order => {
        const providerOrderId = resolveProviderOrderIdFromRecord(order) || order.provider_order_id;
        if (providerOrderId && providerOrderId !== 'N/A') {
            // Remove # prefix if present
            const cleanId = String(providerOrderId).replace(/^#/, '');
            providerOrderIds.push(cleanId);
        }
    });
    
    if (providerOrderIds.length === 0) {
        showNotification('Selected orders have no provider IDs yet', 'error');
        return;
    }
    
    // Join with comma for easy bulk operations
    const idsText = providerOrderIds.join(',');
    
    navigator.clipboard.writeText(idsText).then(() => {
        showNotification(`Copied ${providerOrderIds.length} provider order ID(s): ${idsText}`, 'success');
    }).catch(() => {
        showNotification('Failed to copy to clipboard', 'error');
    });
}

// Export Selected Orders to CSV
function exportSelectedOrders() {
    const selectedOrders = getSelectedOrders();
    if (selectedOrders.length === 0) {
        showNotification('No orders selected', 'error');
        return;
    }
    
    // CSV Headers
    const headers = [
        'Order ID',
        'Provider Order ID',
        'Order Number',
        'User',
        'Service',
        'Link',
        'Quantity',
        'Start Count',
        'Remains',
        'Charge',
        'Cost',
        'Profit',
        'Status',
        'Mode',
        'Created At'
    ];
    
    // CSV Rows
    const rows = selectedOrders.map(order => [
        order.id || '',
        order.provider_order_id || '',
        order.order_number || order.order_reference || order.public_id || '',
        order.user?.email || order.user?.username || '',
        order.service?.name || '',
        order.link || '',
        order.quantity || 0,
        order.start_count || 0,
        order.remains || 0,
        order.charge || 0,
        order.cost || 0,
        ((order.charge || 0) - (order.cost || 0)).toFixed(5),
        order.status || '',
        order.mode || 'auto',
        order.created_at || ''
    ]);
    
    // Build CSV content with UTF-8 BOM for Excel compatibility
    let csvContent = '\uFEFF' + headers.join(',') + '\r\n';
    rows.forEach(row => {
        const escapedRow = row.map(cell => {
            // Always wrap in quotes and escape internal quotes for Excel
            const cellStr = String(cell).replace(/"/g, '""');
            return '"' + cellStr + '"';
        });
        csvContent += escapedRow.join(',') + '\r\n'; // Windows line endings
    });
    
    // Download CSV
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `orders_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification(`Exported ${selectedOrders.length} orders to CSV`, 'success');
}

function confirmExport(format) {
    showNotification(`Exporting orders to ${format.toUpperCase()}...`, 'success');
    closeModal();
    
    // Simulate download
    setTimeout(() => {
        showNotification(`Orders exported successfully!`, 'success');
    }, 1500);
}

// Initialize search and pagination
document.addEventListener('DOMContentLoaded', async () => {
    initializeOrdersQuickActions();
    
    // Set up server-side search with pagination
    const searchInput = document.getElementById('orderSearch');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', function() {
            clearTimeout(searchTimeout);
            // Debounce search to avoid too many API calls
            searchTimeout = setTimeout(() => {
                window.ordersCurrentPage = 1;  // Reset to first page on new search
                loadOrders({ skipSync: true });
            }, window.ordersSearchDebounceMs);
        });
    }
    
    // Set up pagination buttons
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    
    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            console.log('[PAGINATION] Previous button clicked. Current page:', window.ordersCurrentPage);
            if (window.ordersCurrentPage > 1) {
                window.ordersCurrentPage--;
                console.log('[PAGINATION] Moving to page:', window.ordersCurrentPage);
                loadOrders({ skipSync: true });
            } else {
                console.log('[PAGINATION] Already on first page, cannot go back');
            }
        });
    }
    
    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            console.log('[PAGINATION] Next button clicked. Current page:', window.ordersCurrentPage, 'Total pages:', window.ordersTotalPages);
            if (window.ordersCurrentPage < window.ordersTotalPages) {
                window.ordersCurrentPage++;
                console.log('[PAGINATION] Moving to page:', window.ordersCurrentPage);
                loadOrders({ skipSync: true });
            } else {
                console.log('[PAGINATION] Already on last page, cannot go forward');
            }
        });
    }
    
    // Filter listeners removed - filters deprecated

    const bulkActionSelect = document.getElementById('ordersBulkActionSelect');
    if (bulkActionSelect) {
        bulkActionSelect.addEventListener('change', () => syncBulkActionControls());
    }

    const bulkActionApply = document.getElementById('ordersBulkActionApply');
    if (bulkActionApply) {
        bulkActionApply.addEventListener('click', handleBulkActionApply);
    }

    syncBulkActionControls();

    try {
        await initializeOrdersPage();
    } catch (error) {
        console.error('Failed to initialize orders page:', error);
        updateOrdersSyncStatus('Failed to load orders', 'error');
    }
});

// Apply all filters - deprecated, kept for backwards compatibility
function applyFilters() {
    // Filters removed from UI
}

// Update pagination controls
function updatePaginationControls() {
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const paginationInfo = document.getElementById('paginationInfo');
    
    if (!prevPageBtn || !nextPageBtn || !paginationInfo) return;
    
    const currentPage = window.ordersCurrentPage || 1;
    const totalPages = window.ordersTotalPages || 1;
    const totalCount = window.ordersTotalCount || 0;
    
    // Update button states
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
    
    // Update page info text
    if (totalCount === 0) {
        paginationInfo.textContent = 'No orders found';
    } else {
        const startItem = (currentPage - 1) * (window.ordersPerPage || 50) + 1;
        const endItem = Math.min(currentPage * (window.ordersPerPage || 50), totalCount);
        paginationInfo.textContent = `Page ${currentPage} of ${totalPages} • Showing ${startItem}-${endItem} of ${totalCount} orders`;
    }
}

// Pagination button handlers (called from HTML onclick)
function handlePrevPage() {
    if (window.ordersCurrentPage > 1) {
        window.ordersCurrentPage--;
        loadOrders({ skipSync: true });
    }
}

function handleNextPage() {
    if (window.ordersCurrentPage < window.ordersTotalPages) {
        window.ordersCurrentPage++;
        loadOrders({ skipSync: true });
    }
}

// Load real orders from database
async function loadOrders({ skipSync = false, statusFilter = null } = {}) {
    // Clear selections when loading new orders
    selectedOrderIds.clear();
    
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) {
        console.error('[ORDERS] Table body element not found!');
        return;
    }

    tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading orders...</td></tr>';

    try {
        // Load services cache first so public_ids are available
        await getServicesOptions();
        
        if (!skipSync) {
            console.log('[ORDERS] Syncing order statuses first...');
            await syncOrderStatuses({ silent: true });
        }

        const token = localStorage.getItem('token');
        if (!token) {
            console.error('[ORDERS] No auth token found!');
            throw new Error('Not authenticated');
        }

        // Initialize pagination state if needed (allow override via localStorage)
        if (!window.ordersCurrentPage) window.ordersCurrentPage = 1;
        if (!window.ordersPerPage) {
            const perPageOverrideRaw = localStorage.getItem('ordersPerPage');
            const perPageOverride = perPageOverrideRaw ? parseInt(perPageOverrideRaw, 10) : NaN;
            window.ordersPerPage = Number.isFinite(perPageOverride) && perPageOverride > 0
                ? Math.min(perPageOverride, 100)
                : 50;  // default
        }

        // Get search query from input
        const searchInput = document.getElementById('orderSearch');
        const searchQuery = searchInput ? searchInput.value.trim() : '';
        
        // If search is cleared, reset to page 1
        if (!searchQuery && window.ordersCurrentPage !== 1) {
            console.log('[ORDERS] Search cleared - resetting to page 1');
            window.ordersCurrentPage = 1;
        }
        
        // Check if this is a comma-separated search (bulk order lookup)
        const isCommaSeparatedSearch = searchQuery.includes(',');
        let searchQueryToUse = searchQuery;
        let limitToUse = window.ordersPerPage;
        let offsetToUse = (window.ordersCurrentPage - 1) * window.ordersPerPage;
        
        if (isCommaSeparatedSearch) {
            console.log('[ORDERS] COMMA SEARCH DETECTED:', searchQuery);
            console.log('[ORDERS] isCommaSeparatedSearch =', isCommaSeparatedSearch);
            // For comma-separated searches, fetch many more orders to ensure we get all matches
            // (they might be spread across multiple pages)
            limitToUse = 10000;  // Fetch up to 10k orders
            offsetToUse = 0;     // Always start from beginning for bulk search
            searchQueryToUse = '';  // No API-side search filter
        }
        
        // When searching or filtering by status, fetch all matching orders
        if (statusFilter || searchQuery) {
            limitToUse = 10000;  // Fetch up to 10k orders
            offsetToUse = 0;     // Always start from beginning for search/filter
        }        // Build API URL with pagination and search
        const apiUrl = new URL('/.netlify/functions/orders', window.location.origin);
        apiUrl.searchParams.append('limit', limitToUse);
        apiUrl.searchParams.append('offset', offsetToUse);
        if (searchQueryToUse) {
            apiUrl.searchParams.append('search', searchQueryToUse);
        }
        if (statusFilter) {
            apiUrl.searchParams.append('status', statusFilter);
        }

        console.log('[ORDERS] API Request URL:', apiUrl.toString());

        console.log('[ORDERS] Fetching orders with pagination/search...');
        console.log('[ORDERS] Request URL:', apiUrl.toString());
        
        const response = await fetch(apiUrl.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('[ORDERS] API response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[ORDERS] API error response:', errorText);
            throw new Error(`API returned ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        ordersCache = Array.isArray(data.orders) ? data.orders : [];
        
        // For comma-separated searches, fetch ALL pages until we have everything
        if (isCommaSeparatedSearch && data.pagination && data.pagination.totalPages > 1) {
            console.log('[ORDERS] Comma search - fetching all pages. Total pages:', data.pagination.totalPages);
            let allOrders = [...ordersCache];
            
            // Detect actual page size from API response
            const actualPageSize = ordersCache.length;
            console.log('[ORDERS] Detected page size:', actualPageSize);
            
            // Fetch remaining pages
            for (let page = 2; page <= data.pagination.totalPages; page++) {
                const pageUrl = new URL('/.netlify/functions/orders', window.location.origin);
                const pageOffset = (page - 1) * actualPageSize;
                pageUrl.searchParams.append('limit', actualPageSize);
                pageUrl.searchParams.append('offset', pageOffset);
                
                console.log('[ORDERS] Fetching page', page, '(offset=' + pageOffset + ')...');
                try {
                    const pageResponse = await fetch(pageUrl.toString(), {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (pageResponse.ok) {
                        const pageData = await pageResponse.json();
                        const pageOrders = Array.isArray(pageData.orders) ? pageData.orders : [];
                        allOrders = allOrders.concat(pageOrders);
                        console.log('[ORDERS] Page', page, 'fetched:', pageOrders.length, 'total so far:', allOrders.length);
                    }
                } catch (err) {
                    console.error('[ORDERS] Error fetching page', page, ':', err);
                }
            }
            
            ordersCache = allOrders;
            console.log('[ORDERS] Total orders fetched for comma search:', ordersCache.length);
        }
        console.log('[ORDERS] API Response - received', ordersCache.length, 'orders from API');
        
        // DEBUG: Log first few orders to see their structure
        if (ordersCache.length > 0) {
            console.log('[ORDERS] First order structure:', ordersCache[0]);
            console.log('[ORDERS] Order keys:', Object.keys(ordersCache[0]));
            console.log('[ORDERS] First order values:', {
                id: ordersCache[0].id,
                order_number: ordersCache[0].order_number,
                order_id: ordersCache[0].order_id,
                provider_order_id: ordersCache[0].provider_order_id,
                display_order_id: ordersCache[0].display_order_id
            });
        }
        
        // Filter for comma-separated searches client-side
        if (isCommaSeparatedSearch && ordersCache.length > 0) {
            console.log('[ORDERS] FILTERING COMMA SEARCH');
            console.log('[ORDERS] Search query:', searchQuery);
            console.log('[ORDERS] Total orders to filter:', ordersCache.length);
            
            const beforeCount = ordersCache.length;
            let matchCount = 0;
            let errorCount = 0;
            
            ordersCache = ordersCache.filter(order => {
                try {
                    const matches = doesOrderMatchLookup(order, searchQuery);
                    if (matches) {
                        matchCount++;
                        console.log('[ORDERS] MATCH FOUND: order_number=' + order.order_number + ', id=' + order.id);
                    }
                    return matches;
                } catch (err) {
                    errorCount++;
                    console.error('[ORDERS] ERROR in doesOrderMatchLookup:', err, 'order:', order);
                    return false;
                }
            });
            
            console.log('[ORDERS] Filtering complete - before:', beforeCount, 'after:', ordersCache.length, 'matches:', matchCount, 'errors:', errorCount);
        } else if (isCommaSeparatedSearch) {
            console.log('[ORDERS] COMMA SEARCH but no orders from API!');
        }
        
        // Store pagination info
        // For comma-separated searches, disable pagination since we already fetched all matching orders
        if (isCommaSeparatedSearch) {
            window.ordersTotalCount = ordersCache.length;
            window.ordersTotalPages = 1;
            window.ordersCurrentPage = 1;
            console.log('[ORDERS] Comma-separated search complete:', window.ordersTotalCount, 'orders found');
        } else if (data.pagination) {
            window.ordersTotalCount = data.pagination.totalCount;
            window.ordersTotalPages = data.pagination.totalPages;
            window.ordersCurrentPage = data.pagination.currentPage;
        } else {
            // Fallback for responses without pagination (shouldn't happen with new API)
            window.ordersTotalCount = ordersCache.length;
            window.ordersTotalPages = Math.ceil(ordersCache.length / window.ordersPerPage);
        }
        
        updatePaginationControls();
        
        pruneSelectedOrderIds();

        // Debug logging for orders loaded
        console.log('[ORDERS] Orders received:', ordersCache.length);
        if (data.pagination) {
            console.log('[ORDERS] Pagination:', {
                page: data.pagination.currentPage,
                totalPages: data.pagination.totalPages,
                total: data.pagination.totalCount
            });
        }

        if (ordersCache.length > 0) {
            tbody.innerHTML = '';

            let mostRecentSync = lastOrderSyncTime;

            ordersCache.forEach((order, index) => {
                try {
                // SAFETY: Extract all order-related data FIRST to prevent TDZ errors
                const orderData = extractOrderData(order);
                if (!orderData.isValid) {
                    console.warn('[ORDERS] Skipping invalid order at index', index);
                    return;
                }
                const { orderService, orderUser } = orderData;
                
                const createdDate = order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A';
                const statusSummary = resolveOrderStatusSummary(order);
                // Status gösterimi: Provider → Admin → Customer
                const adminStatusKey = statusSummary.admin?.key || 'unknown';
                const adminStatusLabel = statusSummary.admin?.label || 'Unknown';
                const customerStatusKey = statusSummary.customer?.key || 'unknown';
                const customerStatusLabel = statusSummary.customer?.label || 'Unknown';
                const providerStatusKey = statusSummary.provider?.key || null;
                const providerStatusLabel = statusSummary.provider?.label || null;
                // Table'daki status badge için admin status'unu göster
                const orderStatusKey = adminStatusKey;
                const orderStatusLabel = adminStatusLabel;
                const lastSync = order.last_status_sync ? new Date(order.last_status_sync).getTime() : null;
                if (lastSync && lastSync > mostRecentSync) {
                    mostRecentSync = lastSync;
                }

                // Extract error reason for failed orders (from API response)
                const isFailedOrder = orderStatusKey === 'failed' || orderStatusKey === 'error' || order.status === 'failed' || order.status === 'error';
                const errorReason = order.provider_error 
                    || order.failure_reason 
                    || order.failure_log?.error_message
                    || order.provider_response?.error
                    || order.provider_response?.message
                    || null;
                
                // Get provider info for error display (orderService already extracted above)
                const errorProviderName = order.failure_log?.provider?.name 
                    || orderService?.provider?.name 
                    || order.provider_name 
                    || null;
                const errorFailureSource = order.failure_source 
                    || order.failure_log?.failure_source 
                    || null;
                const errorFailureCode = order.failure_code 
                    || order.failure_log?.failure_code 
                    || null;
                const errorRetryCount = order.failure_log?.retry_count || 0;

                const orderIdString = order.id !== undefined && order.id !== null ? String(order.id) : '';
                const identifierMeta = resolveOrderIdentifiers(order);
                const formattedProviderOrderId = identifierMeta.providerOrderDisplay;
                const orderPrimaryTitle = identifierMeta.primaryTitle ? escapeHtml(identifierMeta.primaryTitle) : '';
                const orderPrimaryLabel = escapeHtml(identifierMeta.primaryLabel);
                const orderSecondaryMarkup = identifierMeta.secondaryLabel
                    ? `<span class="order-id-secondary" title="${escapeHtml(identifierMeta.secondaryLabel)}">${escapeHtml(identifierMeta.secondaryLabel)}</span>`
                    : '';
                const providerInfo = resolveOrderProvider(order, orderService);
                // Show provider name for orders that have it (below provider order ID)
                let providerNameMarkup = '';
                if (providerInfo.providerName && providerInfo.providerName.trim().length > 0) {
                    providerNameMarkup = `<span class="order-provider-name" style="display: block; font-size: 0.95em; font-weight: 500; color: #fff; background-color: #2c3e50; padding: 4px 8px; margin-top: 6px; border-radius: 3px;"><i class="fas fa-server"></i> ${escapeHtml(providerInfo.providerName)}</span>`;
                }
                const internalOrderMarkup = '';


                const linkLabel = order.link ? truncateText(order.link, 42) : null;
                const linkHref = order.link ? encodeURI(order.link) : null;
                const linkMarkup = order.link
                    ? `<a href="${linkHref}" class="link-preview" target="_blank" rel="noopener">${escapeHtml(linkLabel)}</a>`
                    : '<span class="cell-secondary cell-muted">No link</span>';

                const startCountValue = toNumberOrNull(order.start_count);
                const remainsValue = toNumberOrNull(order.remains);
                const quantityValue = toNumberOrNull(order.quantity);
                const startCount = startCountValue !== null ? startCountValue : 'N/A';
                const remains = remainsValue !== null ? remainsValue : 'N/A';
                const quantity = quantityValue !== null ? quantityValue : 'N/A';

                const defaultCurrency = 'USD';
                const providerCurrency = String(order.provider_currency || defaultCurrency).toUpperCase();
                // For accurate display: use charge first, if 0 fallback to original_charge
                const chargeValue = toNumberOrNull(order.charge);
                const originalChargeValue = toNumberOrNull(order.original_charge);
                // Display rule: when canceled, show IN as the stored charge (will be 0 per API cancel mapping)
                // without falling back to original_charge. This keeps refunds/ledger intact while UI shows 0/0.
                const customerCharge = (order.status === 'canceled' || order.status === 'cancelled')
                    ? chargeValue
                    : ((chargeValue !== null && chargeValue !== 0) ? chargeValue : originalChargeValue);
                const providerCost = (order.status === 'canceled' || order.status === 'cancelled')
                    ? 0
                    : toNumberOrNull(order.provider_cost);
                const profitValue = (customerCharge !== null && providerCost !== null && providerCurrency === defaultCurrency)
                    ? Number((customerCharge - providerCost).toFixed(5))
                    : null;
                const profitPercent = (profitValue !== null && customerCharge !== null && customerCharge !== 0)
                    ? ((profitValue / customerCharge) * 100)
                    : null;
                const profitClass = profitValue !== null && profitValue < 0 ? 'profit-negative' : 'profit-positive';
                                const profitMarkup = profitValue !== null
                                        ? `<span class="cell-secondary ${profitClass}">Profit: ${formatCurrency(profitValue, 5)}</span>`
                                            + (profitPercent !== null
                                                ? `<br><span class="cell-secondary ${profitClass}">${profitPercent > 0 ? '+' : ''}${(window.formatTrimZeros ? window.formatTrimZeros(profitPercent, 5) : profitPercent.toFixed(1))}%</span>`
                                                : '')
                                        : '';

                const providerDotKey = providerStatusKey || 'pending';
                const providerStatusValue = providerStatusLabel || 'Provider status pending';
                const providerStatusDot = `<span class="provider-status-dot" style="background: ${getStatusColor(providerDotKey)};"></span>`;
                const providerStatusMarkup = `
                    <span class="provider-status-row">
                        ${providerStatusDot}
                        <span class="provider-status-label">Provider: ${escapeHtml(providerStatusValue)}</span>
                    </span>
                `;

                const lastSyncLabel = formatRelativeTime(statusSummary.lastSync);
                const statusChipsMarkup = buildOrderStatusChipRow({
                    orderStatusLabel: adminStatusLabel,
                    orderStatusKey: adminStatusKey,
                    customerStatusLabel,
                    customerStatusKey,
                    providerStatusLabel,
                    providerStatusKey: providerStatusKey || undefined,
                    lastSyncLabel
                });
                // Remove duplicate provider ID display - already shown in Order IDs column
                const ariaLabelId = orderIdString ? `Select order #${orderIdString}` : 'Select order';
                const selectionKeyRaw = buildOrderSelectionKey(order, index);
                const orderSelectionAttr = escapeHtml(selectionKeyRaw);

                const actions = buildOrderActions(order);

                const row = `
                    <tr data-status="${orderStatusKey}" data-order-id="${orderSelectionAttr}"${orderIdString ? ` data-internal-id="${escapeHtml(orderIdString)}"` : ''}>
                        <td><input type="checkbox" class="order-checkbox" data-order-id="${orderSelectionAttr}" aria-label="${escapeHtml(ariaLabelId)}"></td>
                        <td>
                            <div class="order-id-cell">
                                <span class="order-id-primary"${orderPrimaryTitle ? ` title="${orderPrimaryTitle}"` : ''}>${orderPrimaryLabel}</span>
                                ${orderSecondaryMarkup}
                                ${providerNameMarkup}
                                ${internalOrderMarkup}
                            </div>
                        </td>
                        <td>
                            <div class="cell-stack">
                                <span>${escapeHtml(orderUser?.username || orderUser?.email || 'Unknown')}</span>
                                ${statusSummary.mode && statusSummary.mode !== 'auto' ? `<span class="mode-badge">${escapeHtml(statusSummary.mode.toUpperCase())}</span>` : ''}
                            </div>
                        </td>
                        <td>
                            <div class="cell-stack">
                                <span class="cell-primary cell-highlight">IN: ${formatCurrency(customerCharge, 5)}</span>
                                <span class="cell-secondary">OUT: ${formatCurrency(providerCost, 5, 'N/A', providerCurrency)}</span>
                                ${profitMarkup}
                            </div>
                        </td>
                        <td>${linkMarkup}</td>
                        <td>${escapeHtml(String(startCount))}</td>
                        <td>${escapeHtml(String(quantity))}</td>
                        <td><span class="service-label">#${escapeHtml(orderService?.public_id || '?')} · ${escapeHtml(orderService?.name || 'Unknown Service')}</span></td>
                        <td>
                            <div class="cell-stack">
                                ${isFailedOrder && errorReason ? `
                                    <div class="error-reason" onclick="showOrderErrorDetails('${orderIdString}')" title="Click for full error details">
                                        ${errorProviderName ? `<span class="error-provider"><i class="fas fa-server"></i> ${escapeHtml(errorProviderName)}</span>` : ''}
                                        <div style="display: flex; align-items: flex-start; gap: 6px;">
                                            <i class="fas fa-exclamation-triangle"></i>
                                            <span>${escapeHtml(truncateText(errorReason, 50))}</span>
                                        </div>
                                        ${errorRetryCount > 0 ? `<span style="font-size: 9px; opacity: 0.7; margin-top: 2px;">${errorRetryCount} retries</span>` : ''}
                                    </div>
                                ` : ''}
                                ${statusChipsMarkup}
                                ${providerStatusMarkup}
                            </div>
                        </td>
                        <td>${escapeHtml(String(remains))}</td>
                        <td>${escapeHtml(createdDate)}</td>
                        <td>
                            <div class="actions-dropdown">
                                <button class="btn-icon"><i class="fas fa-ellipsis-v"></i></button>
                                <div class="dropdown-menu">
                                    ${actions}
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
                tbody.insertAdjacentHTML('beforeend', row);

                const numericOrderId = toNumberOrNull(order.id);
                if (numericOrderId !== null && numericOrderId > highestOrderIdHint) {
                    highestOrderIdHint = numericOrderId;
                }
                } catch (orderRenderError) {
                    // SAFETY: Catch any remaining TDZ or rendering errors for individual orders
                    console.error('[ORDERS] Error rendering order at index', index, ':', orderRenderError);
                    // Continue processing other orders - don't crash the whole page
                }
            });

            restoreOrderSelectionState();
            bindOrderSelectionEvents();
            updateSelectedOrdersSummary();

            if (mostRecentSync > 0) {
                lastOrderSyncTime = mostRecentSync;
                updateOrdersSyncStatus(formatRelativeTime(new Date(mostRecentSync).toISOString()), 'success');
            }

            updateSelectedOrdersSummary();
            updatePaginationControls();  // Update pagination after rendering orders
        } else {
            console.log('[ORDERS] No orders found in response');
            tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px; color: #888;">No orders found</td></tr>';
            ordersCache = [];
            selectedOrderIds.clear();
            updateSelectedOrdersSummary();
            
            // Ensure pagination state reflects no results
            if (!window.ordersTotalCount) window.ordersTotalCount = 0;
            if (!window.ordersTotalPages) window.ordersTotalPages = 1;
            updatePaginationControls();
        }
    } catch (error) {
        console.error('[ORDERS] Load orders error:', error);
        console.error('[ORDERS] Error stack:', error.stack);
        tbody.innerHTML = `<tr><td colspan="13" style="text-align: center; padding: 20px; color: #ef4444;">
            Failed to load orders: ${error.message}<br>
            <button class="btn-secondary" onclick="loadOrders({ skipSync: true })" style="margin-top: 12px;">
                <i class="fas fa-redo"></i> Retry
            </button>
        </td></tr>`;
        updateOrdersSyncStatus('Failed to load orders', 'error');
        ordersCache = [];
        selectedOrderIds.clear();
        updateSelectedOrdersSummary();
        
        // Reset pagination state on error
        window.ordersTotalCount = 0;
        window.ordersTotalPages = 1;
        updatePaginationControls();
    }
}

function buildOrderActions(order) {
    const statusKey = getStatusKey(order.status);
    const actions = [];

    actions.push(`<a href="#" onclick="viewOrder('${order.id}')">View</a>`);

    if (!['completed', 'canceled', 'cancelled', 'failed', 'fail'].includes(statusKey)) {
        actions.push(`<a href="#" onclick="editOrder('${order.id}')">Edit</a>`);
    }

    if (statusKey === 'completed') {
        actions.push(`<a href="#" onclick="refillOrder('${order.id}')">Refill</a>`);
    }

    if (!['completed', 'canceled', 'cancelled'].includes(statusKey)) {
        actions.push(`<a href="#" onclick="cancelOrder('${order.id}')">Cancel</a>`);
    }

    return actions.join('');
}

// Helper function to get services options
async function getServicesOptions(selectedServiceId = null) {
    if (servicesCache.length > 0) {
        servicesOptionsState.hasServices = servicesCache.length > 0;
        servicesOptionsState.error = null;
        servicesOptionsState.lastUpdated = Date.now();
        return buildServicesOptionsHTML(servicesCache, selectedServiceId);
    }
    
    try {
        const token = localStorage.getItem('token');
    const response = await fetch(ADMIN_SERVICES_ENDPOINT, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        if (!response.ok || data.error) {
            throw new Error(data.error || `Failed to fetch services (${response.status})`);
        }

        servicesCache = data.services || [];
        servicesOptionsState.hasServices = servicesCache.length > 0;
        servicesOptionsState.error = null;
        servicesOptionsState.lastUpdated = Date.now();
        
        // DEBUG: Check if provider_id is in services
        if (servicesCache.length > 0) {
            console.log('[ADMIN SERVICES] First service structure:', servicesCache[0]);
            console.log('[ADMIN SERVICES] Has provider_id?', 'provider_id' in servicesCache[0]);
            console.log('[ADMIN SERVICES] Service 198 data:', servicesCache.find(s => s.id === 198 || s.public_id === 198));
        }
        
        return buildServicesOptionsHTML(servicesCache, selectedServiceId);
    } catch (error) {
        console.error('Failed to load services:', error);
        servicesCache = [];
        servicesOptionsState.hasServices = false;
        servicesOptionsState.error = error instanceof Error ? error.message : String(error);
        servicesOptionsState.lastUpdated = Date.now();
        return '<option value="">Failed to load services</option>';
    }
}

function buildServicesOptionsHTML(services, selectedServiceId = null) {
    if (services.length === 0) {
        return '<option value="">No services available</option>';
    }
    
    // Group by category
    const grouped = {};
    services.forEach(service => {
        const category = (service.category || 'Other').toLowerCase();
        const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
        if (!grouped[categoryName]) {
            grouped[categoryName] = [];
        }
        grouped[categoryName].push(service);
    });
    
    let html = '<option value="">Select Service</option>';
    Object.keys(grouped).sort().forEach(categoryName => {
        html += `<optgroup label="${escapeHtml(categoryName)}">`;
        grouped[categoryName].forEach(service => {
            const isSelected = selectedServiceId && String(service.id) === String(selectedServiceId);
            const rate = parseFloat(service.rate || 0).toFixed(2);
            html += `<option value="${service.id}"${isSelected ? ' selected' : ''}>${escapeHtml(service.name)} - $${rate}/1k</option>`;
        });
        html += '</optgroup>';
    });
    
    return html;
}

// ==========================================
// FAILED ORDERS MANAGEMENT (SILENT FAILURE)
// ==========================================

// Load failed orders from API
async function loadFailedOrders() {
    console.log('[FAILED ORDERS] Loading failed orders view');
    // Clear selections when loading failed orders
    selectedOrderIds.clear();
    
    currentOrdersView = 'failed';
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) {
        console.error('[FAILED ORDERS] Table body element not found!');
        return;
    }

    tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading failed orders...</td></tr>';

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            console.error('[FAILED ORDERS] No auth token found!');
            throw new Error('Not authenticated - please sign in again');
        }

        console.log('[FAILED ORDERS] Fetching failed orders from API...');
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
        
        const response = await fetch('/.netlify/functions/orders?status=failed&limit=10000', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (response.status === 401 || response.status === 403) {
            console.error('[FAILED ORDERS] Authentication failed');
            localStorage.removeItem('token');
            window.location.href = '/signin.html';
            return;
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[FAILED ORDERS] API error:', errorText);
            throw new Error(`Server error (${response.status}): ${errorText.substring(0, 100)}`);
        }

        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            console.error('[FAILED ORDERS] Invalid response type:', contentType);
            throw new Error('Invalid server response format');
        }

        const data = await response.json();
        
        if (!data || typeof data !== 'object') {
            console.error('[FAILED ORDERS] Invalid response data:', data);
            throw new Error('Invalid response data from server');
        }
        
        const failedOrders = Array.isArray(data.orders) ? data.orders : [];
        failedOrdersRegistry.clear();
        
        console.log('[FAILED ORDERS] Received', failedOrders.length, 'failed orders');
        
        // Update badge count
        const badge = document.getElementById('failedOrderCount');
        if (badge) {
            badge.textContent = failedOrders.length;
        }

        if (failedOrders.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="13" style="text-align: center; padding: 40px;">
                        <i class="fas fa-check-circle" style="font-size: 48px; color: #10b981; margin-bottom: 16px;"></i>
                        <p style="font-size: 16px; color: #64748b;">No failed orders found!</p>
                        <p style="font-size: 14px; color: #94a3b8;">All orders processed successfully.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = `
            <tr class="failed-orders-notice">
                <td colspan="13" style="background: #000000; border-left: 4px solid #ef4444; padding: 12px;">
                    <i class="fas fa-exclamation-triangle" style="color: #ef4444; margin-right: 8px;"></i>
                    <strong>Failed Orders View:</strong> Showing ${failedOrders.length} order(s) with provider failures. Customers see these as "pending".
                </td>
            </tr>
        `;

        failedOrders.forEach((order, index) => {
            try {
                // Validate order object
                if (!order || typeof order !== 'object') {
                    console.warn('[FAILED ORDERS] Invalid order object at index', index);
                    return;
                }

                // SAFETY: Extract all order-related data FIRST to prevent TDZ errors
                const orderData = extractOrderData(order);
                const { orderService, orderUser, serviceName: extractedServiceName, userName: extractedUserName } = orderData;

                if (order.id !== undefined && order.id !== null) {
                    failedOrdersRegistry.set(String(order.id), order);
                }
                
                const createdDate = order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A';
                const identifierMeta = resolveOrderIdentifiers(order);
                
                const orderPrimaryLabel = escapeHtml(identifierMeta?.primaryLabel || order.id || 'Unknown');
                const orderSecondaryMarkup = identifierMeta?.secondaryLabel
                    ? `<span class="order-id-secondary" title="${escapeHtml(identifierMeta.secondaryLabel)}">${escapeHtml(identifierMeta.secondaryLabel)}</span>`
                    : '';

                const linkLabel = order.link ? truncateText(order.link, 42) : null;
                const linkHref = order.link ? encodeURI(order.link) : null;
                const linkMarkup = order.link
                    ? `<a href="${linkHref}" class="link-preview" target="_blank" rel="noopener">${escapeHtml(linkLabel)}</a>`
                    : '<span class="cell-secondary cell-muted">No link</span>';

                const quantity = toNumberOrNull(order.quantity) || 'N/A';
                const chargeValue = toNumberOrNull(order.charge || order.retail_charge || order.customer_charge || order.amount);
                const charge = chargeValue !== null ? formatCurrencyDynamic(chargeValue) : 'N/A';

                const userName = escapeHtml(orderUser?.username || orderUser?.email || extractedUserName);
                const serviceName = escapeHtml(orderService?.name || extractedServiceName);
                
                // Show provider error with safe extraction
                let providerError = 'Unknown error';
                try {
                    if (order.provider_error) {
                        providerError = String(order.provider_error);
                    } else if (order.error) {
                        providerError = String(order.error);
                    }
                } catch (e) {
                    console.warn('[FAILED ORDERS] Error extracting provider error:', e);
                }
                const errorPreview = truncateText(providerError, 80);
                const failureMetaMarkup = buildFailureMeta(order);

                const selectionKey = buildOrderSelectionKey(order, index);
                const isSelected = selectedOrderIds.has(selectionKey);
                const providerOrderId = resolveProviderOrderIdFromRecord(order);
                const canRefill = Boolean(providerOrderId);
                const ariaLabel = orderPrimaryLabel
                    ? `Select failed order ${orderPrimaryLabel}`
                    : 'Select failed order';

                // Show provider name for failed orders (below provider order ID)
                const failedOrderProviderInfo = resolveOrderProvider(order, orderService);
                const failedOrderProviderNameMarkup = failedOrderProviderInfo.providerName && failedOrderProviderInfo.providerName !== 'Unknown Provider'
                    ? `<span class="order-provider-name"><i class="fas fa-server"></i> ${escapeHtml(failedOrderProviderInfo.providerName)}</span>`
                    : '';

            const row = document.createElement('tr');
            row.dataset.orderId = selectionKey || order.id || '';
            row.dataset.status = 'failed';
            row.innerHTML = `
                <td>
                    <input type="checkbox"
                        class="order-checkbox"
                        data-order-id="${escapeHtml(selectionKey)}"
                        aria-label="${escapeHtml(ariaLabel)}"
                        ${isSelected ? 'checked' : ''}>
                </td>
                <td>
                    <div class="order-id-cell">
                        <span class="order-id-primary">${orderPrimaryLabel}</span>
                        ${orderSecondaryMarkup}
                        ${failedOrderProviderNameMarkup}
                    </div>
                </td>
                <td>${userName}</td>
                <td>${charge}</td>
                <td>${linkMarkup}</td>
                <td>—</td>
                <td>${escapeHtml(quantity)}</td>
                <td>${serviceName}</td>
                <td>
                    <span class="status-badge status-failed">Failed</span>
                    <div style="font-size: 11px; color: #ef4444; margin-top: 4px;" title="${escapeHtml(providerError)}">
                        ${escapeHtml(errorPreview)}
                    </div>
                    ${failureMetaMarkup}
                </td>
                <td>—</td>
                <td>${escapeHtml(createdDate)}</td>
                <td>—</td>
                <td>
                    <div class="action-buttons">
                        <button class="btn-icon" onclick="resendFailedOrder('${escapeHtml(order.id || '')}')" title="Resend to provider" ${!order.id ? 'disabled' : ''}>
                            <i class="fas fa-redo"></i>
                        </button>
                        <button class="btn-icon" onclick="refillOrder('${escapeHtml(order.id || '')}')" title="Request provider refill" ${!order.id || !canRefill ? 'disabled' : ''}>
                            <i class="fas fa-sync-alt"></i>
                        </button>
                        <button class="btn-icon" onclick="editOrder('${escapeHtml(order.id || '')}')" title="Edit order" ${!order.id ? 'disabled' : ''}>
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon" onclick="deleteOrder('${escapeHtml(order.id || '')}')" title="Delete order" ${!order.id ? 'disabled' : ''}>
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(row);
            } catch (rowError) {
                console.error('[FAILED ORDERS] Error rendering row:', rowError, order);
                // Continue with next order
            }
        });

        pruneSelectedOrderIds();
        restoreOrderSelectionState();
        bindOrderSelectionEvents();
        updateSelectedOrdersSummary();

    } catch (error) {
        console.error('[FAILED ORDERS] Error:', error);
        
        let errorMessage = 'Error loading failed orders';
        let errorDetails = '';
        
        if (error.name === 'AbortError') {
            errorMessage = 'Request timed out';
            errorDetails = 'The server took too long to respond. Please try again.';
        } else if (error.message) {
            errorDetails = error.message;
        }
        
        tbody.innerHTML = `
            <tr>
                <td colspan="13" style="text-align: center; padding: 40px;">
                    <i class="fas fa-exclamation-circle" style="font-size: 48px; color: #ef4444; margin-bottom: 16px;"></i>
                    <p style="font-size: 16px; color: #ef4444; font-weight: 600; margin-bottom: 8px;">${escapeHtml(errorMessage)}</p>
                    <p style="font-size: 14px; color: #64748b; margin-bottom: 16px;">${escapeHtml(errorDetails)}</p>
                    <button class="btn-primary" onclick="loadFailedOrders()" style="margin-top: 12px;">
                        <i class="fas fa-redo"></i> Retry
                    </button>
                </td>
            </tr>
        `;
    }
}

async function bulkResendSelectedOrders() {
    const resolvedOrders = getSelectedOrders();
    if (resolvedOrders.length === 0) {
        showNotification('Unable to resolve the selected orders. Please reload and try again.', 'error');
        return;
    }

    const eligibleOrders = resolvedOrders.filter(order => {
        const statusKey = getStatusKey(order.status);
        return (statusKey === 'failed' || statusKey === 'error') && order.id !== undefined && order.id !== null;
    });

    const skippedCount = resolvedOrders.length - eligibleOrders.length;

    if (eligibleOrders.length === 0) {
        showNotification('Only failed orders can be resent. Select failed orders first.', 'error');
        return;
    }

    const confirmationLines = [
        `Resend ${eligibleOrders.length} failed order${eligibleOrders.length === 1 ? '' : 's'} to the provider?`,
        'We will retry the provider submission with the same link and quantity.'
    ];

    if (skippedCount > 0) {
        confirmationLines.push(`${skippedCount} selected order${skippedCount === 1 ? '' : 's'} are not failed and will be skipped.`);
    }

    if (!confirm(confirmationLines.join('\n\n'))) {
        return;
    }

    const results = { success: [], failed: [] };
    syncBulkActionControls({ loading: true, forceMessage: 'Resending selected orders...' });

    try {
        for (const order of eligibleOrders) {
            try {
                const response = await submitOrderResend(order.id);
                results.success.push({ order, providerOrderId: response.providerOrderId });
            } catch (error) {
                results.failed.push({ order, message: error.message || 'Unknown error' });
            }
        }

        if (results.success.length > 0 && results.failed.length === 0) {
            showNotification(`${results.success.length} order${results.success.length === 1 ? '' : 's'} resent successfully.`, 'success');
        } else if (results.success.length > 0) {
            showNotification(`${results.success.length} order${results.success.length === 1 ? '' : 's'} resent, ${results.failed.length} failed.`, 'warning');
        } else {
            showNotification('Failed to resend all selected orders.', 'error');
        }

        if (results.failed.length > 0) {
            console.warn('[BULK RESEND] Some orders failed to resend:', results.failed.map(item => ({
                order: formatOrderLabel(item.order),
                error: item.message
            })));
        }

        refreshOrdersAfterAdminChange();
    } finally {
        syncBulkActionControls();
    }
}

async function bulkCancelSelectedOrders() {
    const resolvedOrders = getSelectedOrders();
    if (resolvedOrders.length === 0) {
        showNotification('İptal edilecek sipariş bulunamadı. Lütfen tekrar seçin.', 'error');
        return;
    }

    const confirmationLines = [
        `${resolvedOrders.length} siparişi iptal edip iade etmek istediğinize emin misiniz?`,
        'Her sipariş için bakiye iade edilecektir.',
        'Bu işlem geri alınamaz.'
    ];

    if (!confirm(confirmationLines.join('\n\n'))) {
        return;
    }

    const results = { success: [], failed: [] };
    syncBulkActionControls({ loading: true, forceMessage: `Cancelling ${resolvedOrders.length} orders...` });

    try {
        for (const order of resolvedOrders) {
            try {
                await submitOrderCancel(order.id || order.order_id || order.orderId);
                results.success.push(order);
            } catch (error) {
                results.failed.push({ order, message: error.message || 'Unknown error' });
            }
        }

        if (results.success.length > 0 && results.failed.length === 0) {
            showNotification(`${results.success.length} sipariş iptal edildi ve iade yapıldı.`, 'success');
        } else if (results.success.length > 0) {
            showNotification(`${results.success.length} iptal edildi, ${results.failed.length} başarısız.`, 'warning');
        } else {
            showNotification('Seçili siparişler iptal edilemedi.', 'error');
        }

        refreshOrdersAfterAdminChange();
    } finally {
        syncBulkActionControls();
    }
}

async function bulkDeleteSelectedOrders() {
    const resolvedOrders = getSelectedOrders();
    if (resolvedOrders.length === 0) {
        showNotification('No orders found to delete. Please select orders.', 'error');
        return;
    }

    const confirmationLines = [
        `Are you sure you want to delete ${resolvedOrders.length} order(s)?`,
        'This action cannot be undone.'
    ];

    if (!confirm(confirmationLines.join('\n\n'))) {
        return;
    }

    const results = { success: [], failed: [] };
    syncBulkActionControls({ loading: true, forceMessage: 'Deleting selected orders...' });

    try {
        for (const order of resolvedOrders) {
            try {
                await submitOrderDelete(order.id || order.order_id || order.orderId);
                results.success.push(order);
            } catch (error) {
                results.failed.push({ order, message: error.message || 'Unknown error' });
            }
        }

        if (results.success.length > 0 && results.failed.length === 0) {
            showNotification(`${results.success.length} order(s) deleted successfully.`, 'success');
        } else if (results.success.length > 0) {
            showNotification(`${results.success.length} deleted, ${results.failed.length} failed.`, 'warning');
        } else {
            showNotification('Failed to delete selected orders.', 'error');
        }

        refreshOrdersAfterAdminChange();
    } finally {
        syncBulkActionControls();
    }
}

async function submitOrderResend(orderId) {
    if (!orderId) {
        throw new Error('Order ID is required');
    }

    const token = localStorage.getItem('token');
    if (!token) {
        throw new Error('Not authenticated - please sign in again');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000);

    try {
        const response = await fetch('/.netlify/functions/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'resend_order',
                order_id: orderId
            }),
            signal: controller.signal
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            window.location.href = '/signin.html';
            throw new Error('Session expired. Please sign in again.');
        }

        const contentType = response.headers.get('content-type');
        let data;

        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            console.error('[RESEND ORDER] Non-JSON response:', text);
            throw new Error('Invalid server response format');
        }

        if (!response.ok || data.error || !data.success) {
            const errorMsg = data.error || data.details || `Server error (${response.status})`;
            throw new Error(errorMsg);
        }

        return {
            providerOrderId: data.providerOrderId || data.provider_order_id || 'N/A',
            raw: data
        };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('Request timed out. The provider may be slow or unavailable. Please try again later.');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

async function submitOrderDelete(orderId) {
    if (!orderId) {
        throw new Error('Order ID gerekli');
    }

    const token = localStorage.getItem('token');
    if (!token) {
        throw new Error('Oturum geçersiz. Tekrar giriş yapın.');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch('/.netlify/functions/orders', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                orderId: String(orderId).trim(),
                action: 'delete' // Permanent deletion
            }),
            signal: controller.signal
        });

        if (response.status === 401 || response.status === 403) {
            localStorage.removeItem('token');
            window.location.href = '/signin.html';
            throw new Error('Session expired. Please sign in again.');
        }

        const contentType = response.headers.get('content-type');
        let data;

        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            console.error('[DELETE ORDER] Non-JSON response:', text);
            throw new Error('Invalid server response format');
        }

        if (!response.ok || data.error) {
            const errorMsg = data.error || data.details || `Server error (${response.status})`;
            throw new Error(errorMsg);
        }

        return data || { success: true };
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('İstek timeout. Lütfen tekrar deneyin.');
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Alias for cancel (DELETE = cancel + refund)
async function submitOrderCancel(orderId) {
    return submitOrderDelete(orderId);
}

// Resend failed order to provider
async function resendFailedOrder(orderId, options = {}) {
    if (!orderId || (typeof orderId !== 'string' && typeof orderId !== 'number')) {
        alert('Invalid order ID');
        return null;
    }

    const { skipConfirmation = false, button: providedButton = null } = options;

    if (!skipConfirmation) {
        const confirmed = confirm('Resend this order to the provider?\n\nThis will retry the order with the same details.\nMake sure the link and quantity are still valid.');
        if (!confirmed) {
            return null;
        }
    }

    const button = providedButton || (typeof event !== 'undefined' ? event?.target?.closest('button') : null);
    const originalButtonHTML = button ? button.innerHTML : '';
    if (button) {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    }

    try {
        console.log('[RESEND ORDER] Resending order:', orderId);
        const result = await submitOrderResend(orderId);
        alert(`✓ Order resent successfully!\n\nProvider Order ID: ${result.providerOrderId}\n\nThe order is now processing.`);
        refreshOrdersAfterAdminChange();
        return result;
    } catch (error) {
        console.error('[RESEND ORDER] Error:', error);
        const errorMessage = error?.message || 'Failed to resend order';
        alert(`✗ ${errorMessage}`);
        return null;
    } finally {
        if (button) {
            button.disabled = false;
            button.innerHTML = originalButtonHTML;
        }
    }
}

// Initialize failed order count on page load
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const token = localStorage.getItem('token');
        if (token) {
            const response = await fetch('/.netlify/functions/orders?status=failed', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                const failedCount = Array.isArray(data.orders) ? data.orders.length : 0;
                const badge = document.getElementById('failedOrderCount');
                if (badge) {
                    badge.textContent = failedCount;
                }
            }

            // Also load provider error count
            loadProviderErrorCount();
        }
    } catch (error) {
        console.error('[FAILED ORDERS COUNT] Error:', error);
    }
});

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============= PROVIDER ERRORS TRACKING UI =============

let providerErrorsCache = [];

/**
 * Load provider error count for the badge
 */
async function loadProviderErrorCount() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;

        const response = await fetch('/.netlify/functions/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ action: 'get-provider-errors', limit: 1 })
        });

        if (response.ok) {
            const data = await response.json();
            const badge = document.getElementById('providerErrorCount');
            if (badge && typeof data.totalUnresolved === 'number') {
                badge.textContent = data.totalUnresolved;
                // Highlight tab if there are errors
                const tab = document.querySelector('.provider-errors-tab');
                if (tab && data.totalUnresolved > 0) {
                    tab.style.animation = 'pulse 2s infinite';
                }
            }
        }
    } catch (error) {
        console.error('[PROVIDER ERRORS] Count load error:', error);
    }
}

/**
 * Show provider errors view
 */
async function showProviderErrors() {
    console.log('[ORDERS] Switching to provider errors view');
    currentOrdersView = 'provider-errors';
    
    // Hide orders view
    const ordersLayout = document.querySelector('.orders-layout');
    const filtersBar = document.querySelector('.filter-bar');
    const bulkBar = document.getElementById('ordersBulkActionBar');
    const syncBar = document.querySelector('.sync-status-bar');
    const pagination = document.querySelector('.pagination');
    
    if (ordersLayout) ordersLayout.style.display = 'none';
    if (filtersBar) filtersBar.style.display = 'none';
    if (bulkBar) bulkBar.style.display = 'none';
    if (syncBar) syncBar.style.display = 'none';
    if (pagination) pagination.style.display = 'none';

    // Show provider errors view
    const errorsView = document.getElementById('providerErrorsView');
    if (errorsView) errorsView.style.display = 'block';

    // Update active tab
    document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('active'));
    const errorsTab = document.querySelector('.provider-errors-tab');
    if (errorsTab) errorsTab.classList.add('active');

    // Load provider errors
    await loadProviderErrors();
}

/**
 * Hide provider errors view and return to orders
 */
function hideProviderErrors() {
    console.log('[ORDERS] Hiding provider errors, returning to all orders view');
    currentOrdersView = 'all';
    
    // Show orders view
    const ordersLayout = document.querySelector('.orders-layout');
    const filtersBar = document.querySelector('.filter-bar');
    const bulkBar = document.getElementById('ordersBulkActionBar');
    const syncBar = document.querySelector('.sync-status-bar');
    const pagination = document.querySelector('.pagination');
    
    if (ordersLayout) ordersLayout.style.display = '';
    if (filtersBar) filtersBar.style.display = '';
    if (bulkBar) bulkBar.style.display = '';
    if (syncBar) syncBar.style.display = '';
    if (pagination) pagination.style.display = '';

    // Hide provider errors view
    const errorsView = document.getElementById('providerErrorsView');
    if (errorsView) errorsView.style.display = 'none';

    // Update active tab
    document.querySelectorAll('.filter-tab').forEach(tab => tab.classList.remove('active'));
    const allTab = document.querySelector('.filter-tab[data-status="all"]');
    if (allTab) allTab.classList.add('active');
    
    // Reload all orders
    loadOrders({ skipSync: true });
}

/**
 * Load provider errors from API
 */
async function loadProviderErrors() {
    const tbody = document.getElementById('providerErrorsTableBody');
    const summary = document.getElementById('providerErrorSummary');
    const filterSelect = document.getElementById('providerErrorFilter');
    
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin"></i> Loading provider errors...</td></tr>';

    try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('Not authenticated');

        const providerId = filterSelect?.value || null;

        const response = await fetch('/.netlify/functions/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                action: 'get-provider-errors',
                providerId,
                resolved: false,
                limit: 10000
            })
        });

        if (!response.ok) {
            throw new Error('Failed to load provider errors');
        }

        const data = await response.json();
        providerErrorsCache = data.errors || [];

        // Update filter dropdown with providers that have errors (fallback to runtime aggregation if summary missing)
        if (filterSelect) {
            const summaryFromApi = Array.isArray(data.providerSummary) ? data.providerSummary : [];
            const fallbackSummary = summaryFromApi.length === 0 && Array.isArray(providerErrorsCache)
                ? Object.values(providerErrorsCache.reduce((acc, err) => {
                    const provider = err.provider || {};  // REMOVED: err.order?.service?.provider fallback
                    const providerId = provider.id || err.provider_id || 'unknown';
                    const providerName = provider.name || 'Unknown Provider';
                    if (!acc[providerId]) {
                        acc[providerId] = { provider_id: providerId, provider_name: providerName, count: 0 };
                    }
                    acc[providerId].count += 1;
                    return acc;
                }, {}))
                : [];

            const providerOptions = summaryFromApi.length > 0 ? summaryFromApi : fallbackSummary;

            const currentValue = filterSelect.value;
            filterSelect.innerHTML = '<option value="">All Providers</option>';

            if (providerOptions.length === 0) {
                const opt = document.createElement('option');
                opt.value = '';
                opt.disabled = true;
                opt.textContent = 'No providers with errors';
                filterSelect.appendChild(opt);
            } else {
                providerOptions.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.provider_id;
                    opt.textContent = `${p.provider_name} (${p.count} errors)`;
                    filterSelect.appendChild(opt);
                });
            }

            filterSelect.value = currentValue;
        }

        // Update summary cards
        if (summary && data.providerSummary) {
            summary.innerHTML = data.providerSummary.map(p => `
                <div class="provider-error-card" style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 16px 20px; border-radius: 12px; min-width: 180px;">
                    <div style="font-size: 28px; font-weight: 700;">${p.count}</div>
                    <div style="opacity: 0.9;">${escapeHtml(p.provider_name)}</div>
                    <div style="font-size: 12px; opacity: 0.7; margin-top: 4px;">unresolved errors</div>
                </div>
            `).join('');

            if (data.providerSummary.length === 0) {
                summary.innerHTML = `
                    <div style="background: linear-gradient(135deg, #22c55e 0%, #15803d 100%); color: white; padding: 16px 20px; border-radius: 12px;">
                        <div style="font-size: 20px; font-weight: 600;"><i class="fas fa-check-circle"></i> All Clear!</div>
                        <div style="opacity: 0.9;">No unresolved provider errors</div>
                    </div>
                `;
            }
        }

        // Render errors table
        if (providerErrorsCache.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px; color: #22c55e;">
                        <i class="fas fa-check-circle" style="font-size: 48px; margin-bottom: 12px;"></i>
                        <div style="font-size: 18px; font-weight: 600;">No provider errors!</div>
                        <div style="color: #94a3b8;">All provider APIs are working correctly</div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = providerErrorsCache.map(err => {
            const order = err.order || {};
            const service = order.service || {};
            const provider = err.provider || {};  // REMOVED: service.provider fallback
            const user = order.user || {};
            
            const orderId = order.order_number || order.public_id || order.id?.substring(0, 8) || 'N/A';
            const providerName = provider.name || 'Unknown';
            const servicePublicId = service.public_id || 'N/A';
            const serviceName = service.name || 'Unknown Service';
            const serviceDisplay = `#${escapeHtml(servicePublicId)} · ${escapeHtml(serviceName)}`;
            const customerEmail = user.email || user.username || 'Unknown';
            const errorTime = err.error_timestamp ? new Date(err.error_timestamp).toLocaleString() : 'N/A';
            const retryCount = err.retry_count || 0;
            
            // Calculate provider cost if not recorded: quantity * (provider_rate / 1000)
            let providerCharge = Number(order.provider_cost || 0);
            if (providerCharge === 0 && order.quantity && service.rate) {
                const retailRate = Number(service.rate || 0);
                const markup = Number(service.provider?.markup || 0);
                if (retailRate > 0 && markup !== undefined) {
                    // Calculate provider rate: rate / (1 + markup%)
                    const providerRate = markup > -100 ? retailRate / (1 + markup / 100) : null;
                    if (providerRate !== null && providerRate > 0) {
                        // Calculate charge: quantity * (providerRate / 1000)
                        providerCharge = (providerRate * Number(order.quantity)) / 1000;
                    }
                }
            }

            return `
                <tr data-error-id="${err.id}">
                    <td>
                        <div style="font-weight: 600; color: #dc2626;">${escapeHtml(providerName)}</div>
                        <div style="font-size: 11px; color: #64748b;">${escapeHtml(provider.api_url?.substring(0, 30) || 'N/A')}...</div>
                    </td>
                    <td>
                        <div style="font-weight: 500;">#${escapeHtml(orderId)}</div>
                        <div style="font-size: 11px; color: #64748b;">Provider ID: ${escapeHtml(order.provider_order_id || 'N/A')}</div>
                    </td>
                    <td style="max-width: 250px;">
                        <div style="color: #dc2626; font-size: 13px; word-break: break-word;">${escapeHtml(err.error_message || 'Unknown error')}</div>
                    </td>
                    <td>
                        <div style="font-size: 13px;" title="${serviceDisplay}">${serviceDisplay}</div>
                        <div style="font-size: 11px; color: #64748b;">${escapeHtml(service.category || 'N/A')}</div>
                    </td>
                    <td>
                        <div style="font-size: 13px;">${escapeHtml(customerEmail)}</div>
                        <div style="font-size: 11px; color: #64748b;">$${Number(order.charge || 0).toFixed(2)}</div>
                    </td>
                    <td style="text-align: center;">
                        <div style="font-size: 13px; font-weight: 500;">$${providerCharge.toFixed(5).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')}</div>
                    </td>
                    <td style="text-align: center;">
                        <span style="background: ${retryCount > 2 ? '#dc2626' : '#f59e0b'}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">${retryCount}</span>
                    </td>
                    <td style="font-size: 12px; color: #64748b;">${errorTime}</td>
                    <td>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn-secondary btn-sm" onclick="showProviderErrorDetailsFromList('${err.id}')" title="View Details" style="background: #1e40af;">
                                <i class="fas fa-info-circle"></i>
                            </button>
                            <button class="btn-secondary btn-sm" onclick="retryProviderOrder('${order.id}')" title="Retry Order">
                                <i class="fas fa-redo"></i>
                            </button>
                            <button class="btn-secondary btn-sm" onclick="resolveProviderError('${err.id}')" title="Mark Resolved">
                                <i class="fas fa-check"></i>
                            </button>
                            <button class="btn-secondary btn-sm" onclick="viewOrderDetails('${order.id}')" title="View Order">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');

        // Update badge
        const badge = document.getElementById('providerErrorCount');
        if (badge) badge.textContent = data.totalUnresolved || 0;

    } catch (error) {
        console.error('[PROVIDER ERRORS] Load error:', error);
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 40px; color: #dc2626;">
                    <i class="fas fa-exclamation-circle" style="font-size: 48px; margin-bottom: 12px;"></i>
                    <div>Failed to load provider errors</div>
                    <button class="btn-secondary" onclick="loadProviderErrors()" style="margin-top: 12px;">
                        <i class="fas fa-redo"></i> Retry
                    </button>
                </td>
            </tr>
        `;
    }
}

/**
 * Resolve/dismiss a provider error
 */
async function resolveProviderError(errorId) {
    if (!errorId) return;

    const notes = prompt('Add resolution notes (optional):');
    if (notes === null) return; // User cancelled

    try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('Not authenticated');

        const response = await fetch('/.netlify/functions/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'resolve-provider-error',
                errorId,
                notes
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to resolve error');
        }

        showNotification('Error marked as resolved', 'success');
        await loadProviderErrors();
        await loadProviderErrorCount();

    } catch (error) {
        console.error('[PROVIDER ERRORS] Resolve error:', error);
        showNotification(error.message || 'Failed to resolve error', 'error');
    }
}

/**
 * Retry a failed order with provider
 */
async function retryProviderOrder(orderId) {
    if (!orderId) return;

    if (!confirm('Resend this order to the provider?')) return;

    try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error('Not authenticated');

        const response = await fetch('/.netlify/functions/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                action: 'resend_order',
                order_id: orderId
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to resend order');
        }

        showNotification(data.message || 'Order resent to provider', 'success');
        await loadProviderErrors();

    } catch (error) {
        console.error('[PROVIDER ERRORS] Retry error:', error);
        showNotification(error.message || 'Failed to retry order', 'error');
    }
}

// Current error being displayed in modal
let currentErrorOrderId = null;
let currentErrorId = null;

/**
 * Show detailed error modal for an order
 */
function showOrderErrorDetails(orderId) {
    if (!orderId) return;
    
    // Find the order in cache
    const order = ordersCache.find(o => String(o.id) === String(orderId));
    if (!order) {
        console.error('[ERROR MODAL] Order not found:', orderId);
        showNotification('Order not found', 'error');
        return;
    }

    currentErrorOrderId = orderId;
    currentErrorId = order.failure_log?.id || null;

    // SAFETY: Extract all order-related data FIRST to prevent TDZ errors
    const orderData = extractOrderData(order);
    const { orderService, orderUser, providerName, providerApiUrl, serviceName } = orderData;
    const provider = order.failure_log?.provider || orderService?.provider || {};
    
    // Populate modal fields
    const modal = document.getElementById('providerErrorModal');
    if (!modal) {
        console.error('[ERROR MODAL] Modal element not found');
        return;
    }

    // Provider info
    document.getElementById('errorProviderName').textContent = provider.name || providerName;
    document.getElementById('errorProviderUrl').textContent = provider.api_url || providerApiUrl || 'N/A';

    // Error details
    const errorMessage = order.provider_error 
        || order.failure_reason 
        || order.failure_log?.error_message 
        || order.provider_response?.error 
        || 'Unknown error';
    document.getElementById('errorMessageFull').textContent = errorMessage;
    document.getElementById('errorCode').textContent = order.failure_code || order.failure_log?.failure_code || 'N/A';
    document.getElementById('errorRetryCount').textContent = order.failure_log?.retry_count || 0;
    document.getElementById('errorTimestamp').textContent = order.failure_log?.error_timestamp 
        ? new Date(order.failure_log.error_timestamp).toLocaleString()
        : order.updated_at 
            ? new Date(order.updated_at).toLocaleString()
            : 'N/A';

    // Order info
    const orderId_display = order.order_number || order.public_id || order.id?.substring(0, 8) || 'N/A';
    document.getElementById('errorOrderId').textContent = `#${orderId_display}`;
    document.getElementById('errorProviderOrderId').textContent = order.provider_order_id || 'N/A';
    document.getElementById('errorServiceName').textContent = serviceName;
    document.getElementById('errorCustomer').textContent = orderUser?.email || orderUser?.username || 'Unknown';
    document.getElementById('errorCharge').textContent = `$${Number(order.charge || 0).toFixed(2)}`;
    document.getElementById('errorLink').innerHTML = order.link 
        ? `<a href="${order.link}" target="_blank" rel="noopener" style="color: #60a5fa;">${truncateText(order.link, 40)}</a>`
        : 'N/A';

    // Raw API response (if available)
    const rawResponseSection = document.getElementById('errorModalResponse');
    const rawResponsePre = document.getElementById('errorRawResponse');
    if (order.provider_response || order.failure_log?.failure_context || order.failure_metadata) {
        rawResponseSection.style.display = 'block';
        const responseData = order.provider_response || order.failure_log?.failure_context || order.failure_metadata;
        rawResponsePre.textContent = typeof responseData === 'string' 
            ? responseData 
            : JSON.stringify(responseData, null, 2);
    } else {
        rawResponseSection.style.display = 'none';
    }

    // Update modal title with provider name
    const titleSpan = document.getElementById('errorModalTitle');
    if (titleSpan) {
        titleSpan.textContent = provider.name 
            ? `${provider.name} API Error` 
            : 'Provider API Error Details';
    }

    // Show modal
    modal.style.display = 'flex';
}

/**
 * Show error details for a provider error from the errors table
 */
function showProviderErrorDetailsFromList(errorId) {
    if (!errorId) return;
    
    const error = providerErrorsCache.find(e => String(e.id) === String(errorId));
    if (!error) {
        console.error('[ERROR MODAL] Error not found:', errorId);
        return;
    }

    currentErrorId = errorId;
    currentErrorOrderId = error.order?.id || null;

    const order = error.order || {};
    const service = order.service || {};
    const provider = error.provider || service.provider || {};
    const user = order.user || {};

    // Populate modal
    const modal = document.getElementById('providerErrorModal');
    if (!modal) return;

    document.getElementById('errorProviderName').textContent = provider.name || 'Unknown Provider';
    document.getElementById('errorProviderUrl').textContent = provider.api_url || 'N/A';
    document.getElementById('errorMessageFull').textContent = error.error_message || 'Unknown error';
    document.getElementById('errorCode').textContent = error.failure_code || 'N/A';
    document.getElementById('errorRetryCount').textContent = error.retry_count || 0;
    document.getElementById('errorTimestamp').textContent = error.error_timestamp 
        ? new Date(error.error_timestamp).toLocaleString() 
        : 'N/A';

    const orderId_display = order.order_number || order.public_id || order.id?.substring(0, 8) || 'N/A';
    document.getElementById('errorOrderId').textContent = `#${orderId_display}`;
    document.getElementById('errorProviderOrderId').textContent = order.provider_order_id || 'N/A';
    document.getElementById('errorServiceName').textContent = service.name || 'Unknown Service';
    document.getElementById('errorCustomer').textContent = user.email || user.username || 'Unknown';
    document.getElementById('errorCharge').textContent = `$${Number(order.charge || 0).toFixed(2)}`;
    document.getElementById('errorLink').innerHTML = order.link 
        ? `<a href="${order.link}" target="_blank" rel="noopener" style="color: #60a5fa;">${truncateText(order.link, 40)}</a>`
        : 'N/A';

    // Show failure context if available
    const rawResponseSection = document.getElementById('errorModalResponse');
    const rawResponsePre = document.getElementById('errorRawResponse');
    if (error.failure_context) {
        rawResponseSection.style.display = 'block';
        rawResponsePre.textContent = typeof error.failure_context === 'string'
            ? error.failure_context
            : JSON.stringify(error.failure_context, null, 2);
    } else {
        rawResponseSection.style.display = 'none';
    }

    document.getElementById('errorModalTitle').textContent = provider.name 
        ? `${provider.name} API Error`
        : 'Provider API Error Details';

    modal.style.display = 'flex';
}

/**
 * Close provider error modal
 */
function closeProviderErrorModal() {
    const modal = document.getElementById('providerErrorModal');
    if (modal) {
        modal.style.display = 'none';
    }
    currentErrorOrderId = null;
    currentErrorId = null;
}

/**
 * Retry order from error modal
 */
async function retryErrorOrder() {
    if (!currentErrorOrderId) {
        showNotification('No order selected', 'error');
        return;
    }
    
    closeProviderErrorModal();
    await retryProviderOrder(currentErrorOrderId);
}

/**
 * Resolve error from modal
 */
async function resolveErrorFromModal() {
    if (!currentErrorId) {
        showNotification('No error ID available', 'error');
        return;
    }
    
    closeProviderErrorModal();
    await resolveProviderError(currentErrorId);
}

// Close modal when clicking outside
document.addEventListener('click', (e) => {
    const modal = document.getElementById('providerErrorModal');
    if (modal && e.target === modal) {
        closeProviderErrorModal();
    }
});

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeProviderErrorModal();
    }
});

// Add CSS animation for pulsing badge
const pulseStyle = document.createElement('style');
pulseStyle.textContent = `
    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
    }
    .provider-errors-tab:hover {
        background: #b91c1c !important;
    }
    .btn-sm {
        padding: 4px 8px !important;
        font-size: 12px !important;
    }
`;
document.head.appendChild(pulseStyle);
