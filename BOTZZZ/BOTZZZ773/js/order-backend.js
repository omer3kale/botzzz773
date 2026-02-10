// Order Management with Backend Integration
// Load this AFTER api-client.js

document.addEventListener('DOMContentLoaded', async () => {
    const orderForm = document.getElementById('orderForm');
    if (orderForm) {
        orderForm.addEventListener('submit', handleOrderSubmit);
        
        // Load services from backend
        await loadServices();
    }
});

function normalizeQuantityValue(rawValue) {
    const raw = rawValue === undefined || rawValue === null ? '' : String(rawValue).trim();
    if (!raw) {
        return null;
    }
    if (!/^[0-9]+$/.test(raw)) {
        return null;
    }
    return Number(raw);
}

function coerceQuantityInput({ clampToLimits = false } = {}) {
    const quantityInput = document.getElementById('quantity');
    if (!quantityInput) {
        return null;
    }
    const normalized = normalizeQuantityValue(quantityInput.value);
    if (normalized === null) {
        return null;
    }
    let finalValue = normalized;
    if (clampToLimits) {
        const serviceSelect = document.getElementById('service');
        const selectedOption = serviceSelect?.options?.[serviceSelect.selectedIndex];
        const min = Number(selectedOption?.dataset?.min ?? quantityInput.min ?? 0);
        const max = Number(selectedOption?.dataset?.max ?? quantityInput.max ?? Infinity);
        const safeMin = Number.isFinite(min) ? min : 0;
        const safeMax = Number.isFinite(max) ? max : Infinity;
        finalValue = Math.min(Math.max(finalValue, safeMin), safeMax);
    }
    if (String(quantityInput.value) !== String(finalValue)) {
        quantityInput.value = finalValue;
    }
    return finalValue;
}

// Load services from backend
async function loadServices() {
    try {
        const data = await api.getServices();
        
        if (data.services && data.services.length > 0) {
            populateServiceDropdown(data.services);
        }
    } catch (error) {
        console.error('[ORDER-BACKEND] Failed to load services:', error);
        // Silent failure - no customer notification
    }
}

// Populate service dropdown
function populateServiceDropdown(services) {
    const serviceSelect = document.getElementById('service');
    if (!serviceSelect) return;

    // Clear existing options except first
    while (serviceSelect.options.length > 1) {
        serviceSelect.remove(1);
    }

    // Group services by category
    const servicesByCategory = {};
    services.forEach(service => {
        if (!servicesByCategory[service.category]) {
            servicesByCategory[service.category] = [];
        }
        servicesByCategory[service.category].push(service);
    });

    // Add services by category
    Object.keys(servicesByCategory).sort().forEach(category => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = category;

        servicesByCategory[category].forEach(service => {
            const option = document.createElement('option');
            option.value = service.id;
            option.textContent = `${service.name} ($${service.rate}/1000)`;
            option.dataset.price = service.rate;
            option.dataset.min = service.min_quantity;
            option.dataset.max = service.max_quantity;
            optgroup.appendChild(option);
        });

        serviceSelect.appendChild(optgroup);
    });
}

// Handle order submission
async function handleOrderSubmit(e) {
    e.preventDefault();

    const serviceId = document.getElementById('service')?.value;
    const link = document.getElementById('link')?.value.trim();
    const quantity = coerceQuantityInput({ clampToLimits: true });

    // Validation
    if (!serviceId || !link || !Number.isFinite(quantity) || quantity <= 0) {
        showMessage('Please fill in all fields', 'error');
        return;
    }
    if (!Number.isInteger(quantity)) {
        showMessage('Quantity must be a whole number', 'error');
        return;
    }

    // Check if user is logged in
    if (!isLoggedIn()) {
        showMessage('Please login to place an order', 'error');
        setTimeout(() => {
            window.location.href = 'signin.html';
        }, 2000);
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';

    try {
        const data = await api.createOrder(serviceId, quantity, link);
        
        if (data.success && data.order) {
            const orderLabel = data.order.order_number || data.order.id;
            showMessage(`Order placed successfully! Order ID: ${orderLabel}`, 'success');
            
            // Update user balance in localStorage with 5-decimal precision and trim trailing zeros
            const user = getCurrentUser();
            if (user) {
                const newBalance = Number((parseFloat(user.balance) - parseFloat(data.order.charge)).toFixed(5));
                const formattedBalance = String(newBalance.toFixed(5)).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
                user.balance = Number(formattedBalance);
                localStorage.setItem('user', JSON.stringify(user));
                updateNavigation(true, user);
            }

            // Reset form
            e.target.reset();
            const priceEl = document.getElementById('estimatedPrice');
            if (priceEl) {
                priceEl.textContent = '$0.00';
            }
            
            // Redirect to orders page after 2 seconds
            setTimeout(() => {
                window.location.href = 'orders.html';
            }, 2000);
        } else {
            showMessage(data.error || 'Order placement failed', 'error');
        }
    } catch (error) {
        console.error('Order error:', error);
        showMessage(error.message || 'Failed to place order. Please try again.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// Update price calculation
function updatePrice() {
    const serviceSelect = document.getElementById('service');
    const quantityInput = document.getElementById('quantity');
    const totalPriceEl = document.getElementById('estimatedPrice');

    if (!serviceSelect || !quantityInput || !totalPriceEl) return;

    const selectedOption = serviceSelect.options[serviceSelect.selectedIndex];
    const price = parseFloat(selectedOption.dataset.price || 0);
    const quantity = normalizeQuantityValue(quantityInput.value) || 0;
    const min = parseInt(selectedOption.dataset.min || 0);
    const max = parseInt(selectedOption.dataset.max || 999999);

    // Validate quantity
    if (quantity < min) {
        quantityInput.value = min;
        showMessage(`Minimum quantity is ${min}`, 'warning');
    } else if (quantity > max) {
        quantityInput.value = max;
        showMessage(`Maximum quantity is ${max}`, 'warning');
    }

    // Calculate total
    const total = (price * quantity / 1000).toFixed(2);
    totalPriceEl.textContent = `$${total}`;
    
    // Pulse animation
    totalPriceEl.style.animation = 'none';
    setTimeout(() => {
        totalPriceEl.style.animation = 'pulse 0.5s';
    }, 10);
}

// Attach event listeners for price updates
document.getElementById('service')?.addEventListener('change', updatePrice);
const orderQuantityInput = document.getElementById('quantity');
orderQuantityInput?.addEventListener('input', updatePrice);
orderQuantityInput?.addEventListener('blur', () => {
    coerceQuantityInput({ clampToLimits: true });
    updatePrice();
});
orderQuantityInput?.addEventListener('input', () => {
    if (orderQuantityInput.validity.customError) {
        orderQuantityInput.setCustomValidity('');
    }
});
orderQuantityInput?.addEventListener('invalid', () => {
    const raw = String(orderQuantityInput.value || '').trim();
    if (!raw) {
        orderQuantityInput.setCustomValidity('Please enter a quantity.');
        return;
    }
    const numeric = Number(raw.replace(',', '.'));
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
        const lower = Math.floor(numeric);
        const upper = Math.ceil(numeric);
        if (Number.isFinite(lower) && Number.isFinite(upper)) {
            orderQuantityInput.setCustomValidity(`Please enter a whole number. The nearest valid values are ${lower} and ${upper}.`);
        } else {
            orderQuantityInput.setCustomValidity('Please enter a whole number.');
        }
        return;
    }
    orderQuantityInput.setCustomValidity('');
});

// Show message helper
function showMessage(message, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `alert alert-${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
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
        messageDiv.style.background = '#10b981';
    } else if (type === 'error') {
        messageDiv.style.background = '#ef4444';
    } else if (type === 'warning') {
        messageDiv.style.background = '#f59e0b';
    }

    document.body.appendChild(messageDiv);

    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => messageDiv.remove(), 300);
    }, 5000);
}
