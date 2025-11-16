// Add Funds Page Functionality

document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('addFundsForm');
    const customAmountInput = document.getElementById('customAmount');
    const amountButtons = document.querySelectorAll('.amount-btn');
    const summaryAmount = document.getElementById('summaryAmount');
    const summaryFee = document.getElementById('summaryFee');
    const summaryTotal = document.getElementById('summaryTotal');
    const balanceAmount = document.querySelector('.balance-amount');
    const paymentMethodCards = document.querySelectorAll('.payment-method-card');
    const paymentMethodHint = document.getElementById('paymentMethodHint');
    const submitBtn = form.querySelector('button[type="submit"]');
    const submitBtnText = submitBtn ? submitBtn.querySelector('span') : null;

    const BUTTON_LABELS = {
        payeer: 'Proceed to Payment',
        crypto: 'Generate Crypto Invoice'
    };

    const BUTTON_LOADING_LABELS = {
        payeer: 'Redirecting to Payeer...',
        crypto: 'Generating Crypto Invoice...'
    };

    let selectedMethod = 'payeer';
    let selectedCryptoCurrency = null;

    // Processing fee percentage
    const FEE_PERCENTAGE = 2.5;

    // Load current balance on page load
    loadUserBalance();

    // Payment method selection
    if (paymentMethodCards.length) {
        paymentMethodCards.forEach(card => {
            const activateCard = () => {
                paymentMethodCards.forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                selectedMethod = card.dataset.method || 'payeer';
                selectedCryptoCurrency = card.dataset.payCurrency || null;
                updatePaymentMethodHint();
                updateSubmitButtonLabel();
            };

            card.addEventListener('click', activateCard);
            card.addEventListener('keydown', event => {
                if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar' || event.key === 'Space') {
                    event.preventDefault();
                    activateCard();
                }
            });
        });

        updatePaymentMethodHint();
        updateSubmitButtonLabel();
    }

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
        const token = localStorage.getItem('token');
        if (!token) {
            showMessage('Please login to add funds', 'error');
            window.location.href = 'signin.html';
            return;
        }

        // Decode token to get user email
        let userEmail;
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            userEmail = payload.email;
        } catch (error) {
            showMessage('Invalid session. Please login again.', 'error');
            window.location.href = 'signin.html';
            return;
        }

        if (submitBtn && submitBtnText) {
            submitBtn.disabled = true;
            submitBtnText.textContent = BUTTON_LOADING_LABELS[selectedMethod] || BUTTON_LOADING_LABELS.payeer;
        }

        try {
            if (selectedMethod === 'crypto') {
                await initiateCryptoPayment({ amount, token });
            } else {
                await initiatePayeerPayment({ amount, token, userEmail });
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

    async function loadUserBalance() {
        const token = localStorage.getItem('token');

        if (!token || !balanceAmount) {
            return;
        }

        try {
            const response = await fetch('/.netlify/functions/users', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error('Failed to retrieve balance');
            }

            const data = await response.json();

            if (data && data.user) {
                const balanceValue = parseFloat(data.user.balance || 0);
                balanceAmount.textContent = `$${balanceValue.toFixed(2)}`;
                localStorage.setItem('user', JSON.stringify(data.user));
            }
        } catch (error) {
            console.error('Error loading user balance:', error);
        }
    }

    function updatePaymentMethodHint() {
        if (!paymentMethodHint) return;

        if (selectedMethod === 'crypto') {
            paymentMethodHint.textContent = 'Crypto payments are powered by NOWPayments. An invoice link will open in a new tab and you can pay using USDT (TRC20).';
        } else {
            paymentMethodHint.textContent = 'Manual Payeer transfers require including your Order ID in the transfer notes.';
        }
    }

    function updateSubmitButtonLabel() {
        if (!submitBtnText) return;
        submitBtnText.textContent = BUTTON_LABELS[selectedMethod] || BUTTON_LABELS.payeer;
    }

    async function initiatePayeerPayment({ amount, token, userEmail }) {
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

        if (data.success) {
            showManualPaymentInstructions(amount, data.orderId);
            loadUserBalance();
        } else {
            throw new Error(data.error || 'Payment initiation failed');
        }
    }

    async function initiateCryptoPayment({ amount, token }) {
        const response = await fetch('/.netlify/functions/crypto-payments', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'create-invoice',
                amount: amount,
                payCurrency: selectedCryptoCurrency || undefined
            })
        });

        const data = await response.json();

        if (data.success) {
            showCryptoPaymentInstructions({
                amount,
                orderId: data.orderId,
                invoiceUrl: data.invoiceUrl,
                payAddress: data.payAddress,
                payAmount: data.payAmount,
                payCurrency: data.payCurrency
            });
        } else {
            throw new Error(data.error || 'Failed to generate crypto invoice');
        }
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
                    <a href="mailto:omerdmvc@gmail.com?subject=Payment Confirmation - Order ${orderId}&body=I have sent $${amount.toFixed(2)} USD to Payeer ID P1135369069.%0D%0AOrder ID: ${orderId}%0D%0APlease confirm and activate my funds." 
                       class="btn-primary btn-contact">
                        <i class="fas fa-envelope"></i>
                        Contact: omerdmvc@gmail.com
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

function showCryptoPaymentInstructions({ amount, orderId, invoiceUrl, payAddress, payAmount, payCurrency }) {
    const normalizedPayAmount = payAmount && !isNaN(parseFloat(payAmount)) ? parseFloat(payAmount) : null;
    const normalizedCurrency = payCurrency ? String(payCurrency).toUpperCase() : '';
    const payAmountDisplay = normalizedPayAmount
        ? `${normalizedPayAmount.toFixed(6)} ${normalizedCurrency}`
        : `$${amount.toFixed(2)}`;

    const modal = document.createElement('div');
    modal.className = 'payment-instructions-modal';
    modal.innerHTML = `
        <div class="payment-instructions-content">
            <div class="payment-instructions-header">
                <h2>Crypto Invoice Generated</h2>
                <button class="close-modal" onclick="this.closest('.payment-instructions-modal').remove()">×</button>
            </div>
            <div class="payment-instructions-body">
                <div class="payment-method-badge">
                    <i class="fas fa-coins"></i>
                    <span>NOWPayments</span>
                </div>
                <div class="payment-details">
                    <h3>Invoice Details</h3>
                    <div class="detail-row">
                        <span class="detail-label">Order ID:</span>
                        <span class="detail-value">${orderId}</span>
                    </div>
                    <div class="detail-row">
                        <span class="detail-label">Pay Amount:</span>
                        <span class="detail-value amount">${payAmountDisplay}</span>
                    </div>
                    <div class="detail-row highlight">
                        <span class="detail-label">Deposit Address:</span>
                        <span class="detail-value payeer-id">${payAddress || 'Provided on invoice page'}</span>
                    </div>
                </div>
                <div class="payment-instructions">
                    <h3>Next Steps</h3>
                    <ol>
                        <li>Open the hosted invoice in a new tab.</li>
                        <li>Send the exact amount shown using <strong>${normalizedCurrency || 'your selected asset'}</strong>.</li>
                        <li>Await network confirmations – we will credit your balance automatically.</li>
                    </ol>
                </div>
                <div class="payment-confirmation">
                    <div class="confirmation-icon">
                        <i class="fas fa-external-link-alt"></i>
                    </div>
                    <h3>Open Invoice</h3>
                    <p>The invoice contains a QR code and the precise deposit address. Complete payment within the countdown timer.</p>
                    <a href="${invoiceUrl}" target="_blank" rel="noopener" class="btn-primary btn-contact">
                        <i class="fas fa-arrow-up-right-from-square"></i>
                        View Crypto Invoice
                    </a>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}