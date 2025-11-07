// ==========================================
// Order Page JavaScript
// ==========================================

let servicesData = [];

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
        const quantity = parseInt(quantityInput?.value) || 0;
        
        if (serviceId && quantity > 0) {
            const service = servicesData.find(s => s.id == serviceId);
            if (service) {
                const rate = parseFloat(service.rate || 0);
                const price = (quantity / 1000) * rate;
                estimatedPriceEl.textContent = '$' + price.toFixed(2);
                estimatedPriceEl.style.animation = 'pulse 0.5s ease';
            }
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
            
            if (parseInt(data.quantity) < 10) {
                showMessage('Minimum order quantity is 10', 'error');
                return;
            }
            
            // Show loading
            const submitBtn = orderForm.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.textContent;
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<span>Processing...</span>';
            
            try {
                // Get service_id from the service dropdown
                const serviceId = serviceSelect?.value;
                if (!serviceId) {
                    showMessage('Please select a service', 'error');
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                    return;
                }
                
                // Call Orders API
                const response = await fetch('/.netlify/functions/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify({
                        service_id: parseInt(serviceId),
                        link: data.link,
                        quantity: parseInt(data.quantity),
                        notes: data.notes || ''
                    })
                });

                const result = await response.json();

                if (result.success) {
                    showMessage(`Order #${result.order.id} created successfully!`, 'success');
                    orderForm.reset();
                    updatePrice();
                    
                    // Scroll to top
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    
                    // Redirect to dashboard after 2 seconds
                    setTimeout(() => {
                        window.location.href = 'dashboard.html';
                    }, 2000);
                } else {
                    throw new Error(result.error || 'Order creation failed');
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
            const value = parseInt(this.value);
            if (value && value < 10) {
                this.style.borderColor = '#ef4444';
                const hint = this.nextElementSibling;
                if (hint) {
                    hint.textContent = '❌ Minimum quantity is 10';
                    hint.style.color = '#ef4444';
                }
            } else if (value) {
                this.style.borderColor = '#10b981';
                const hint = this.nextElementSibling;
                if (hint) {
                    hint.textContent = '✅ Valid quantity';
                    hint.style.color = '#10b981';
                }
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
    
    try {
        const response = await fetch('/.netlify/functions/services', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to load services');
        }
        
        servicesData = data.services || [];
        console.log('[DEBUG] Loaded services for order form:', servicesData.length);
        
        if (servicesData.length === 0) {
            serviceSelect.innerHTML = '<option value="">No services available</option>';
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
                const rate = parseFloat(service.rate || 0).toFixed(2);
                const min = parseInt(service.min_order || 10);
                const max = parseInt(service.max_order || 10000);
                html += `<option value="${service.id}" data-rate="${rate}" data-min="${min}" data-max="${max}">
                    ${escapeHtml(service.name)} - $${rate}/1k (Min: ${formatNumber(min)}, Max: ${formatNumber(max)})
                </option>`;
            });
            html += '</optgroup>';
        });
        
        serviceSelect.innerHTML = html;
        console.log('[SUCCESS] Services populated in order form');
        
    } catch (error) {
        console.error('[ERROR] Failed to load services:', error);
        serviceSelect.innerHTML = '<option value="">Error loading services</option>';
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(0) + 'K';
    }
    return num.toString();
}
