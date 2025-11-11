// ==========================================
// Order Page JavaScript
// ==========================================

let servicesData = [];

// Show message to user
function showMessage(message, type = 'info') {
    // Create message element if it doesn't exist
    let messageBox = document.getElementById('orderMessage');
    if (!messageBox) {
        messageBox = document.createElement('div');
        messageBox.id = 'orderMessage';
        messageBox.style.cssText = `
            position: fixed;
            top: 80px;
            left: 50%;
            transform: translateX(-50%);
            padding: 16px 24px;
            border-radius: 8px;
            font-weight: 500;
            z-index: 10000;
            max-width: 500px;
            text-align: center;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideDown 0.3s ease;
        `;
        document.body.appendChild(messageBox);
    }
    
    // Set colors based on type
    const colors = {
        success: { bg: '#10b981', text: '#ffffff' },
        error: { bg: '#ef4444', text: '#ffffff' },
        info: { bg: '#3b82f6', text: '#ffffff' }
    };
    
    const color = colors[type] || colors.info;
    messageBox.style.backgroundColor = color.bg;
    messageBox.style.color = color.text;
    messageBox.textContent = message;
    messageBox.style.display = 'block';
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        messageBox.style.display = 'none';
    }, 5000);
}

// Validation helpers
function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function validateURL(url) {
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Load services first
    loadServices();
    
    const orderForm = document.getElementById('orderForm');
    const serviceSelect = document.getElementById('service');
    const quantityInput = document.getElementById('quantity');
    const estimatedPriceEl = document.getElementById('estimatedPrice');
    
    // Update estimated price on input change
    function updatePrice() {
        const serviceId = serviceSelect?.value;
        const selectedOption = serviceSelect?.selectedOptions?.[0] || null;
        const min = selectedOption ? Number(selectedOption.dataset.min) : 10;
    const max = selectedOption ? (selectedOption.dataset.max === 'Infinity' ? Infinity : Number(selectedOption.dataset.max)) : 1000000;

        if (quantityInput) {
            quantityInput.min = Number.isFinite(min) ? min : 1;
            quantityInput.max = Number.isFinite(max) ? max : '';

            const hint = quantityInput.nextElementSibling;
            if (hint) {
                const minLabel = Number.isFinite(min) ? formatNumber(min) : '0';
                const maxLabel = Number.isFinite(max) ? formatNumber(max) : '∞';
                hint.textContent = `Minimum: ${minLabel} • Maximum: ${maxLabel}`;
                hint.style.color = '#64748B';
            }
        }

        const quantity = Number(quantityInput?.value) || 0;
        const service = servicesData.find(s => String(s.id) === String(serviceId));

        if (service && quantity > 0) {
            const rate = Number(service.rate || 0);
            const price = (quantity / 1000) * rate;
            estimatedPriceEl.textContent = '$' + price.toFixed(2);
            estimatedPriceEl.style.animation = 'pulse 0.5s ease';
        } else {
            estimatedPriceEl.textContent = '$0.00';
        }
    }
    
    // Add pulse animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
        }
    `;
    document.head.appendChild(style);
    
    serviceSelect?.addEventListener('change', updatePrice);
    quantityInput?.addEventListener('input', updatePrice);
    
    // Handle form submission
    if (orderForm) {
        orderForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Get form data
            const formData = new FormData(orderForm);
            const data = {
                platform: formData.get('platform'),
                serviceType: formData.get('serviceType'),
                link: formData.get('link'),
                quantity: formData.get('quantity'),
                email: formData.get('email'),
                notes: formData.get('notes')
            };
            
            // Validate
            if (!validateEmail(data.email)) {
                showMessage('Please enter a valid email address', 'error');
                return;
            }
            
            if (!validateURL(data.link)) {
                showMessage('Please enter a valid URL', 'error');
                return;
            }
            
            const serviceId = serviceSelect?.value;
            if (!serviceId) {
                showMessage('Please select a service', 'error');
                return;
            }

            const service = servicesData.find(s => String(s.id) === String(serviceId));
            if (!service) {
                showMessage('Selected service is no longer available. Please refresh.', 'error');
                return;
            }

            const quantityValue = Number(data.quantity);
            const minQuantity = Number.isFinite(service.min_quantity) && service.min_quantity > 0
                ? service.min_quantity
                : 10;
            const maxQuantity = service.max_quantity === Infinity
                ? Infinity
                : (Number.isFinite(service.max_quantity) && service.max_quantity > 0
                    ? service.max_quantity
                    : 1000000);

            if (!Number.isFinite(quantityValue) || quantityValue < minQuantity || quantityValue > maxQuantity) {
                showMessage(`Quantity must be between ${formatNumber(minQuantity)} and ${formatNumber(maxQuantity)}.`, 'error');
                return;
            }
            
            // Check authentication first
            const token = localStorage.getItem('token');
            if (!token) {
                showMessage('Please sign in to place an order', 'error');
                setTimeout(() => {
                    window.location.href = 'signin.html?redirect=order.html';
                }, 1500);
                return;
            }
            
            // Show loading
            const submitBtn = orderForm.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>Processing...</span>';
            
            // Prepare order payload
            const orderPayload = {
                serviceId: String(serviceId),
                link: data.link,
                quantity: quantityValue,
                notes: data.notes || ''
            };
            
            // Debug log
            console.log('[ORDER] Submitting order:', orderPayload);
            
            try {
                // Call Orders API
                const response = await fetch('/.netlify/functions/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(orderPayload)
                });

                const result = await response.json();
                
                console.log('[ORDER] Response:', response.status, result);

                if (response.ok && result.success) {
                    showMessage(`Order #${result.order.order_number || result.order.id} created successfully!`, 'success');
                    orderForm.reset();
                    updatePrice();
                    
                    // Scroll to top
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    
                    // Redirect to dashboard after 2 seconds
                    setTimeout(() => {
                        window.location.href = 'dashboard.html';
                    }, 2000);
                } else {
                    // Show detailed error
                    let errorMsg = result.error || 'Order creation failed';
                    if (result.details) {
                        errorMsg += '\nDetails: ' + JSON.stringify(result.details);
                    }
                    throw new Error(errorMsg);
                }
            } catch (error) {
                console.error('Order error:', error);
                showMessage(error.message || 'Failed to create order. Please try again.', 'error');
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnText;
            }
        });
    }
    
    // Pre-fill service from URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    const serviceParam = urlParams.get('service');
    
    if (serviceParam && serviceSelect) {
        // Wait for services to load then select
        const checkInterval = setInterval(() => {
            if (servicesData.length > 0) {
                clearInterval(checkInterval);
                serviceSelect.value = serviceParam;
                updatePrice();
            }
        }, 100);
    }
    
    // Real-time link validation
    const linkInput = document.getElementById('link');
    if (linkInput) {
        linkInput.addEventListener('blur', function() {
            if (this.value && !validateURL(this.value)) {
                this.style.borderColor = '#ef4444';
                const hint = this.nextElementSibling;
                if (hint) {
                    hint.textContent = '❌ Please enter a valid URL';
                    hint.style.color = '#ef4444';
                }
            } else if (this.value) {
                this.style.borderColor = '#10b981';
                const hint = this.nextElementSibling;
                if (hint) {
                    hint.textContent = '✅ Valid URL';
                    hint.style.color = '#10b981';
                }
            }
        });
    }
    
    // Real-time email validation
    const emailInput = document.getElementById('email');
    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            if (this.value && !validateEmail(this.value)) {
                this.style.borderColor = '#ef4444';
                const hint = this.nextElementSibling;
                if (hint) {
                    hint.textContent = '❌ Please enter a valid email';
                    hint.style.color = '#ef4444';
                }
            } else if (this.value) {
                this.style.borderColor = '#10b981';
                const hint = this.nextElementSibling;
                if (hint) {
                    hint.textContent = '✅ Valid email';
                    hint.style.color = '#10b981';
                }
            }
        });
    }
    
    // Quantity validation
    if (quantityInput) {
        quantityInput.addEventListener('input', function() {
            const value = Number(this.value);
            const selectedOption = serviceSelect?.selectedOptions?.[0] || null;
            const min = selectedOption ? Number(selectedOption.dataset.min) : 10;
            const max = selectedOption ? (selectedOption.dataset.max === 'Infinity' ? Infinity : Number(selectedOption.dataset.max)) : 1000000;
            const hint = this.nextElementSibling;

            if (!value) {
                this.style.borderColor = '';
                if (hint) {
                    const minLabel = Number.isFinite(min) ? formatNumber(min) : '0';
                    const maxLabel = Number.isFinite(max) ? formatNumber(max) : '∞';
                    hint.textContent = `Minimum: ${minLabel} • Maximum: ${maxLabel}`;
                    hint.style.color = '#64748B';
                }
                return;
            }

            if (value < min || !Number.isFinite(value)) {
                this.style.borderColor = '#ef4444';
                if (hint) {
                    hint.textContent = `❌ Minimum quantity is ${formatNumber(min)}`;
                    hint.style.color = '#ef4444';
                }
                return;
            }

            if (Number.isFinite(max) && value > max) {
                this.style.borderColor = '#ef4444';
                if (hint) {
                    hint.textContent = `❌ Maximum quantity is ${formatNumber(max)}`;
                    hint.style.color = '#ef4444';
                }
                return;
            }

            this.style.borderColor = '#10b981';
            if (hint) {
                hint.textContent = '✅ Quantity looks good';
                hint.style.color = '#10b981';
            }
        });
    }
});

console.log('💰 Order page loaded!');

// ==========================================
// Load Services from API
// ==========================================

async function loadServices() {
    const serviceSelect = document.getElementById('service');
    
    if (!serviceSelect) return;
    
    console.log('[ORDER] Loading services...');
    serviceSelect.disabled = true;
    serviceSelect.innerHTML = '<option value="">Loading services...</option>';
    
    try {
        const token = localStorage.getItem('token');
        const fetchHeaders = {
            'Content-Type': 'application/json'
        };
        
        // Add auth header if user is logged in (to see inactive services if admin)
        if (token) {
            fetchHeaders['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch('/.netlify/functions/services', {
            method: 'GET',
            headers: fetchHeaders
        });
        
        console.log('[ORDER] Services API response:', response.status);
        
        const data = await response.json();
        
        if (!response.ok) {
            console.error('[ORDER] Services API error:', data);
            throw new Error(data.error || 'Failed to load services');
        }
        
        console.log('[ORDER] Received services:', data.services?.length || 0);
        
        servicesData = (data.services || []).map(service => {
            const rawMin = service.min_quantity ?? service.min_order;
            const minCandidate = rawMin === null || rawMin === undefined ? NaN : Number(rawMin);
            const minValue = Number.isFinite(minCandidate) && minCandidate > 0 ? minCandidate : 10;

            const rawMax = service.max_quantity ?? service.max_order;
            let maxValue;
            if (rawMax === null || rawMax === undefined) {
                maxValue = Infinity;
            } else {
                const maxCandidate = Number(rawMax);
                maxValue = Number.isFinite(maxCandidate) && maxCandidate > 0 ? maxCandidate : 1000000;
            }

            const rateCandidate = Number(service.rate || 0);
            const publicIdCandidate = Number(service.public_id ?? service.publicId);

            return {
                ...service,
                id: String(service.id),
                rate: Number.isFinite(rateCandidate) ? rateCandidate : 0,
                min_quantity: minValue,
                max_quantity: maxValue,
                publicId: Number.isFinite(publicIdCandidate) ? publicIdCandidate : null
            };
        });
        console.log('[DEBUG] Loaded services for order form:', servicesData.length);
        
        if (servicesData.length === 0) {
            console.warn('[ORDER] No services available!');
            serviceSelect.innerHTML = '<option value="">No services available</option>';
            showMessage('No services are currently available. Please contact support.', 'error');
            serviceSelect.disabled = true;
            return;
        }
        
        // Group services by category
        const grouped = {};
        servicesData.forEach(service => {
            const category = (service.category || 'Other').toLowerCase();
            const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
            if (!grouped[categoryName]) {
                grouped[categoryName] = [];
            }
            grouped[categoryName].push(service);
        });
        
        // Build select options with optgroups
        let html = '<option value="">Select a service</option>';
        
        Object.keys(grouped).sort().forEach(categoryName => {
            html += `<optgroup label="${escapeHtml(categoryName)}">`;
            grouped[categoryName].forEach(service => {
                const rate = Number(service.rate || 0).toFixed(2);
                const min = service.min_quantity;
                const max = service.max_quantity;
                const datasetMax = max === Infinity ? 'Infinity' : max;
                const labelId = service.publicId ? `#${service.publicId}` : (service.provider_service_id ? `PID ${service.provider_service_id}` : 'ID');
                html += `<option value="${service.id}" data-rate="${rate}" data-min="${min}" data-max="${datasetMax}" data-public-id="${service.publicId ?? ''}">
                    ${labelId} · ${escapeHtml(service.name)} - $${rate}/1k (Min: ${formatNumber(min)}, Max: ${formatNumber(max)})
                </option>`;
            });
            html += '</optgroup>';
        });
        
        serviceSelect.innerHTML = html;
        console.log('[SUCCESS] Services populated in order form');
        showMessage(`${servicesData.length} services loaded successfully`, 'success');
        serviceSelect.disabled = false;
        
    } catch (error) {
        console.error('[ERROR] Failed to load services:', error);
        serviceSelect.innerHTML = '<option value="">Error loading services - Retry</option>';
        serviceSelect.disabled = true;
        showMessage('Failed to load services: ' + error.message, 'error');
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (!isFinite(num)) {
        return '∞';
    }

    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(0) + 'K';
    }
    return num.toString();
}
