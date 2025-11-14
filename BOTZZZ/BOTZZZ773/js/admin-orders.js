// Admin Orders Management with Real Modals

let servicesCache = [];
const ADMIN_SERVICES_ENDPOINT = '/.netlify/functions/services?audience=admin';
let ordersCache = [];
let ordersAutoRefreshTimer = null;
let lastOrderSyncTime = 0;
let ordersSyncInFlight = false;
const ORDERS_SYNC_MIN_INTERVAL = 30000; // 30 seconds
const ORDERS_AUTO_REFRESH_INTERVAL = 30000; // 30 seconds
const DEFAULT_ORDER_REFERENCE_BASE = 7000000;
let highestOrderIdHint = DEFAULT_ORDER_REFERENCE_BASE;
const selectedOrderIds = new Set();
const servicesOptionsState = {
    lastUpdated: null,
    hasServices: false,
    error: null
};

function getOrderById(orderId) {
    if (orderId === undefined || orderId === null) return undefined;
    const lookup = String(orderId);
    return ordersCache.find(order => {
        if (String(order.id) === lookup) return true;
        if (formatProviderOrderId(order.provider_order_id) === formatProviderOrderId(lookup)) return true;
        if (order.provider_order_id && String(order.provider_order_id) === lookup) return true;
        if (order.link && String(order.link) === lookup) return true;
        return false;
    });
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

function truncateText(text, maxLength = 48) {
    if (!text) return '';
    const normalized = String(text);
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.substring(0, maxLength)}...`;
}

function formatProviderOrderId(value) {
    if (value === undefined || value === null) return null;
    const normalized = String(value).trim();
    if (!normalized) return null;
    return normalized.startsWith('#') ? normalized : `#${normalized}`;
}

function getStatusKey(status) {
    const normalized = String(status || '').toLowerCase();
    if (!normalized) return 'unknown';
    if (normalized === 'cancelled') return 'canceled';
    return normalized.replace(/[^a-z0-9]+/g, '-');
}

function formatStatusLabel(status) {
    if (!status) return 'Unknown';
    const value = String(status).replace(/[_-]+/g, ' ').trim();
    return value.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function getStatusColor(statusKey) {
    switch (statusKey) {
        case 'completed':
            return '#22c55e';
        case 'pending':
        case 'awaiting':
            return '#eab308';
        case 'processing':
        case 'in-progress':
        case 'refilling':
            return '#3b82f6';
        case 'partial':
            return '#f97316';
        case 'canceled':
        case 'cancelled':
        case 'fail':
        case 'failed':
            return '#ef4444';
        default:
            return '#94a3b8';
    }
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

// Resolve provider information from the order payload regardless of shape
function resolveOrderProvider(order, orderService) {
    const service = orderService || order?.service || order?.services || null;
    const providerCandidates = [
        order?.provider,
        order?.providers,
        order?.provider_info,
        order?.providerDetails,
        service?.provider,
        service?.providers
    ];

    let providerObject = null;
    let rawName = null;

    for (const candidate of providerCandidates) {
        if (!candidate) {
            continue;
        }

        if (Array.isArray(candidate)) {
            for (const entry of candidate) {
                if (!entry) {
                    continue;
                }
                if (typeof entry === 'object') {
                    providerObject = entry;
                    break;
                }
                if (!rawName && typeof entry === 'string') {
                    rawName = entry.trim();
                }
            }

            if (providerObject) {
                break;
            }
            continue;
        }

        if (typeof candidate === 'object') {
            providerObject = candidate;
            break;
        }

        if (typeof candidate === 'string') {
            rawName = candidate.trim();
            break;
        }
    }

    const nameCandidates = [
        rawName,
        providerObject?.name,
        providerObject?.providerName,
        providerObject?.title,
        providerObject?.label,
        order?.provider_name,
        order?.providerName,
        service?.provider_name,
        service?.providerName
    ];

    const providerName = nameCandidates.find(value => typeof value === 'string' && value.trim().length > 0)?.trim() || 'Unknown Provider';

    return {
        provider: providerObject,
        providerName
    };
}

// Build consistent provider order ID markup with graceful fallback
function buildProviderOrderIdMarkup(providerName, providerOrderId) {
    const safeName = providerName && providerName.trim().length > 0 ? providerName.trim() : 'Unknown Provider';

    if (providerOrderId) {
        const label = truncateText(String(providerOrderId), 30);
        const title = escapeHtml(String(providerOrderId));
        return `<span class="order-id-provider" title="${title}"><strong>${escapeHtml(safeName)}:</strong> ${escapeHtml(label)}</span>`;
    }

    return `<span class="order-id-provider order-id-missing"><strong>${escapeHtml(safeName)}:</strong> Not submitted</span>`;
}

// Normalize order identifiers for consistent display
function resolveOrderIdentifiers(order, orderService = null) {
    const service = orderService || order?.service || order?.services || null;
    const uuidRaw = order?.id ? String(order.id) : null;
    const candidateValues = [
        order?.order_number,
        order?.customer_order_number,
        order?.customer_order_id,
        order?.display_id,
    order?.public_id,
        order?.reference,
        order?.external_order_id,
        order?.external_id
    ];

    let customerFacing = candidateValues.find(value => {
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
    });

    if (typeof customerFacing === 'number') {
        customerFacing = String(customerFacing);
    }

    const cleanUuidShort = uuidRaw
        ? uuidRaw.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase()
        : null;

    const primaryLabel = customerFacing
        ? `#${escapeHtml(String(customerFacing).trim())}`
        : cleanUuidShort
            ? `#${escapeHtml(cleanUuidShort)}`
            : '#—';

    // Prioritize provider_order_id (the actual order ID from the provider) over provider_service_id
    const providerOrderIdCandidates = [
        order?.provider_order_id,
        order?.providerOrderId,
        order?.external_order_id,
        order?.meta?.provider_order_id
    ];

    const providerOrderId = providerOrderIdCandidates.find(value => {
        if (value === undefined || value === null) {
            return false;
        }
        const stringValue = String(value).trim();
        return stringValue.length > 0 && stringValue.toLowerCase() !== 'null';
    });

    const internalLabel = providerOrderId
        ? `<span class="cell-secondary cell-muted" title="Provider order identifier">Provider Order: ${escapeHtml(String(providerOrderId).trim())}</span>`
        : uuidRaw
            ? `<span class="cell-secondary cell-muted" title="${escapeHtml(uuidRaw)}">UUID: ${escapeHtml(truncateText(uuidRaw, 12))}</span>`
            : '';

    return { primaryLabel, internalLabel };
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
    ordersCache.forEach((order, index) => {
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
    });
    for (const id of Array.from(selectedOrderIds)) {
        if (!validIds.has(String(id))) {
            selectedOrderIds.delete(id);
        }
    }
}

function bindOrderSelectionEvents() {
    document.querySelectorAll('.order-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', handleOrderSelectionChange);
    });
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

function updateSelectedOrdersSummary() {
    const countEl = document.getElementById('selectedOrdersCount');
    const detailEl = document.getElementById('selectedOrdersDetail');
    const cardEl = document.getElementById('selectedOrdersCard');

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

    syncOrdersMasterToggle();
}

function syncOrdersMasterToggle() {
    const masterToggle = document.querySelector('th input[type="checkbox"][aria-label="Select all orders"]');
    if (!masterToggle) {
        return;
    }

    const checkboxes = Array.from(document.querySelectorAll('.order-checkbox'));
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

function toggleAllOrders(masterCheckbox) {
    if (!masterCheckbox) {
        return;
    }

    const checkboxes = document.querySelectorAll('.order-checkbox');
    const shouldSelectAll = masterCheckbox.checked;
    masterCheckbox.indeterminate = false;

    selectedOrderIds.clear();
    checkboxes.forEach(checkbox => {
        checkbox.checked = shouldSelectAll;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

async function syncOrderStatuses({ silent = false, force = false } = {}) {
    if (ordersSyncInFlight) {
        return { skipped: true, reason: 'in-flight' };
    }

    const now = Date.now();
    if (!force && lastOrderSyncTime && now - lastOrderSyncTime < ORDERS_SYNC_MIN_INTERVAL) {
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

    try {
        console.log('[SYNC] Starting order status sync...');
        const response = await fetch('/.netlify/functions/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ action: 'sync-status' })
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
            showNotification(`Synced ${result.updated || 0} orders with providers`, 'success');
        }

        console.log('[SYNC] Sync completed successfully');
        return {
            success: true,
            updated: result.updated || 0,
            results: result.results || []
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
        ordersSyncInFlight = false;
        if (syncButton && originalLabel !== null) {
            syncButton.disabled = false;
            syncButton.innerHTML = originalLabel;
        }
    }
}

async function manualOrdersSync() {
    await syncOrderStatuses({ force: true });
    await loadOrders({ skipSync: true });
}

function startOrdersAutoRefresh() {
    if (ordersAutoRefreshTimer) {
        clearInterval(ordersAutoRefreshTimer);
    }

    ordersAutoRefreshTimer = setInterval(async () => {
        await syncOrderStatuses({ silent: true });
        await loadOrders({ skipSync: true });
    }, ORDERS_AUTO_REFRESH_INTERVAL);
}

async function initializeOrdersPage() {
    updateOrdersSyncStatus('Provider sync pending...');
    await syncOrderStatuses({ silent: true, force: true });
    await loadOrders({ skipSync: true });
    startOrdersAutoRefresh();
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

// Filter orders by status
function filterOrders(status) {
    const rows = document.querySelectorAll('#ordersTableBody tr');
    const tabs = document.querySelectorAll('.filter-tab');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    document.querySelector(`[data-status="${status}"]`)?.classList.add('active');
    
    if (status === 'all') {
        rows.forEach(row => row.style.display = '');
    } else {
        rows.forEach(row => {
            if (row.dataset.status === status) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }
}

// View order details
function viewOrder(orderId) {
    const content = `
        <div class="user-details">
            <div class="user-detail-section">
                <h4><i class="fas fa-info-circle"></i> Order Details</h4>
                <div class="detail-row">
                    <span class="detail-label">Order ID:</span>
                    <span class="detail-value">#${orderId}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label" style="color: #888;">Loading order details...</span>
                </div>
            </div>
            <div class="user-detail-section" style="text-align: center; padding: 40px 20px; color: #888;">
                <i class="fas fa-spinner fa-spin" style="font-size: 32px; color: #FF1494; margin-bottom: 16px;"></i>
                <p>Fetching order information from database...</p>
            </div>
            <div class="user-detail-section" style="display: none;">
                <h4><i class="fas fa-clock"></i> Timeline</h4>
                <div class="detail-row">
                    <span class="detail-label">Created:</span>
                    <span class="detail-value">-</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Started:</span>
                    <span class="detail-value">-</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Mode:</span>
                    <span class="detail-value">-</span>
                </div>
            </div>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="editOrder(${orderId})">
            <i class="fas fa-edit"></i> Edit
        </button>
        <button type="button" class="btn-primary" onclick="closeModal()">Close</button>
    `;
    
    createModal(`Order #${orderId} Details`, content, actions);
}

// Edit order
async function editOrder(orderId) {
    const servicesOptions = await getServicesOptions();
    
    const content = `
        <form id="editOrderForm" onsubmit="submitEditOrder(event, ${orderId})" class="admin-form">
            <div class="form-group">
                <label>Service</label>
                <select name="service" required>
                    ${servicesOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Link</label>
                <input type="url" name="link" value="https://www.instagram.com/username/" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <span class="detail-label">Quantity:</span>
                    <input type="number" name="quantity" value="1000" min="1" required>
                </div>
                <div class="form-group">
                    <label>Charge</label>
                    <input type="number" name="charge" value="12.50" min="0" step="0.01" required>
                </div>
            </div>
            <div class="form-group">
                <label>Status</label>
                <select name="status">
                    <option value="Pending">Pending</option>
                    <option value="In progress" selected>In progress</option>
                    <option value="Completed">Completed</option>
                    <option value="Partial">Partial</option>
                    <option value="Canceled">Canceled</option>
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
}

function submitEditOrder(event, orderId) {
    event.preventDefault();
    showNotification(`Order #${orderId} updated successfully!`, 'success');
    closeModal();
}

// Refill order
function refillOrder(orderId) {
    const content = `
        <div class="confirmation-message">
            <i class="fas fa-redo-alt" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>Refill order #${orderId}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will add the order back to the queue for processing. The remaining quantity will be fulfilled.
            </p>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="confirmRefillOrder(${orderId})">
            <i class="fas fa-redo-alt"></i> Refill Order
        </button>
    `;
    
    createModal('Refill Order', content, actions);
}

function confirmRefillOrder(orderId) {
    showNotification(`Order #${orderId} refill requested successfully`, 'success');
    closeModal();
}

// Cancel order
function cancelOrder(orderId) {
    const content = `
        <div class="confirmation-message danger">
            <i class="fas fa-times-circle" style="font-size: 48px; color: #ef4444; margin-bottom: 20px;"></i>
            <p>Cancel order #${orderId}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will stop the order processing and mark it as canceled. This action cannot be undone.
            </p>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Keep Order</button>
        <button type="button" class="btn-danger" onclick="confirmCancelOrder(${orderId})">
            <i class="fas fa-times"></i> Cancel Order
        </button>
    `;
    
    createModal('Cancel Order', content, actions);
}

function confirmCancelOrder(orderId) {
    showNotification(`Order #${orderId} has been canceled`, 'success');
    closeModal();
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
                    <input type="number" name="charge" placeholder="12.50" min="0" step="0.01">
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

function confirmExport(format) {
    showNotification(`Exporting orders to ${format.toUpperCase()}...`, 'success');
    closeModal();
    
    // Simulate download
    setTimeout(() => {
        showNotification(`Orders exported successfully!`, 'success');
    }, 1500);
}

// Initialize search
document.addEventListener('DOMContentLoaded', async () => {
    initializeOrdersQuickActions();
    if (typeof handleSearch === 'function') {
        handleSearch('orderSearch', 'ordersTable');
    }
    
    // Add filter change listeners
    const filters = ['dateFilter', 'serviceFilter', 'providerFilter', 'modeFilter'];
    filters.forEach(filterId => {
        const filter = document.getElementById(filterId);
        if (filter) {
            filter.addEventListener('change', applyFilters);
        }
    });

    try {
        await initializeOrdersPage();
    } catch (error) {
        console.error('Failed to initialize orders page:', error);
        updateOrdersSyncStatus('Failed to load orders', 'error');
    }
});

// Apply all filters
function applyFilters() {
    const dateFilter = document.getElementById('dateFilter')?.value;
    const serviceFilter = document.getElementById('serviceFilter')?.value;
    const providerFilter = document.getElementById('providerFilter')?.value;
    const modeFilter = document.getElementById('modeFilter')?.value;
    
    // In production, this would make an API call with filter parameters
    console.log('Applying filters:', {
        date: dateFilter,
        service: serviceFilter,
        provider: providerFilter,
        mode: modeFilter
    });
}

// Load real orders from database
async function loadOrders({ skipSync = false } = {}) {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) {
        console.error('[ORDERS] Table body element not found!');
        return;
    }

    tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading orders...</td></tr>';

    try {
        if (!skipSync) {
            console.log('[ORDERS] Syncing order statuses first...');
            await syncOrderStatuses({ silent: true });
        }

        const token = localStorage.getItem('token');
        if (!token) {
            console.error('[ORDERS] No auth token found!');
            throw new Error('Not authenticated');
        }

        console.log('[ORDERS] Fetching orders from API...');
        const response = await fetch('/.netlify/functions/orders', {
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
        pruneSelectedOrderIds();

        if (ordersCache.length > 0) {
            tbody.innerHTML = '';

            let mostRecentSync = lastOrderSyncTime;

            ordersCache.forEach((order, index) => {
                const createdDate = order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A';
                const orderStatusKey = getStatusKey(order.status);
                const providerStatusRaw = resolveProviderStatus(order);
                const providerStatusKey = getStatusKey(providerStatusRaw);
                const providerStatusLabel = formatStatusLabel(providerStatusRaw);
                const lastSync = order.last_status_sync ? new Date(order.last_status_sync).getTime() : null;
                if (lastSync && lastSync > mostRecentSync) {
                    mostRecentSync = lastSync;
                }

                const orderUser = order.user || order.users || null;
                const orderService = order.service || order.services || null;
                const orderIdString = order.id !== undefined && order.id !== null ? String(order.id) : '';
                const orderIdDisplay = escapeHtml(orderIdString);
                const orderPrimaryLabel = orderIdString ? `#${orderIdDisplay}` : 'Pending ID';
                const formattedProviderOrderId = formatProviderOrderId(order.provider_order_id);
                const providerOrderLabel = formattedProviderOrderId ? truncateText(formattedProviderOrderId, 30) : '';
                const providerOrderTitle = formattedProviderOrderId ? escapeHtml(formattedProviderOrderId) : '';
                const providerOrderMarkup = formattedProviderOrderId
                    ? `<span class="order-id-provider" title="${providerOrderTitle}">Provider Order ID: ${escapeHtml(providerOrderLabel)}</span>`
                    : '<span class="order-id-provider order-id-missing">Provider Order ID: Pending</span>';


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
                const customerCharge = toNumberOrNull(order.charge);
                const providerCost = toNumberOrNull(order.provider_cost);
                const profitValue = (customerCharge !== null && providerCost !== null && providerCurrency === defaultCurrency)
                    ? Number((customerCharge - providerCost).toFixed(2))
                    : null;
                const profitPercent = (profitValue !== null && customerCharge !== null && customerCharge !== 0)
                    ? Number(((profitValue / customerCharge) * 100).toFixed(1))
                    : null;
                const profitClass = profitValue !== null && profitValue < 0 ? 'profit-negative' : 'profit-positive';
                const profitMarkup = profitValue !== null
                    ? `<span class="cell-secondary ${profitClass}">Profit: ${formatCurrency(profitValue)}${profitPercent !== null ? ` (${profitPercent > 0 ? '+' : ''}${profitPercent.toFixed(1)}%)` : ''}</span>`
                    : '';

                const providerStatusDot = `<span class="provider-status-dot" style="background: ${getStatusColor(providerStatusKey)};"></span>`;
                const providerStatusMarkup = `
                    <span class="provider-status-row">
                        ${providerStatusDot}
                        <span class="provider-status-label">Provider: ${escapeHtml(providerStatusLabel)}</span>
                    </span>
                `;

                const lastSyncLabel = formatRelativeTime(order.last_status_sync);
                    const providerIdSecondaryLabel = formattedProviderOrderId
                        ? `Provider Order ID: ${formattedProviderOrderId}`
                        : 'Provider Order ID: Pending';
                    const providerIdSecondaryTitle = escapeHtml(lastSyncLabel);
                const ariaLabelId = orderIdString ? `Select order #${orderIdString}` : 'Select order';
                const selectionKeyRaw = buildOrderSelectionKey(order, index);
                const orderSelectionAttr = escapeHtml(selectionKeyRaw);

                const actions = buildOrderActions(order);

                const row = `
                    <tr data-status="${orderStatusKey}" data-order-id="${orderSelectionAttr}">
                        <td><input type="checkbox" class="order-checkbox" data-order-id="${orderSelectionAttr}" aria-label="${escapeHtml(ariaLabelId)}"></td>
                        <td>
                            <div class="order-id-cell">
                                <span class="order-id-primary">${orderPrimaryLabel}</span>
                                ${providerOrderMarkup}
                            </div>
                        </td>
                        <td>${escapeHtml(orderUser?.username || orderUser?.email || 'Unknown')}</td>
                        <td>
                            <div class="cell-stack">
                                <span class="cell-primary cell-highlight">IN: ${formatCurrency(customerCharge)}</span>
                                <span class="cell-secondary">OUT: ${formatCurrency(providerCost, 4, 'N/A', providerCurrency)}</span>
                                ${profitMarkup}
                            </div>
                        </td>
                        <td>${linkMarkup}</td>
                        <td>${escapeHtml(String(startCount))}</td>
                        <td>${escapeHtml(String(quantity))}</td>
                        <td>${escapeHtml(orderService?.name || 'Unknown Service')}</td>
                        <td>
                            <div class="cell-stack">
                                <span class="status-badge ${orderStatusKey}">${escapeHtml(formatStatusLabel(order.status))}</span>
                                ${providerStatusMarkup}
                                    <span class="cell-secondary cell-muted"${providerIdSecondaryTitle ? ` title="${providerIdSecondaryTitle}"` : ''}>${escapeHtml(providerIdSecondaryLabel)}</span>
                            </div>
                        </td>
                        <td>${escapeHtml(String(remains))}</td>
                        <td>${escapeHtml(createdDate)}</td>
                        <td>${escapeHtml(order.mode || 'Auto')}</td>
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
            });

            restoreOrderSelectionState();
            bindOrderSelectionEvents();
            updateSelectedOrdersSummary();

            if (mostRecentSync > 0) {
                lastOrderSyncTime = mostRecentSync;
                updateOrdersSyncStatus(formatRelativeTime(new Date(mostRecentSync).toISOString()), 'success');
            }

            const paginationInfo = document.getElementById('paginationInfo');
            if (paginationInfo) {
                const count = ordersCache.length;
                paginationInfo.textContent = `Showing ${count > 0 ? '1' : '0'}-${Math.min(count, 50)} of ${count}`;
            }
        } else {
            console.log('[ORDERS] No orders found in response');
            tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px; color: #888;">No orders found</td></tr>';
            ordersCache = [];
            selectedOrderIds.clear();
            updateSelectedOrdersSummary();
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
async function getServicesOptions() {
    if (servicesCache.length > 0) {
        servicesOptionsState.hasServices = servicesCache.length > 0;
        servicesOptionsState.error = null;
        servicesOptionsState.lastUpdated = Date.now();
        return buildServicesOptionsHTML(servicesCache);
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
        return buildServicesOptionsHTML(servicesCache);
    } catch (error) {
        console.error('Failed to load services:', error);
        servicesCache = [];
        servicesOptionsState.hasServices = false;
        servicesOptionsState.error = error instanceof Error ? error.message : String(error);
        servicesOptionsState.lastUpdated = Date.now();
        return '<option value="">Failed to load services</option>';
    }
}

function buildServicesOptionsHTML(services) {
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
            const rate = parseFloat(service.rate || 0).toFixed(2);
            html += `<option value="${service.id}">${escapeHtml(service.name)} - $${rate}/1k</option>`;
        });
        html += '</optgroup>';
    });
    
    return html;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
