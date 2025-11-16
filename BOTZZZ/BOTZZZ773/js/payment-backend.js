// Payment Integration with Backend
// Load this AFTER api-client.js

document.addEventListener('DOMContentLoaded', () => {
    loadPaymentHistory();
});

// Load payment history
async function loadPaymentHistory() {
    const historyContainer = document.getElementById('paymentHistory');
    if (!historyContainer) return;

    const token = localStorage.getItem('token');
    if (!token) {
        historyContainer.innerHTML = '<div class="history-placeholder">Sign in to view your recent payments.</div>';
        return;
    }

    historyContainer.innerHTML = '<div class="history-placeholder loading">Loading your recent payments...</div>';

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
        } else {
            historyContainer.innerHTML = '<div class="history-placeholder empty">No payments found yet. Your future deposits will appear here.</div>';
        }
    } catch (error) {
        console.error('Failed to load payment history:', error);
        historyContainer.innerHTML = `<div class="history-placeholder error">${error.message || 'Failed to load payment history.'}</div>`;
    }
}

// Render payment history
function renderPaymentHistory(payments) {
    const historyContainer = document.getElementById('paymentHistory');
    if (!historyContainer) return;

    const rows = payments.map(payment => `
        <tr>
            <td>
                <span class="history-label">${formatDate(payment.created_at)}</span>
            </td>
            <td>$${parseFloat(payment.amount).toFixed(2)}</td>
            <td>${formatMethod(payment.method)}</td>
            <td>
                <span class="status-badge status-${payment.status}">${capitalizeFirst(payment.status)}</span>
            </td>
            <td class="transaction-id" title="${payment.transaction_id}">${payment.transaction_id || '—'}</td>
        </tr>
    `).join('');

    historyContainer.innerHTML = `
        <table class="payment-history-table">
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Amount</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Transaction ID</th>
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
    const normalized = method.toLowerCase();
    switch (normalized) {
        case 'payeer':
            return 'Payeer';
        case 'stripe':
            return 'Stripe';
        case 'crypto':
            return 'Crypto Invoice (legacy)';
        default:
            return capitalizeFirst(normalized);
    }
}

// Helper functions
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
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
