// Admin Refunds Management (read-only view)
window.initializeAdminPopupSurface?.('Admin refunds window');

let refundsCache = [];
let refundsUserLookup = {};
const selectedRefundIds = new Set();
let refundsLoading = false;

function escapeHtml(text = '') {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatCurrency(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '$0.00';
    }
    return `$${number.toFixed(2)}`;
}

function getRefundById(refundId) {
    const idString = String(refundId);
    return refundsCache.find(refund => String(refund.id) === idString);
}

function updateRefundsSelectionSummary() {
    const info = document.getElementById('refundsPaginationInfo');
    if (info) {
        const total = refundsCache.length;
        const selected = selectedRefundIds.size;
        info.textContent = selected > 0
            ? `${selected} selected • ${total} total`
            : `Showing latest ${total} refunds`;
    }
}

function toggleAllRefunds(masterCheckbox) {
    if (!masterCheckbox) return;
    const checkboxes = document.querySelectorAll('.refund-checkbox');
    const shouldSelectAll = masterCheckbox.checked;
    masterCheckbox.indeterminate = false;
    checkboxes.forEach(cb => {
        cb.checked = shouldSelectAll;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

function bindRefundSelectionEvents() {
    document.querySelectorAll('.refund-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (event) => {
            const id = event.target.dataset.refundId;
            if (!id) return;
            if (event.target.checked) {
                selectedRefundIds.add(id);
            } else {
                selectedRefundIds.delete(id);
            }
            const row = event.target.closest('tr');
            if (row) {
                row.classList.toggle('is-selected', event.target.checked);
            }
            updateRefundsSelectionSummary();
        });
    });
}

function renderRefundsTable(refunds) {
    const tbody = document.getElementById('refundsTableBody');
    if (!tbody) return;

    if (!refunds || refunds.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px; color: #888;">No refunds found</td></tr>';
        updateRefundsSelectionSummary();
        return;
    }

    tbody.innerHTML = '';

    refunds.forEach(refund => {
        const userMeta = refundsUserLookup[refund.user_id] || {};
        const userLabel = userMeta.username || userMeta.email || 'Unknown';

        // Prefer human-friendly order number (e.g., 37000016). Fallbacks ensure we avoid UUIDs in the column.
        const memoNumberMatch = (refund.memo || '').match(/\b(\d{6,})\b/);
        const orderNumber = refund.order_number
            || refund.order_reference
            || refund.gateway_response?.order_number
            || refund.gateway_response?.orderNumber
            || (memoNumberMatch ? memoNumberMatch[1] : null)
            || (refund.order_id ? String(refund.order_id).slice(0, 12) + '…' : '-')
            || '-';
        const singleAmount = Math.abs(Number(refund.amount || 0));
        const totalAmount = singleAmount * (Number(refund.refund_count_for_order || 1));
        const amountDisplay = formatCurrency(refund.amount);
        const totalAmountDisplay = formatCurrency(totalAmount);
        const createdDate = refund.created_at ? new Date(refund.created_at).toLocaleString() : '-';
        const refundApplied = refund.refund_count_for_order ? `x${refund.refund_count_for_order}` : 'x1';
        const rawReason = (refund.gateway_response?.reason || '').toLowerCase();
        const rawSource = (refund.gateway_response?.source || '').toLowerCase();
        const source = rawSource.includes('handlecancelorder')
            ? 'Admin'
            : rawSource.includes('sync') || rawSource.includes('provider')
                ? 'Provider Sync'
                : (refund.gateway_response?.source || '-');
        const reason = rawReason.includes('order_canceled') || rawReason.includes('order_cancelled')
            ? (source === 'Admin' ? 'Admin canceled' : 'Provider canceled')
            : (refund.gateway_response?.reason || '-');
        const statusKey = (refund.status || '').toLowerCase();
        const statusClass = statusKey === 'refunded' ? 'completed' : statusKey === 'pending' ? 'pending' : 'failed';
        const statusLabel = refund.status ? refund.status.charAt(0).toUpperCase() + refund.status.slice(1) : 'Refunded';
        const ariaLabel = `Select refund for ${userLabel}`;

        const row = `
            <tr>
                <td><input type="checkbox" class="refund-checkbox" aria-label="${escapeHtml(ariaLabel)}"></td>
                <td>${escapeHtml(userLabel)}</td>
                <td>${escapeHtml(String(orderNumber))}</td>
                <td>${totalAmountDisplay}</td>
                <td>${amountDisplay}</td>
                <td class="col-reason">${escapeHtml(String(reason))}</td>
                <td class="col-source" title="Raw: ${escapeHtml(refund.gateway_response?.source || '-')}">${escapeHtml(String(source))}</td>
                <td>${escapeHtml(createdDate)}</td>
                <td title="Refund count for this order">${escapeHtml(String(refundApplied))}</td>
                <td><span class="status-badge ${statusClass}">${escapeHtml(statusLabel)}</span></td>
            </tr>
        `;

        tbody.insertAdjacentHTML('beforeend', row);
    });

    bindRefundSelectionEvents();
    updateRefundsSelectionSummary();
}

async function loadRefunds() {
    const tbody = document.getElementById('refundsTableBody');
    if (!tbody) return;

    refundsLoading = true;
    tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading refunds...</td></tr>';

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Not authenticated');
        }

        const response = await fetch('/.netlify/functions/payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ action: 'refunds-history' })
        });

        if (!response.ok) {
            throw new Error(`Failed to load refunds: ${response.status}`);
        }

        const data = await response.json();
        refundsCache = Array.isArray(data.refunds) ? data.refunds : [];

        // Hydrate user map
        let userMap = {};
        try {
            const usersResponse = await fetch('/.netlify/functions/users', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (usersResponse.ok) {
                const usersData = await usersResponse.json();
                const users = usersData.users || [];
                users.forEach(user => {
                    userMap[user.id] = {
                        username: user.username,
                        email: user.email,
                        balance: user.balance
                    };
                });
            }
        } catch (userError) {
            console.warn('Unable to fetch users for refunds mapping:', userError);
        }

        refundsUserLookup = userMap;
        renderRefundsTable(refundsCache);
    } catch (error) {
        console.error('Load refunds error:', error);
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load refunds. Please refresh.</td></tr>';
        showNotification('Refunds yüklenemedi. Lütfen tekrar deneyin.', 'error');
    } finally {
        refundsLoading = false;
    }
}

function refreshRefunds() {
    if (refundsLoading) {
        showNotification('Refunds already loading...', 'info');
        return;
    }
    loadRefunds();
}

// Init
window.addEventListener('DOMContentLoaded', async () => {
    // Enforce admin-only access on UI level (backend also enforces)
    try {
        const token = localStorage.getItem('token');
        const parts = token ? token.split('.') : [];
        const role = parts.length === 3 ? (JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role || null) : null;
        if (role !== 'admin') {
            showNotification('Only administrators can view refunds.', 'error');
            setTimeout(() => { window.location.href = '/admin/index.html'; }, 1200);
            return;
        }
    } catch (e) {
        // If role cannot be determined, rely on backend to reject
    }
    handleSearch('refundSearch', 'refundsTable');
    await loadRefunds();
});
