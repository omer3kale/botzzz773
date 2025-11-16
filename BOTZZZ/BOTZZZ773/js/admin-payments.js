// Admin Payments Management with Real Modals

let paymentsCache = [];
let paymentsUserLookup = {};
const selectedPaymentIds = new Set();
let paymentsLoading = false;
let lastPaymentsRefreshAt = null;

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

function getPaymentById(paymentId) {
    const idString = String(paymentId);
    return paymentsCache.find(payment => String(payment.id) === idString);
}

function getPaymentDisplayLabel(payment) {
    if (!payment) {
        return '';
    }
    const userMeta = paymentsUserLookup[payment.user_id] || {};
    const userLabel = userMeta.username || userMeta.email || (payment.user_id ? `User ${String(payment.user_id).substring(0, 6)}…` : 'Unknown');
    return `${userLabel} • ${formatCurrency(payment.amount)}`;
}

function setPaymentsRefreshStatus(message) {
    const statusEl = document.getElementById('paymentsRefreshStatus');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function attachPaymentsQuickActionCard(element, handler) {
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

function initializePaymentsQuickActions() {
    attachPaymentsQuickActionCard(document.getElementById('selectedPaymentsCard'), openSelectedPaymentsModal);
    attachPaymentsQuickActionCard(document.getElementById('addPaymentCard'), openAddPaymentQuickAction);
    attachPaymentsQuickActionCard(document.getElementById('refreshPaymentsCard'), triggerPaymentsRefresh);
    attachPaymentsQuickActionCard(document.getElementById('exportPaymentsCard'), openExportPaymentsQuickAction);
    updateSelectedPaymentsSummary();
    if (!lastPaymentsRefreshAt) {
        setPaymentsRefreshStatus('Sync latest data');
    }
}

function openSelectedPaymentsModal() {
    if (selectedPaymentIds.size === 0) {
        showNotification('Select a payment from the table first', 'error');
        return;
    }

    const items = Array.from(selectedPaymentIds).map(paymentId => {
        const payment = getPaymentById(paymentId);
        if (!payment) {
            return `<li class="selected-payment-item">Payment #${escapeHtml(String(paymentId))} (details unavailable)</li>`;
        }
        const userMeta = paymentsUserLookup[payment.user_id] || {};
        const userLabel = userMeta.username || userMeta.email || (payment.user_id ? `User ${String(payment.user_id)}` : 'Unknown user');
        const statusLabel = (payment.status || 'unknown').replace(/^(\w)/, (_, first) => first.toUpperCase());
        const created = payment.created_at ? new Date(payment.created_at).toLocaleString() : 'Unknown date';
        const memoBlock = payment.memo ? `<div class="selected-payment-memo">${escapeHtml(payment.memo)}</div>` : '';
        return `
            <li class="selected-payment-item">
                <div class="selected-payment-row">
                    <strong>${escapeHtml(userLabel)}</strong>
                    <span>${formatCurrency(payment.amount)}</span>
                </div>
                <div class="selected-payment-meta">
                    Payment #${escapeHtml(String(payment.id))} • ${escapeHtml(statusLabel)} • ${escapeHtml(created)}
                </div>
                ${memoBlock}
            </li>
        `;
    }).join('');

    const content = `
        <div class="selected-payments-summary">
            <p>You have ${selectedPaymentIds.size} payment${selectedPaymentIds.size === 1 ? '' : 's'} selected.</p>
            <ul class="selected-payments-list">
                ${items}
            </ul>
        </div>
    `;

    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Close</button>
    `;

    createModal('Selected Payments', content, actions);
}

function openAddPaymentQuickAction() {
    addPayment();
}

function openExportPaymentsQuickAction() {
    openExportPaymentsModal();
}

function triggerPaymentsRefresh() {
    if (paymentsLoading) {
        showNotification('Payments are already refreshing. Please wait…', 'info');
        return;
    }
    loadPayments();
}

function pruneSelectedPaymentIds() {
    if (selectedPaymentIds.size === 0) {
        return;
    }
    const validIds = new Set(paymentsCache.map(payment => String(payment.id)));
    for (const id of Array.from(selectedPaymentIds)) {
        if (!validIds.has(String(id))) {
            selectedPaymentIds.delete(id);
        }
    }
}

function bindPaymentSelectionEvents() {
    const checkboxes = document.querySelectorAll('.payment-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', handlePaymentSelectionChange);
    });
}

function handlePaymentSelectionChange(event) {
    const checkbox = event?.target;
    if (!checkbox || !checkbox.dataset.paymentId) {
        return;
    }

    const paymentId = checkbox.dataset.paymentId;
    if (checkbox.checked) {
        selectedPaymentIds.add(paymentId);
    } else {
        selectedPaymentIds.delete(paymentId);
    }

    const row = checkbox.closest('tr');
    if (row) {
        row.classList.toggle('is-selected', checkbox.checked);
    }

    updateSelectedPaymentsSummary();
}

function restorePaymentSelectionState() {
    const checkboxes = document.querySelectorAll('.payment-checkbox');
    checkboxes.forEach(checkbox => {
        const paymentId = checkbox.dataset.paymentId;
        const shouldSelect = selectedPaymentIds.has(paymentId);
        checkbox.checked = shouldSelect;
        const row = checkbox.closest('tr');
        if (row) {
            row.classList.toggle('is-selected', shouldSelect);
        }
    });
}

function syncPaymentsMasterToggleState() {
    const masterToggle = document.querySelector('th input[type="checkbox"][aria-label="Select all payments"]');
    if (!masterToggle) {
        return;
    }

    const checkboxes = Array.from(document.querySelectorAll('.payment-checkbox'));
    if (checkboxes.length === 0) {
        masterToggle.checked = false;
        masterToggle.indeterminate = false;
        return;
    }

    const selectedCount = checkboxes.filter(cb => cb.checked).length;
    masterToggle.checked = selectedCount > 0 && selectedCount === checkboxes.length;
    masterToggle.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
}

function updateSelectedPaymentsSummary() {
    const countEl = document.getElementById('selectedPaymentsCount');
    const detailEl = document.getElementById('selectedPaymentsDetail');
    const cardEl = document.getElementById('selectedPaymentsCard');

    if (!countEl || !detailEl || !cardEl) {
        return;
    }

    const count = selectedPaymentIds.size;
    countEl.textContent = `${count} selected`;

    if (count === 0) {
        detailEl.textContent = 'Choose payouts to review memos or flag risk before posting.';
    } else {
        const labels = [];
        selectedPaymentIds.forEach(id => {
            const payment = getPaymentById(id);
            const label = getPaymentDisplayLabel(payment);
            if (label) {
                labels.push(label);
            }
        });
        const preview = labels.slice(0, 2).join(', ');
        const overflow = labels.length > 2 ? ` +${labels.length - 2}` : '';
        detailEl.textContent = preview ? `${preview}${overflow}` : `${count} selected`;
    }

    cardEl.classList.toggle('is-active', count > 0);
    cardEl.setAttribute('aria-pressed', count > 0 ? 'true' : 'false');
    syncPaymentsMasterToggleState();
}

function toggleAllPayments(masterCheckbox) {
    if (!masterCheckbox) {
        return;
    }

    const checkboxes = document.querySelectorAll('.payment-checkbox');
    const shouldSelectAll = masterCheckbox.checked;
    masterCheckbox.indeterminate = false;

    checkboxes.forEach(checkbox => {
        checkbox.checked = shouldSelectAll;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
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

// Add payment
async function addPayment() {
    // Fetch real users from backend
    let usersOptions = '<option value="">Loading users...</option>';
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/users', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            const users = result.users || [];
            usersOptions = '<option value="">Select user...</option>' + 
                users.map(user => `<option value="${user.id}">${user.username} (${user.email})</option>`).join('');
        }
    } catch (error) {
        console.error('Error loading users:', error);
        usersOptions = '<option value="">Error loading users</option>';
    }
    
    const content = `
        <form id="addPaymentForm" onsubmit="submitAddPayment(event)" class="admin-form">
            <div class="form-group">
                <label>User *</label>
                <select name="userId" required>
                    ${usersOptions}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Amount *</label>
                    <input type="number" name="amount" placeholder="100.00" min="0.01" step="0.01" required>
                </div>
                <div class="form-group">
                    <label>Payment Method *</label>
                    <select name="method" required>
                        <option value="payeer">Payeer</option>
                        <option value="stripe">Stripe</option>
                        <option value="paypal">PayPal</option>
                        <option value="bank">Bank Transfer</option>
                        <option value="cash">Cash</option>
                        <option value="other">Other</option>
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Transaction ID</label>
                <input type="text" name="transactionId" placeholder="TXN123456789">
            </div>
            <div class="form-group">
                <label>Status *</label>
                <select name="status" required>
                    <option value="completed">Completed</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                    <option value="refunded">Refunded</option>
                </select>
            </div>
            <div class="form-group">
                <label>Memo/Note</label>
                <textarea name="memo" rows="3" placeholder="Optional payment note or description..."></textarea>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="addPaymentForm" class="btn-primary">
            <i class="fas fa-plus"></i> Add Payment
        </button>
    `;
    
    createModal('Add Manual Payment', content, actions);
}

function submitAddPayment(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const paymentData = Object.fromEntries(formData);
    
    console.log('Submitting payment with data:', paymentData);
    
    // Show loading state
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (!submitBtn) {
        const formSubmitBtn = document.querySelector('button[form="addPaymentForm"]');
        if (formSubmitBtn) {
            formSubmitBtn.disabled = true;
            formSubmitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        }
    } else {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    }
    
    // Call backend API to add payment
    const token = localStorage.getItem('token');
    
    const requestBody = {
        action: 'admin-add-payment',
        userId: paymentData.userId,
        amount: parseFloat(paymentData.amount),
        method: paymentData.method,
        transactionId: paymentData.transactionId || null,
        status: paymentData.status,
        memo: paymentData.memo || null
    };
    
    console.log('Sending request:', requestBody);
    
    fetch('/.netlify/functions/payments', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
    })
    .then(response => {
        console.log('Response status:', response.status);
        return response.json();
    })
    .then(data => {
        console.log('Response data:', data);
        if (data.success) {
            showNotification(data.message || `Payment of $${paymentData.amount} added successfully!`, 'success');
            closeModal();
            // Reload the page to show updated data
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to add payment', 'error');
            console.error('Payment creation failed:', data.error);
            // Re-enable button
            const btn = document.querySelector('button[form="addPaymentForm"]');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<i class="fas fa-plus"></i> Add Payment';
            }
        }
    })
    .catch(error => {
        console.error('Add payment error:', error);
        showNotification('Failed to add payment. Please try again.', 'error');
        // Re-enable button
        const btn = document.querySelector('button[form="addPaymentForm"]');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plus"></i> Add Payment';
        }
    });
}

// Export payments data
function openExportPaymentsModal() {
    const content = `
        <form id="exportPaymentsForm" onsubmit="submitExportPayments(event)" class="admin-form">
            <div class="form-group">
                <label>Export Format *</label>
                <select name="format" required>
                    <option value="csv">CSV (Excel)</option>
                    <option value="pdf">PDF Report</option>
                    <option value="json">JSON Data</option>
                </select>
            </div>
            <div class="form-group">
                <label>Date Range</label>
                <select name="dateRange">
                    <option value="all">All Time</option>
                    <option value="today">Today</option>
                    <option value="week">Last 7 Days</option>
                    <option value="month">Last 30 Days</option>
                    <option value="custom">Custom Range</option>
                </select>
            </div>
            <div class="form-group">
                <label>Payment Status</label>
                <select name="statusFilter">
                    <option value="all">All Statuses</option>
                    <option value="Completed">Completed Only</option>
                    <option value="Pending">Pending Only</option>
                    <option value="Failed">Failed Only</option>
                </select>
            </div>
            <div class="export-summary" style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; margin-top: 20px;">
                <h4 style="margin-bottom: 12px; color: #FF1494;">Export Summary</h4>
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                    <div>
                        <div style="color: #888; font-size: 12px;">Total Records</div>
                        <div id="exportRecordCount" style="font-size: 20px; font-weight: 600;">-</div>
                    </div>
                    <div>
                        <div style="color: #888; font-size: 12px;">Total Amount</div>
                        <div id="exportTotalAmount" style="font-size: 20px; font-weight: 600; color: #10b981;">-</div>
                    </div>
                </div>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="exportPaymentsForm" class="btn-primary">
            <i class="fas fa-file-export"></i> Export Data
        </button>
    `;
    
    createModal('Export Payments Data', content, actions);
}

async function submitExportPayments(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const exportData = Object.fromEntries(formData);
    
    const submitBtn = document.querySelector('button[form="exportPaymentsForm"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'export',
                format: exportData.format,
                dateFrom: exportData.dateFrom,
                dateTo: exportData.dateTo,
                status: exportData.status
            })
        });
        
        const data = await response.json();
        if (data.success) {
            // Create download link
            const blob = new Blob([data.content], { type: data.mimeType });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = data.filename || `payments-export.${exportData.format}`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            
            showNotification('Export complete! Download started.', 'success');
            closeModal();
        } else {
            showNotification(data.error || 'Failed to export payments', 'error');
        }
        
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-download"></i> Export';
        }
    } catch (error) {
        console.error('Export payments error:', error);
        showNotification('Failed to export payments. Please try again.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-download"></i> Export';
        }
    }
}

// Update payment method
async function updatePaymentMethod(paymentId, method) {
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/payments', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'update-method',
                paymentId: paymentId,
                method: method
            })
        });
        
        const data = await response.json();
        if (data.success) {
            showNotification(`Payment #${paymentId} method updated to ${method}`, 'success');
            setTimeout(() => window.location.reload(), 1000);
        } else {
            showNotification(data.error || 'Failed to update payment method', 'error');
        }
    } catch (error) {
        console.error('Update payment method error:', error);
        showNotification('Failed to update payment method. Please try again.', 'error');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    handleSearch('paymentSearch', 'paymentsTable');
    initializePaymentsQuickActions();
    await loadPayments();
});

// Load real payments from database
async function loadPayments() {
    const tbody = document.getElementById('paymentsTableBody');
    if (!tbody) return;

    paymentsLoading = true;
    setPaymentsRefreshStatus('Refreshing…');

    const refreshCard = document.getElementById('refreshPaymentsCard');
    if (refreshCard) {
        refreshCard.classList.add('is-active');
        refreshCard.setAttribute('aria-pressed', 'true');
    }

    tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading payments...</td></tr>';

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
            body: JSON.stringify({ action: 'history' })
        });

        if (!response.ok) {
            throw new Error(`Failed to load payments: ${response.status}`);
        }

        const data = await response.json();
        paymentsCache = Array.isArray(data.payments) ? data.payments : [];
        pruneSelectedPaymentIds();

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
            console.warn('Unable to fetch users for payments mapping:', userError);
        }

        paymentsUserLookup = userMap;

        if (paymentsCache.length > 0) {
            tbody.innerHTML = '';

            paymentsCache.forEach(payment => {
                const paymentIdRaw = payment?.id != null ? String(payment.id) : '';
                const paymentIdAttr = escapeHtml(paymentIdRaw);
                const userMeta = userMap[payment.user_id] || {};
                const userLabel = userMeta.username || userMeta.email || 'Unknown';
                const balanceDisplay = formatCurrency(userMeta.balance || 0);
                const amountDisplay = formatCurrency(payment.amount);
                const createdDate = payment.created_at ? new Date(payment.created_at).toLocaleString() : 'Unknown';
                const updatedDate = payment.updated_at ? new Date(payment.updated_at).toLocaleString() : createdDate;
                const statusKey = (payment.status || '').toLowerCase();
                const statusClass = statusKey === 'completed' ? 'completed' : statusKey === 'pending' ? 'pending' : statusKey === 'failed' ? 'failed' : 'refunded';
                const statusLabel = payment.status ? payment.status.charAt(0).toUpperCase() + payment.status.slice(1) : 'Unknown';
                const memo = payment.memo ? escapeHtml(payment.memo) : '-';
                const ariaLabel = `Select payment ${paymentIdRaw || 'without id'} for ${userLabel}`;
                const modeLabel = payment.gateway_response?.manual ? 'Manual' : 'Live';
                const methodOptions = ['payeer', 'stripe', 'paypal', 'bank', 'cash', 'other']
                    .map(method => `<option value="${method}"${payment.method === method ? ' selected' : ''}>${method}</option>`)
                    .join('');

                const row = `
                    <tr data-payment-id="${paymentIdAttr}">
                        <td><input type="checkbox" class="payment-checkbox" data-payment-id="${paymentIdAttr}" aria-label="${escapeHtml(ariaLabel)}"></td>
                        <td>${escapeHtml(paymentIdRaw)}</td>
                        <td>${escapeHtml(userLabel)}</td>
                        <td>${balanceDisplay}</td>
                        <td>${amountDisplay}</td>
                        <td>
                            <select class="inline-select" data-payment-id="${paymentIdAttr}" onchange="updatePaymentMethod(this.dataset.paymentId, this.value)">
                                ${methodOptions}
                            </select>
                        </td>
                        <td><span class="status-badge ${statusClass}">${escapeHtml(statusLabel)}</span></td>
                        <td><span class="risk-badge low">Low</span></td>
                        <td>${memo}</td>
                        <td>${escapeHtml(createdDate)}</td>
                        <td>${escapeHtml(updatedDate)}</td>
                        <td>${escapeHtml(modeLabel)}</td>
                    </tr>
                `;
                tbody.insertAdjacentHTML('beforeend', row);
            });

            restorePaymentSelectionState();
            bindPaymentSelectionEvents();
        } else {
            tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 20px; color: #888;">No payments found</td></tr>';
        }

        updateSelectedPaymentsSummary();
        lastPaymentsRefreshAt = new Date();
        const formattedTime = lastPaymentsRefreshAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        setPaymentsRefreshStatus(`Updated ${formattedTime}`);
    } catch (error) {
        console.error('Load payments error:', error);
        tbody.innerHTML = '<tr><td colspan="12" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load payments. Please refresh the page.</td></tr>';
        setPaymentsRefreshStatus('Refresh failed');
        updateSelectedPaymentsSummary();
    } finally {
        paymentsLoading = false;
        if (refreshCard) {
            refreshCard.classList.remove('is-active');
            refreshCard.setAttribute('aria-pressed', 'false');
        }
    }
}
