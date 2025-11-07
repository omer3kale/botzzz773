// Dashboard Functionality - Authentication Required
(function() {
    'use strict';

    // ==========================================
    // AUTHENTICATION CHECK
    // ==========================================
    function checkAuth() {
        const token = localStorage.getItem('token');
        const user = localStorage.getItem('user');

        // If no token or user, redirect to sign in
        if (!token || !user) {
            window.location.href = 'signin.html';
            return null;
        }

        try {
            const userData = JSON.parse(user);
            return { token, user: userData };
        } catch (error) {
            console.error('Invalid user data:', error);
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            window.location.href = 'signin.html';
            return null;
        }
    }

    // ==========================================
    // INITIALIZE DASHBOARD
    // ==========================================
    const auth = checkAuth();
    if (!auth) return;

    const { token, user } = auth;

    // Update UI with user data
    function updateUserDisplay() {
        const userNameEl = document.getElementById('userName');
        const balanceAmountEl = document.getElementById('balanceAmount');

        if (userNameEl && user.username) {
            userNameEl.textContent = user.username;
        }

        if (balanceAmountEl && user.balance !== undefined) {
            balanceAmountEl.textContent = `$${parseFloat(user.balance).toFixed(2)}`;
        }
    }

    // ==========================================
    // MOBILE MENU TOGGLE
    // ==========================================
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.querySelector('.dashboard-sidebar');

    if (mobileMenuToggle && sidebar) {
        mobileMenuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('show');
        });

        // Close sidebar when clicking outside on mobile
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 1024) {
                if (!sidebar.contains(e.target) && !mobileMenuToggle.contains(e.target)) {
                    sidebar.classList.remove('show');
                }
            }
        });
    }

    // ==========================================
    // USER MENU DROPDOWN
    // ==========================================
    const userMenuBtn = document.getElementById('userMenuBtn');
    const userDropdown = document.getElementById('userDropdown');

    if (userMenuBtn && userDropdown) {
        userMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userDropdown.classList.toggle('show');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', () => {
            userDropdown.classList.remove('show');
        });
    }

    // ==========================================
    // LOGOUT FUNCTIONALITY
    // ==========================================
    function handleLogout() {
        // Clear all auth data
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.clear();

        // Show notification
        showToast('Logged out successfully', 'success');

        // Redirect to home page
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1000);
    }

    const logoutBtn = document.getElementById('logoutBtn');
    const logoutLink = document.getElementById('logoutLink');

    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    if (logoutLink) {
        logoutLink.addEventListener('click', (e) => {
            e.preventDefault();
            handleLogout();
        });
    }

    // ==========================================
    // TOAST NOTIFICATION
    // ==========================================
    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        if (!toast) return;

        const messageEl = toast.querySelector('.toast-message');
        const closeBtn = toast.querySelector('.toast-close');

        // Remove existing classes
        toast.classList.remove('success', 'error', 'show');

        // Set message and type
        if (messageEl) messageEl.textContent = message;
        toast.classList.add(type);

        // Show toast
        setTimeout(() => toast.classList.add('show'), 10);

        // Auto hide after 5 seconds
        const hideTimeout = setTimeout(() => {
            toast.classList.remove('show');
        }, 5000);

        // Close button
        if (closeBtn) {
            closeBtn.onclick = () => {
                clearTimeout(hideTimeout);
                toast.classList.remove('show');
            };
        }
    }

    // ==========================================
    // SERVICES DATA - LOADED FROM DATABASE
    // ==========================================
    let servicesData = {};

    // Load services from database
    async function loadServicesFromDatabase() {
        try {
            const response = await fetch('/.netlify/functions/services');
            const data = await response.json();
            
            if (data.success && data.services) {
                // Categorize services
                servicesData = {};
                data.services.forEach(service => {
                    const category = (service.category || 'other').toLowerCase();
                    const publicId = Number(service.public_id ?? service.publicId);
                    const minQuantity = Number(service.min_quantity ?? service.min_order ?? 100) || 100;
                    const maxQuantity = Number(service.max_quantity ?? service.max_order ?? 10000) || 10000;
                    if (!servicesData[category]) {
                        servicesData[category] = [];
                    }
                    servicesData[category].push({
                        id: service.id.toString(),
                        publicId: Number.isFinite(publicId) ? publicId : null,
                        provider_service_id: service.provider_service_id || 'N/A',
                        name: service.name,
                        price: parseFloat(service.rate),
                        min: minQuantity,
                        max: maxQuantity,
                        avgTime: service.avg_time || 'Not specified',
                        description: service.description || ''
                    });
                });
                
                console.log('Services loaded successfully:', Object.keys(servicesData).length, 'categories');
                return true;
            } else {
                console.error('Failed to load services:', data.error);
                return false;
            }
        } catch (error) {
            console.error('Error loading services:', error);
            showToast('Failed to load services. Please refresh the page.', 'error');
            return false;
        }
    }

    // ==========================================
    // ORDER FORM FUNCTIONALITY
    // ==========================================
    const categorySelect = document.getElementById('category');
    const serviceSelect = document.getElementById('service');
    const serviceInfo = document.getElementById('serviceInfo');
    const quantityInput = document.getElementById('quantity');
    const chargeAmount = document.getElementById('chargeAmount');
    const averageTimeEl = document.getElementById('averageTime');
    const orderForm = document.getElementById('orderForm');
    const searchInput = document.getElementById('searchServices');

    let selectedService = null;

    // Populate services based on category
    if (categorySelect && serviceSelect) {
        categorySelect.addEventListener('change', (e) => {
            const category = e.target.value.toLowerCase();
            serviceSelect.innerHTML = '<option value="" disabled selected>Select a service</option>';
            
            if (category && servicesData[category]) {
                servicesData[category].forEach(service => {
                    const option = document.createElement('option');
                    option.value = service.id;
                    const labelId = service.publicId ? `#${service.publicId}` : `PID ${service.provider_service_id}`;
                    option.textContent = `[${labelId}] ${service.name}`;
                    option.dataset.price = service.price;
                    option.dataset.min = service.min;
                    option.dataset.max = service.max === Infinity ? 'Infinity' : service.max;
                    option.dataset.avgTime = service.avgTime;
                    option.dataset.description = service.description;
                    option.dataset.serviceName = service.name;
                    if (service.publicId) {
                        option.dataset.publicId = service.publicId;
                    }
                    serviceSelect.appendChild(option);
                });
            }
            
            resetOrderCalculation();
        });

        // Update service info and limits
        serviceSelect.addEventListener('change', (e) => {
            const option = e.target.options[e.target.selectedIndex];
            
            if (option.value) {
                const minValue = Number(option.dataset.min);
                const maxValue = option.dataset.max === 'Infinity'
                    ? Infinity
                    : Number(option.dataset.max);
                selectedService = {
                    id: option.value,
                    name: option.dataset.serviceName || option.textContent,
                    displayLabel: option.textContent,
                    price: parseFloat(option.dataset.price),
                    min: Number.isFinite(minValue) ? minValue : 0,
                    max: Number.isFinite(maxValue) ? maxValue : Infinity,
                    avgTime: option.dataset.avgTime,
                    publicId: option.dataset.publicId ? option.dataset.publicId : null
                };

                // Update quantity limits
                if (quantityInput) {
                    quantityInput.min = selectedService.min;
                    quantityInput.max = Number.isFinite(selectedService.max) ? selectedService.max : '';
                    const maxLabel = Number.isFinite(selectedService.max) ? selectedService.max : 'Unlimited';
                    quantityInput.placeholder = `Min: ${selectedService.min} - Max: ${maxLabel}`;
                    
                    // Update quantity info display
                    const quantityInfo = quantityInput.parentElement.querySelector('.quantity-info');
                    if (quantityInfo) {
                        quantityInfo.innerHTML = `
                            <span>Min: <strong>${selectedService.min}</strong></span>
                            <span>Max: <strong>${Number.isFinite(selectedService.max) ? selectedService.max.toLocaleString() : 'Unlimited'}</strong></span>
                        `;
                    }
                }

                // Update average time
                if (averageTimeEl) {
                    averageTimeEl.textContent = selectedService.avgTime;
                }

                // Show service info
                if (serviceInfo) {
                    const serviceLabel = selectedService.publicId ? `#${selectedService.publicId}` : selectedService.id;
                    serviceInfo.innerHTML = `
                        <strong>Service ID:</strong> ${serviceLabel} | 
                        <strong>Price:</strong> $${selectedService.price.toFixed(4)} per 1000 | 
                        <strong>Range:</strong> ${selectedService.min} - ${Number.isFinite(selectedService.max) ? selectedService.max.toLocaleString() : 'Unlimited'}
                    `;
                    serviceInfo.classList.add('show');
                }

                calculateCharge();
            } else {
                resetOrderCalculation();
            }
        });
    }

    // Calculate charge based on quantity
    if (quantityInput) {
        quantityInput.addEventListener('input', calculateCharge);
    }

    function calculateCharge() {
        if (!selectedService || !quantityInput) return;
        
        const quantity = parseInt(quantityInput.value) || 0;
        
        if (quantity >= selectedService.min && quantity <= selectedService.max) {
            const charge = (quantity / 1000) * selectedService.price;
            if (chargeAmount) {
                chargeAmount.textContent = `$${charge.toFixed(2)}`;
            }
        } else if (chargeAmount) {
            chargeAmount.textContent = '$0.00';
        }
    }

    function resetOrderCalculation() {
        selectedService = null;
        if (chargeAmount) chargeAmount.textContent = '$0.00';
        if (averageTimeEl) averageTimeEl.textContent = '34 minutes';
        if (serviceInfo) {
            serviceInfo.classList.remove('show');
            serviceInfo.innerHTML = '';
        }
        if (quantityInput) {
            quantityInput.min = 100;
            quantityInput.max = 30000;
            quantityInput.placeholder = 'Min: 100 - Max: 30,000';
        }
    }

    // ==========================================
    // SEARCH FUNCTIONALITY
    // ==========================================
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            
            if (searchTerm.length < 2) {
                categorySelect.value = '';
                serviceSelect.innerHTML = '<option value="" disabled selected>Select a service</option>';
                return;
            }

            // Search across all services
            let results = [];
            Object.entries(servicesData).forEach(([category, services]) => {
                services.forEach(service => {
                    if (service.name.toLowerCase().includes(searchTerm) || 
                        service.id.includes(searchTerm) ||
                        (service.publicId && service.publicId.toString().includes(searchTerm)) ||
                        service.provider_service_id.toString().includes(searchTerm)) {
                        results.push({ ...service, category });
                    }
                });
            });

            // Populate service select with results
            serviceSelect.innerHTML = '<option value="" disabled selected>Search results...</option>';
            results.forEach(service => {
                const option = document.createElement('option');
                const labelId = service.publicId ? `#${service.publicId}` : `PID ${service.provider_service_id}`;
                option.value = service.id;
                option.textContent = `[${labelId}] [${service.category.toUpperCase()}] ${service.name}`;
                option.dataset.price = service.price;
                option.dataset.min = service.min;
                option.dataset.max = service.max === Infinity ? 'Infinity' : service.max;
                option.dataset.avgTime = service.avgTime;
                option.dataset.description = service.description;
                option.dataset.serviceName = service.name;
                if (service.publicId) {
                    option.dataset.publicId = service.publicId;
                }
                serviceSelect.appendChild(option);
            });

            if (results.length === 0) {
                serviceSelect.innerHTML = '<option value="" disabled selected>No services found</option>';
            }
            
            // Reset category select when searching
            categorySelect.value = '';
        });
    }

    // ==========================================
    // FORM SUBMISSION
    // ==========================================
    if (orderForm) {
        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (!selectedService) {
                showToast('Please select a service', 'error');
                return;
            }

            const orderLink = document.getElementById('orderLink').value;
            const quantity = parseInt(quantityInput.value);

            // Validate quantity
            const maxLimit = Number.isFinite(selectedService.max) ? selectedService.max : Infinity;
            if (quantity < selectedService.min || (Number.isFinite(maxLimit) && quantity > maxLimit)) {
                const maxLabel = Number.isFinite(maxLimit) ? maxLimit : 'Unlimited';
                showToast(`Quantity must be between ${selectedService.min} and ${maxLabel}`, 'error');
                return;
            }

            // Calculate charge
            const charge = (quantity / 1000) * selectedService.price;

            // Check if user has sufficient balance
            if (parseFloat(user.balance) < charge) {
                showToast('Insufficient balance. Please add funds.', 'error');
                return;
            }

            const orderData = {
                serviceId: selectedService.id,
                serviceLabel: selectedService.publicId ? `#${selectedService.publicId}` : selectedService.name,
                link: orderLink,
                quantity
            };

            try {
                const response = await fetch('/.netlify/functions/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(orderData)
                });

                const result = await response.json();

                if (response.ok) {
                    showToast('Order placed successfully!', 'success');
                    
                    // Update user balance
                    user.balance = (parseFloat(user.balance) - charge).toFixed(2);
                    localStorage.setItem('user', JSON.stringify(user));
                    updateUserDisplay();

                    // Reset form
                    orderForm.reset();
                    resetOrderCalculation();

                    // Switch to orders view after 2 seconds
                    setTimeout(() => {
                        showOrdersView();
                        loadOrders();
                    }, 2000);
                } else {
                    showToast(result.error || 'Failed to place order', 'error');
                }
            } catch (error) {
                console.error('Order submission error:', error);
                showToast('Network error. Please try again.', 'error');
            }
        });
    }

    // ==========================================
    // ORDERS VIEW
    // ==========================================
    const ordersLink = document.getElementById('ordersLink');
    const dashboardContent = document.getElementById('dashboardContent');
    const ordersView = document.getElementById('ordersView');

    function showOrdersView() {
        if (dashboardContent) dashboardContent.classList.add('hidden');
        if (ordersView) ordersView.classList.remove('hidden');
        
        // Update sidebar active state
        document.querySelectorAll('.sidebar-link').forEach(link => {
            link.classList.remove('active');
        });
        if (ordersLink) ordersLink.classList.add('active');
    }

    function showDashboardView() {
        if (ordersView) ordersView.classList.add('hidden');
        if (dashboardContent) dashboardContent.classList.remove('hidden');
        
        // Update sidebar active state
        document.querySelectorAll('.sidebar-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector('.sidebar-link[href="dashboard.html"]')?.classList.add('active');
    }

    if (ordersLink) {
        ordersLink.addEventListener('click', (e) => {
            e.preventDefault();
            showOrdersView();
            loadOrders();
        });
    }

    // Load orders from backend
    async function loadOrders() {
        const ordersTableBody = document.getElementById('ordersTableBody');
        if (!ordersTableBody) return;

        try {
            const response = await fetch('/.netlify/functions/orders', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const result = await response.json();

            if (response.ok && result.orders) {
                displayOrders(result.orders);
            } else {
                ordersTableBody.innerHTML = `
                    <tr>
                        <td colspan="9" class="no-orders">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="8" x2="12" y2="12"/>
                                <line x1="12" y1="16" x2="12.01" y2="16"/>
                            </svg>
                            <p>No orders found</p>
                        </td>
                    </tr>
                `;
            }
        } catch (error) {
            console.error('Error loading orders:', error);
        }
    }

    function displayOrders(orders) {
        const ordersTableBody = document.getElementById('ordersTableBody');
        if (!ordersTableBody) return;

        if (orders.length === 0) {
            ordersTableBody.innerHTML = `
                <tr>
                    <td colspan="9" class="no-orders">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <p>No orders found</p>
                    </td>
                </tr>
            `;
            return;
        }

        ordersTableBody.innerHTML = orders.map(order => `
            <tr>
                <td><strong>${order.order_number || order.id}</strong></td>
                <td>${new Date(order.created_at).toLocaleDateString()}</td>
                <td><a href="${order.link}" target="_blank" style="color: var(--primary-pink);">${order.link.substring(0, 30)}...</a></td>
                <td>$${parseFloat(order.charge).toFixed(2)}</td>
                <td>${order.start_count || 0}</td>
                <td>${order.quantity}</td>
                <td>${order.service_name.substring(0, 40)}...</td>
                <td><span class="status-badge status-${order.status}">${order.status}</span></td>
                <td>${order.remains || 0}</td>
            </tr>
        `).join('');
    }

    // Order filters
    const filterBtns = document.querySelectorAll('.filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            filterBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            
            const filter = e.target.dataset.filter;
            // Implement filter logic here
            console.log('Filter by:', filter);
        });
    });

    // Initialize
    updateUserDisplay();
    
    // Load services from database on page load
    loadServicesFromDatabase().then(success => {
        if (success) {
            console.log('Dashboard ready with', Object.keys(servicesData).length, 'service categories');
        } else {
            console.warn('Dashboard loaded but services failed to load');
        }
    });

})();
