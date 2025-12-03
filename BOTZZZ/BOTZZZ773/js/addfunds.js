// Add Funds Page Functionality
let isPopupMode = false;
let authGuardTriggered = false;

const AUTH_ALERT_MESSAGE = 'You must be signed in to add funds. Please sign in or create an account.';

document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    isPopupMode = urlParams.get('popup') === '1';
    if (isPopupMode) {
        enablePopupSurface();
    }

    if (!resolveAuthToken('initial-load')) {
        return;
    }

    const form = document.getElementById('addFundsForm');
    const customAmountInput = document.getElementById('customAmount');
    const amountButtons = document.querySelectorAll('.amount-btn');
    const summaryAmount = document.getElementById('summaryAmount');
    const summaryFee = document.getElementById('summaryFee');
    const summaryTotal = document.getElementById('summaryTotal');
    const balanceAmount = document.querySelector('.balance-amount');
    const paymentMethodHint = document.getElementById('paymentMethodHint');
    const refundSummary = document.getElementById('refundSummary');
    const refundSummaryMessage = document.getElementById('refundSummaryMessage');
    const paymentMethodCards = document.querySelectorAll('[data-payment-method-card]');
    
    let selectedPaymentMethod = 'heleket';

    function renderBalanceAmount(value) {
        if (!balanceAmount) {
            return;
        }
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) {
            return;
        }
        balanceAmount.textContent = formatCurrencyValue(numeric);
    }

    initializeRefundSnapshotBridge();

    if (window.BalanceSync) {
        window.BalanceSync.configure({
            fetcher: (context = {}) => loadUserBalance(context)
        });
        window.BalanceSync.subscribe(({ balance }) => {
            if (Number.isFinite(balance)) {
                renderBalanceAmount(balance);
            }
        });
    }

    if (!form) {
        console.warn('[ADDFUNDS] Form element not found.');
        return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    const submitBtnText = submitBtn ? submitBtn.querySelector('span') : null;

    const BUTTON_LABELS = {
        heleket: 'Pay with Heleket',
        cryptomus: 'Pay with Cryptomus',
        payeer: 'Get Payment Instructions'
    };

    const BUTTON_LOADING_LABELS = {
        heleket: 'Generating Heleket invoice...',
        cryptomus: 'Creating Cryptomus invoice...',
        payeer: 'Preparing instructions...'
    };

    // Processing fee percentage
    const FEE_PERCENTAGE = 2.5;

    // Load current balance on page load
    loadUserBalance({ reason: 'page-load' });
    loadRecentRefundHighlight();

    // Payment method selection via cards
    function selectPaymentMethod(method) {
        selectedPaymentMethod = method;
        if (paymentMethodCards && paymentMethodCards.length) {
            paymentMethodCards.forEach(card => {
                const isActive = card.dataset.method === method;
                card.classList.toggle('selected', isActive);
                card.setAttribute('aria-pressed', isActive ? 'true' : 'false');
            });
        }
        updatePaymentMethodHint();
        updateSubmitButtonLabel();
    }

    if (paymentMethodCards && paymentMethodCards.length) {
        paymentMethodCards.forEach(card => {
            const method = card.dataset.method;

            card.addEventListener('click', () => selectPaymentMethod(method));
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectPaymentMethod(method);
                }
            });
        });
        selectPaymentMethod(selectedPaymentMethod);
    }

    updatePaymentMethodHint();
    updateSubmitButtonLabel();

    // Listen for payment success event to refresh balance
    window.addEventListener('popup:payment-success', () => {
        console.log('[ADDFUNDS] Payment success event received, refreshing balance');
        loadUserBalance({ reason: 'payment-success' });
    });

    // Amount button selection
    amountButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            // Remove active class from all buttons
            amountButtons.forEach(b => b.classList.remove('active'));
            // Add active class to clicked button
            this.classList.add('active');
            // Set the amount in the input
            const amount = parseFloat(this.dataset.amount);
            customAmountInput.value = amount;
            // Update summary
            updateSummary(amount);
        });
    });

    // Custom amount input
    customAmountInput.addEventListener('input', function() {
        const amount = parseFloat(this.value) || 0;
        // Remove active class from preset buttons
        amountButtons.forEach(b => b.classList.remove('active'));
        // Update summary
        updateSummary(amount);
    });

    // Update order summary
    function updateSummary(amount) {
        if (amount < 5) {
            summaryAmount.textContent = '$0.00';
            summaryFee.textContent = '$0.00';
            summaryTotal.textContent = '$0.00';
            return;
        }

        const fee = amount * (FEE_PERCENTAGE / 100);
        const total = amount + fee;

        summaryAmount.textContent = '$' + amount.toFixed(2);
        summaryFee.textContent = '$' + fee.toFixed(2);
        summaryTotal.textContent = '$' + total.toFixed(2);
    }

    // Form submission
    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const amount = parseFloat(customAmountInput.value);


        // Validation
        if (amount < 5) {
            showMessage('Minimum deposit amount is $5.00', 'error');
            customAmountInput.focus();
            return;
        }

        // Get user email from token
        const token = resolveAuthToken('submit-add-funds');
        if (!token) {
            return;
        }

        // Decode token to get user email
        let userEmail;
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            userEmail = payload.email;
        } catch (error) {
            handleMissingAuth('token-decode-failed');
            return;
        }

        if (submitBtn && submitBtnText) {
            submitBtn.disabled = true;
            submitBtnText.textContent = BUTTON_LOADING_LABELS[selectedPaymentMethod] || 'Processing...';
        }

        try {
            if (selectedPaymentMethod === 'heleket') {
                await initiateHeleketPayment({ amount, userEmail });
            } else if (selectedPaymentMethod === 'cryptomus') {
                await initiateCryptomusPayment({ amount, userEmail });
            } else if (selectedPaymentMethod === 'payeer') {
                await initiatePayeerPayment({ amount, userEmail });
            }
        } catch (error) {
            console.error('Payment error:', error);
            showMessage(error.message || 'Failed to initiate payment. Please try again.', 'error');
        }

        if (submitBtn) {
            submitBtn.disabled = false;
            updateSubmitButtonLabel();
        }
    });

    // Initialize with no amount selected
    updateSummary(0);

    async function loadUserBalance(context = {}) {
        const token = resolveAuthToken('load-balance');
        if (!token) {
            return null;
        }

        try {
            const response = await fetch('/.netlify/functions/users', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 401 || response.status === 403) {
                handleMissingAuth('balance-response-unauthorized');
                return null;
            }

            if (!response.ok) {
                throw new Error('Failed to retrieve balance');
            }

            const data = await response.json();

            if (data && data.user) {
                const balanceValue = Number(data.user.balance || 0);
                renderBalanceAmount(balanceValue);
                localStorage.setItem('user', JSON.stringify(data.user));
                if (window.BalanceSync) {
                    window.BalanceSync.setUser(data.user, { reason: context.reason || 'addfunds-refresh' });
                }
                return data.user;
            }
        } catch (error) {
            console.error('Error loading user balance:', error);
        }
        return null;
    }

    function updatePaymentMethodHint() {
        if (!paymentMethodHint) return;
        if (selectedPaymentMethod === 'heleket') {
            paymentMethodHint.textContent = 'Heleket invoices open in a secure window and auto credit once blockchain confirmations land.';
        } else if (selectedPaymentMethod === 'cryptomus') {
            paymentMethodHint.textContent = 'Pay with Bitcoin, Ethereum, USDT, and more. Keep the tab open until Cryptomus confirms payment.';
        } else if (selectedPaymentMethod === 'payeer') {
            paymentMethodHint.textContent = 'Manual Payeer transfers require including your Order ID in the transfer notes.';
        } else {
            paymentMethodHint.textContent = 'Choose a payment method to continue.';
        }
    }

    function updateSubmitButtonLabel() {
        if (!submitBtnText) return;
        submitBtnText.textContent = BUTTON_LABELS[selectedPaymentMethod] || 'Proceed to Payment';
    }

    async function initiateHeleketPayment({ amount, userEmail }) {
        const token = resolveAuthToken('initiate-payment');
        if (!token) {
            throw new Error('Please sign in to add funds.');
        }

        const response = await fetch('/.netlify/functions/heleket', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'create-payment',
                amount: amount,
                email: userEmail
            })
        });

        const data = await response.json();

        if (response.status === 401 || response.status === 403) {
            handleMissingAuth('heleket-response-unauthorized');
            throw new Error('Session expired. Please sign in again.');
        }

        if (data.success && data.paymentUrl) {
            if (isPopupMode) {
                window.location.href = data.paymentUrl;
            } else {
                window.open(data.paymentUrl, '_blank', 'width=600,height=800');
                showMessage('Heleket payment window opened in a new tab.', 'success');
            }
            loadUserBalance({ reason: 'heleket-payment-created' });
            notifyOpener({ type: 'ADD_FUNDS_ORDER_CREATED', orderId: data.orderId, amount });
        } else {
            throw new Error(data.error || 'Failed to create Heleket invoice');
        }
    }

    async function initiateCryptomusPayment({ amount, userEmail }) {
        const token = resolveAuthToken('initiate-payment');
        if (!token) {
            throw new Error('Please sign in to add funds.');
        }

        const response = await fetch('/.netlify/functions/cryptomus', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'create-payment',
                amount: amount,
                email: userEmail
            })
        });

        const data = await response.json();

        if (response.status === 401 || response.status === 403) {
            handleMissingAuth('cryptomus-response-unauthorized');
            throw new Error('Session expired. Please sign in again.');
        }

        if (data.success) {
            // Open Cryptomus payment page in new window
            if (isPopupMode) {
                window.location.href = data.paymentUrl;
            } else {
                window.open(data.paymentUrl, '_blank', 'width=600,height=800');
                showMessage('Payment window opened. Complete your payment there.', 'success');
            }
            loadUserBalance({ reason: 'payment-created' });
            notifyOpener({ type: 'ADD_FUNDS_ORDER_CREATED', orderId: data.orderId, amount });
        } else {
            throw new Error(data.error || 'Payment initiation failed');
        }
    }

    async function initiatePayeerPayment({ amount, userEmail }) {
        const token = resolveAuthToken('initiate-payment');
        if (!token) {
            throw new Error('Please sign in to add funds.');
        }

        const response = await fetch('/.netlify/functions/payeer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'create-payment',
                amount: amount,
                email: userEmail
            })
        });

        const data = await response.json();

        if (response.status === 401 || response.status === 403) {
            handleMissingAuth('payeer-response-unauthorized');
            throw new Error('Session expired. Please sign in again.');
        }

        if (data.success) {
            showManualPaymentInstructions(amount, data.orderId);
            loadUserBalance({ reason: 'payment-created' });
            notifyOpener({ type: 'ADD_FUNDS_ORDER_CREATED', orderId: data.orderId, amount });
        } else {
            throw new Error(data.error || 'Payment initiation failed');
        }
    }

    async function loadRecentRefundHighlight() {
        if (!refundSummary || !refundSummaryMessage) {
            return;
        }

        const token = resolveAuthToken('refund-summary');
        if (!token) {
            refundSummary.classList.add('hidden');
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
                throw new Error('Failed to load refunds');
            }

            const data = await response.json();
            const payments = Array.isArray(data.payments) ? data.payments : [];
            const refundPayment = payments.find(entry => isRefundPayment(entry));

            if (!refundPayment) {
                refundSummary.classList.add('hidden');
                return;
            }

            const amountValue = Math.abs(Number(refundPayment.amount || 0));
            if (!Number.isFinite(amountValue)) {
                refundSummary.classList.add('hidden');
                return;
            }

            const refundSnapshot = {
                amount: amountValue,
                currency: refundPayment.currency || 'USD',
                label: refundPayment.memo || 'Order refund',
                reference: refundPayment.transaction_id || refundPayment.id || '',
                orderId: refundPayment.order_id || refundPayment.reference || '',
                timestamp: refundPayment.created_at,
                source: 'addfunds-history'
            };

            applyRefundSnapshotToSummary(refundSnapshot, { allowHtml: true });

            if (window.RefundState) {
                window.RefundState.recordLatestRefundEvent({
                    ...refundSnapshot,
                    message: `${formatCurrencyValue(refundSnapshot.amount, refundSnapshot.currency)} returned to balance`
                });
            }
        } catch (error) {
            console.warn('[ADDFUNDS] Failed to load refund summary:', error);
            refundSummary.classList.add('hidden');
        }
    }

    function isRefundPayment(payment = {}) {
        const amount = Number(payment.amount);
        if (Number.isFinite(amount) && amount < 0) {
            return true;
        }
        const method = typeof payment.method === 'string' ? payment.method.toLowerCase() : '';
        const status = typeof payment.status === 'string' ? payment.status.toLowerCase() : '';
        return method === 'refund' || status === 'refunded';
    }

    function initializeRefundSnapshotBridge() {
        if (!refundSummary || !refundSummaryMessage) {
            return;
        }

        if (window.RefundState) {
            const snapshot = window.RefundState.getLatestRefundEvent();
            if (snapshot) {
                applyRefundSnapshotToSummary(snapshot, { allowHtml: true });
            }
        }

        window.addEventListener('refund:updated', (event) => {
            if (event?.detail) {
                applyRefundSnapshotToSummary(event.detail, { allowHtml: true });
            }
        });
    }

    function applyRefundSnapshotToSummary(snapshot, options = {}) {
        if (!snapshot || !refundSummary || !refundSummaryMessage) {
            return false;
        }

        const amountLabel = formatCurrencyValue(snapshot.amount, snapshot.currency || 'USD');
        const relativeLabel = formatRelativeTimestamp(snapshot.timestamp);
        const reference = snapshot.reference ? ` (Ref: ${escapeHtml(snapshot.reference)})` : '';
        const amountHtml = `<strong>${escapeHtml(amountLabel)}</strong>`;
        const messageHtml = `${amountHtml} was returned to your balance ${escapeHtml(relativeLabel)}${reference}.`;

        if (options.allowHtml) {
            refundSummaryMessage.innerHTML = messageHtml;
        } else {
            const referenceText = snapshot.reference ? ` (Ref: ${snapshot.reference})` : '';
            refundSummaryMessage.textContent = `${amountLabel} was returned to your balance ${relativeLabel}${referenceText}.`;
        }

        refundSummary.classList.remove('hidden');
        return true;
    }

    function formatCurrencyValue(amount, currency = 'USD') {
        const numeric = Number(amount);
        if (Number.isFinite(numeric)) {
            try {
                return new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency,
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(numeric);
            } catch (error) {
                // Fallback handled below
            }
            return `$${numeric.toFixed(2)}`;
        }
        return '$0.00';
    }

    function formatRelativeTimestamp(dateInput) {
        if (!dateInput) {
            return 'just now';
        }
        const date = new Date(dateInput);
        if (Number.isNaN(date.getTime())) {
            return 'just now';
        }
        const diff = Date.now() - date.getTime();
        if (diff < 60000) {
            return 'just now';
        }
        if (diff < 3600000) {
            const minutes = Math.max(1, Math.floor(diff / 60000));
            return `${minutes}m ago`;
        }
        if (diff < 86400000) {
            const hours = Math.max(1, Math.floor(diff / 3600000));
            return `${hours}h ago`;
        }
        const days = Math.max(1, Math.floor(diff / 86400000));
        return `${days}d ago`;
    }

    function escapeHtml(text = '') {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
});

// Function to show manual payment instructions
function showManualPaymentInstructions(amount, orderId) {
    const modal = document.createElement('div');
    modal.className = 'payment-instructions-modal';
    modal.innerHTML = `
        <div class="payment-instructions-content">
            <div class="payment-instructions-header">
                <h2>Payeer Manual Payment</h2>
                <button class="close-modal" onclick="this.closest('.payment-instructions-modal').remove()">×</button>
            </div>
            <div class="payment-instructions-body">
                <div class="payment-method-badge">
                    <i class="fas fa-wallet"></i>
                    <span>Manual Payeer Transfer</span>
                </div>
                <div class="payment-details">
                    <h3>Payment Details</h3>
                    <div class="detail-row">
                        <span class="detail-label">Amount to Send:</span>
                        <span class="detail-value amount">$${amount.toFixed(2)} USD</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Order ID:</span>
                        <span class="detail-value">${orderId}</span>
                    </div>
                    <div class="detail-row highlight">
                        <span class="detail-label">Send to Payeer ID:</span>
                        <span class="detail-value payeer-id">P1135369069</span>
                    </div>
                </div>
                <div class="payment-instructions">
                    <h3>Instructions</h3>
                    <ol>
                        <li>Login to your Payeer account</li>
                        <li>Go to <strong>Transfer</strong> section</li>
                        <li>Send <strong>$${amount.toFixed(2)} USD</strong> to Payeer ID: <strong>P1135369069</strong></li>
                        <li>Include Order ID <strong>${orderId}</strong> in the transfer notes</li>
                        <li>After completing the transfer, contact us to confirm</li>
                    </ol>
                </div>
                <div class="payment-confirmation">
                    <div class="confirmation-icon">
                        <i class="fas fa-envelope"></i>
                    </div>
                    <h3>Confirm Your Payment</h3>
                    <p>After sending the payment, please contact us to activate your funds:</p>
                    <a href="mailto:botzzz773@gmail.com?subject=Payment Confirmation - Order ${orderId}&body=I have sent $${amount.toFixed(2)} USD to Payeer ID P1135369069.%0D%0AOrder ID: ${orderId}%0D%0APlease confirm and activate my funds." 
                       class="btn-primary btn-contact">
                        <i class="fas fa-envelope"></i>
                        Contact: botzzz773@gmail.com
                    </a>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

// Helper function to show messages
function showMessage(message, type) {
    // Create message element if it doesn't exist
    let messageDiv = document.querySelector('.message-toast');
    if (!messageDiv) {
        messageDiv = document.createElement('div');
        messageDiv.className = 'message-toast';
        document.body.appendChild(messageDiv);
    }
    
    messageDiv.textContent = message;
    messageDiv.className = `message-toast ${type}`;
    messageDiv.style.display = 'block';
    
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 3000);
}

function enablePopupSurface() {
    document.body.classList.add('popup-mode');
    const panel = document.querySelector('[data-popup-surface]');
    if (panel) {
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Add funds window');
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

function notifyOpener(payload) {
    if (!isPopupMode || !window.opener || window.opener.closed) {
        return;
    }
    window.opener.postMessage(payload, window.location.origin);
}

function resolveAuthToken(reason) {
    const token = getAuthToken();
    if (!token) {
        handleMissingAuth(reason);
    }
    return token;
}

function getAuthToken() {
    try {
        return localStorage.getItem('token');
    } catch (error) {
        console.warn('[ADDFUNDS] Unable to read auth token from storage.', error);
        return null;
    }
}

function handleMissingAuth(reason) {
    if (authGuardTriggered) {
        return;
    }
    authGuardTriggered = true;

    const payload = { type: 'AUTH_REQUIRED', source: 'addfunds', reason };
    if (isPopupMode) {
        notifyOpener(payload);
        setTimeout(() => {
            try {
                window.close();
            } catch (error) {
                console.warn('[ADDFUNDS] Failed to close popup after auth guard.', error);
            }
        }, 200);
        return;
    }

    alert(AUTH_ALERT_MESSAGE);
    const redirectTarget = buildRedirectTarget();
    window.location.href = `signin.html?redirect=${encodeURIComponent(redirectTarget)}`;
}

function buildRedirectTarget() {
    const path = window.location.pathname.replace(/^\/+/, '');
    const search = window.location.search || '';
    return search ? `${path}${search}` : path;
}
