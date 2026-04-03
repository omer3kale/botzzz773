// Payment Integration with Backend
// Load this AFTER api-client.js

// Auto-refresh payment history every 10 seconds when page is visible
let paymentHistoryPoller = null;
const PAYMENT_POLL_INTERVAL = 10000; // 10 seconds

document.addEventListener('DOMContentLoaded', () => {
    loadPaymentHistory();
    startPaymentPolling();
});

// Handle page visibility to pause/resume polling
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopPaymentPolling();
    } else {
        startPaymentPolling();
    }
});

function startPaymentPolling() {
    if (paymentHistoryPoller) return; // Already polling
    
    const historyContainer = document.getElementById('paymentHistory');
    if (!historyContainer) return;
    
    paymentHistoryPoller = setInterval(() => {
        loadPaymentHistory();
    }, PAYMENT_POLL_INTERVAL);
    
    console.log('[PAYMENT] Polling started - refreshing every 10 seconds');
}

function stopPaymentPolling() {
    if (paymentHistoryPoller) {
        clearInterval(paymentHistoryPoller);
        paymentHistoryPoller = null;
        console.log('[PAYMENT] Polling stopped');
    }
}

// Load payment history
async function loadPaymentHistory() {
    const historyContainer = document.getElementById('paymentHistory');
    if (!historyContainer) return;

    const token = localStorage.getItem('token');
    if (!token) {
        historyContainer.innerHTML = '<div class="history-placeholder">Sign in to view your recent payments.</div>';
        return;
    }

    try {
        const response = await fetch('/.netlify/functions/payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ action: 'history' })
        });

        if (!response.ok) {
            throw new Error('Unable to fetch payment history at the moment.');
        }

        const data = await response.json();

        if (data.payments && data.payments.length > 0) {
            renderPaymentHistory(data.payments);
            
            // Check if any pending payment was just completed
            const hasPending = data.payments.some(p => p.status === 'pending');
            if (!hasPending) {
                // All payments completed, can stop polling
                stopPaymentPolling();
            }
        } else {
            historyContainer.innerHTML = '<div class="history-placeholder empty">No payments found yet. Your future deposits will appear here.</div>';
            stopPaymentPolling();
        }
    } catch (error) {
        console.error('[PAYMENT] Failed to load payment history:', error);
        // Don't show error on every poll - just log it
        if (error instanceof TypeError) {
            // Network error, likely offline - show placeholder
            historyContainer.innerHTML = `<div class="history-placeholder error">Network error. Check your connection.</div>`;
        }
    }
}

// Render payment history
function renderPaymentHistory(payments) {
    const historyContainer = document.getElementById('paymentHistory');
    if (!historyContainer) return;

    const rows = payments.map(payment => {
        const amountValue = Number(payment.amount || 0);
        const isRefund = amountValue < 0 || (payment.method || '').toLowerCase() === 'refund' || (payment.status || '').toLowerCase() === 'refunded';
        const amountPrefix = isRefund ? '−' : '+';
        const formattedAmount = `$${Math.abs(amountValue).toFixed(2)}`;
        const amountClass = `history-amount ${isRefund ? 'refund' : 'deposit'}`;
        const statusKey = determinePaymentStatusKey(payment.status, isRefund);
        const statusLabel = formatStatusLabel(statusKey);
        const memo = payment.memo
            ? `<div class="history-memo">${escapeHtml(payment.memo)}</div>`
            : '';

        return `
            <tr>
                <td>
                    <span class="history-label">${formatDate(payment.created_at)}</span>
                    ${memo}
                </td>
                <td class="${amountClass}">${amountPrefix}${formattedAmount}</td>
                <td>${escapeHtml(formatMethod(payment.method))}</td>
                <td><span class="history-status ${statusKey}">${escapeHtml(statusLabel)}</span></td>
                <td class="transaction-id" title="${escapeHtml(payment.transaction_id || payment.id || '—')}">${escapeHtml(payment.transaction_id || payment.id || '—')}</td>
            </tr>
        `;
    }).join('');

    historyContainer.innerHTML = `
        <table class="payment-history-table">
            <thead>
                <tr>
                    <th>Date & Time</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Reference</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

function formatMethod(method) {
    if (!method) return '—';
    const normalized = String(method).toLowerCase().replace(/[\s-]+/g, '_');
    switch (normalized) {
        case 'payeer':
            return 'Payeer';
        case 'stripe':
            return 'Stripe';
        case 'cryptomus':
            return 'Cryptomus';
        case 'heleket':
            return 'Heleket';
        case 'binance_manual':
            return 'Binance Manual';
        case 'refund':
            return 'Refund';
        case 'crypto':
            return 'Crypto Invoice (legacy)';
        default:
            return capitalizeFirst(normalized);
    }
}

function determinePaymentStatusKey(status, isRefund) {
    const normalized = typeof status === 'string' ? status.toLowerCase() : '';
    if (isRefund && (!normalized || normalized === 'completed')) {
        return 'refunded';
    }
    if (!normalized) {
        return 'pending';
    }
    return normalized;
}

function formatStatusLabel(statusKey) {
    switch (statusKey) {
        case 'completed':
            return 'Completed';
        case 'pending':
            return 'Pending';
        case 'failed':
            return 'Failed';
        case 'refunded':
            return 'Refunded';
        default:
            return capitalizeFirst(statusKey || 'Pending');
    }
}

// Helper functions
function formatDate(dateString) {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }

    const pad = (value) => String(value).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    // Desired format: YYYY-MM-DD HH:MM:SS
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function capitalizeFirst(str = '') {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text = '') {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 8px;
        color: white;
        font-weight: 500;
        z-index: 9999;
        animation: slideIn 0.3s ease;
        max-width: 400px;
    `;

    if (type === 'success') {
        notification.style.background = '#10b981';
    } else if (type === 'error') {
        notification.style.background = '#ef4444';
    }

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}
