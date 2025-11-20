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

    function escapeHtml(text) {
        if (text === undefined || text === null) {
            return '';
        }
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
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
    let categoryLabels = {};

    const CATEGORY_ICON_MAP = {
        instagram: '📷',
        tiktok: '🎵',
        youtube: '▶️',
        twitter: '🐦',
        x: '🐦',
        facebook: '👍',
        telegram: '✈️',
        spotify: '🎧',
        soundcloud: '🎶',
        snapchat: '👻',
        threads: '🧵',
        linkedin: '💼',
        pinterest: '📌',
        twitch: '🎮',
        other: '⭐'
    };

    const CURRENCY_SYMBOLS = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        INR: '₹',
        TRY: '₺',
        BRL: 'R$',
        NGN: '₦',
        CAD: 'C$',
        AUD: 'A$',
        SGD: 'S$',
        AED: 'د.إ',
        SAR: '﷼',
        PHP: '₱'
    };

    function formatCurrencyDisplay(amount, currency = 'USD', digits = null) {
        const numeric = Number(amount);
        const normalizedCurrency = currency ? String(currency).toUpperCase().slice(0, 10) : 'USD';
        if (!Number.isFinite(numeric)) {
            return `-- ${normalizedCurrency}`;
        }

        // Dynamic decimal precision for sub-cent amounts
        let finalDigits = digits;
        if (finalDigits === null) {
            if (numeric < 0.01) {
                finalDigits = 6; // Show more decimals for tiny amounts like 0.0007
            } else if (numeric < 1) {
                finalDigits = 4; // Show 4 decimals for sub-dollar amounts
            } else {
                finalDigits = 2; // Standard 2 decimals for dollar amounts
            }
        }

        const symbol = CURRENCY_SYMBOLS[normalizedCurrency] || `${normalizedCurrency} `;
        const ambiguousSymbols = new Set(['C$', 'A$', 'S$']);
        const formatted = `${symbol}${numeric.toFixed(finalDigits)}`;
        return (!CURRENCY_SYMBOLS[normalizedCurrency] || ambiguousSymbols.has(symbol))
            ? `${formatted} ${normalizedCurrency}`
            : formatted;
    }

    function formatProviderOrderId(value) {
        if (value === undefined || value === null) return null;
        const normalized = String(value).trim();
        if (!normalized) return null;
        return normalized.startsWith('#') ? normalized : `#${normalized}`;
    }

    function resolveProviderOrderId(order = {}) {
        const raw = order.provider_order_id
            ?? order.provider_order
            ?? order.providerOrderId
            ?? order.provider?.order_id
            ?? order.meta?.provider_order_id
            ?? order.details?.provider_order_id
            ?? order.external_id
            ?? null;
        return formatProviderOrderId(raw);
    }

    function buildStatusKey(status) {
        return String(status || 'unknown')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            || 'unknown';
    }

    function formatOrderStatusLabel(status) {
        if (!status) return 'Unknown';
        return String(status)
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    const CAPABILITY_BADGES = [
        { key: 'refill', label: 'Refill' },
        { key: 'cancel', label: 'Cancel' },
        { key: 'dripfeed', label: 'Dripfeed' },
        { key: 'subscription', label: 'Subscription' }
    ];

    function renderCapabilityPills(capabilities = {}) {
        return CAPABILITY_BADGES
            .map(({ key, label }) => {
                const enabled = Boolean(capabilities[key]);
                const stateClass = enabled ? 'service-capability--on' : 'service-capability--off';
                return `<span class="service-meta-tag service-capability ${stateClass}">${label}</span>`;
            })
            .join('');
    }

    function slugifyCategory(rawValue) {
        return rawValue
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            || 'other';
    }

    function formatCategoryLabel(rawValue) {
        return rawValue
            .toString()
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
    }

    function getCategoryIcon(slug) {
        const baseSlug = slug.split('-')[0];
        return CATEGORY_ICON_MAP[baseSlug] || CATEGORY_ICON_MAP.other;
    }

    function populateCategoryOptions() {
        if (!categorySelect) {
            return;
        }

        const previousValue = categorySelect.value;
        categorySelect.innerHTML = '<option value="" disabled selected>Select a category</option>';
        if (serviceSelect) {
            serviceSelect.innerHTML = '<option value="" disabled selected>Select a service</option>';
        }

        const sortedCategories = Object.entries(categoryLabels)
            .sort(([, labelA], [, labelB]) => labelA.localeCompare(labelB));

        sortedCategories.forEach(([slug, label]) => {
            const option = document.createElement('option');
            option.value = slug;
            option.textContent = `${getCategoryIcon(slug)} ${label}`;
            categorySelect.appendChild(option);
        });

        if (previousValue && servicesData[previousValue]) {
            categorySelect.value = previousValue;
        }
    }

    // Load services from database
    async function loadServicesFromDatabase() {
        try {
            const response = await fetch('/.netlify/functions/services?audience=customer', {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            const rawBody = await response.text();
            let data;
            try {
                data = rawBody ? JSON.parse(rawBody) : {};
            } catch (parseError) {
                console.error('[DASHBOARD] Failed to parse services response:', parseError, rawBody);
                throw new Error('Received invalid response while loading services');
            }

            if (response.status === 401 || response.status === 403) {
                console.warn('[DASHBOARD] Services request unauthorized. Response:', data);
                throw new Error('Unauthorized access to services');
            }
            
            if (Array.isArray(data.services)) {
                const services = data.services;
                const approvedServices = services.filter(service => service.admin_approved === true || service.adminApproved === true);

                if (approvedServices.length > 0) {
                    // Categorize services
                    servicesData = {};
                    categoryLabels = {};
                    approvedServices.forEach(service => {
                        const rawCategory = service.category || 'Other';
                        const categorySlug = slugifyCategory(rawCategory);
                        const categoryLabel = formatCategoryLabel(rawCategory);

                        categoryLabels[categorySlug] = categoryLabel;

                        if (!servicesData[categorySlug]) {
                            servicesData[categorySlug] = [];
                        }
                        const rawPublicId = service.public_id ?? service.publicId;
                        const providerOrderReferenceRaw = service.provider_order_id ?? service.provider_service_id ?? service.provider_service_reference ?? '';
                        const providerServiceReferenceRaw = service.provider_service_id ?? service.provider_service_reference ?? providerOrderReferenceRaw;
                        const providerOrderReference = providerOrderReferenceRaw === null || providerOrderReferenceRaw === undefined
                            ? ''
                            : String(providerOrderReferenceRaw).trim();
                        const providerServiceReference = providerServiceReferenceRaw === null || providerServiceReferenceRaw === undefined
                            ? ''
                            : String(providerServiceReferenceRaw).trim();
                        const publicId = (rawPublicId === null || rawPublicId === undefined || rawPublicId === '')
                            ? null
                            : Number(rawPublicId);
                        const minQuantity = Number(service.min_quantity ?? service.min_order ?? 100) || 100;
                        const maxQuantity = Number(service.max_quantity ?? service.max_order ?? 10000) || 10000;
                        const currencyCode = (service.currency || 'USD').toUpperCase();
                        const avgTimeValue = service.average_time || service.avg_time || 'Not specified';
                        servicesData[categorySlug].push({
                            id: service.id.toString(),
                            publicId: Number.isFinite(publicId) ? publicId : null,
                            provider_order_id: providerOrderReference,
                            provider_service_id: providerServiceReference,
                            name: service.name,
                            price: parseFloat(service.rate),
                            min: minQuantity,
                            max: maxQuantity,
                            avgTime: avgTimeValue,
                            currency: currencyCode,
                            capabilities: {
                                refill: Boolean(service.refill_supported),
                                cancel: Boolean(service.cancel_supported),
                                dripfeed: Boolean(service.dripfeed_supported),
                                subscription: Boolean(service.subscription_supported)
                            },
                            description: service.description || '',
                            categoryLabel,
                            categorySlug
                        });
                    });
                    
                    console.log('Services loaded successfully:', Object.keys(servicesData).length, 'categories');
                    populateCategoryOptions();
                    return true;
                } else {
                    console.warn('[DASHBOARD] No customer-visible services returned.');
                    showToast('No services are currently available. Please contact support.', 'error');
                    populateCategoryOptions();
                    return false;
                }
            } else {
                console.error('Failed to load services:', data.error || 'No services array in response');
                showToast('Failed to load services. Please refresh the page.', 'error');
                populateCategoryOptions();
                return false;
            }
        } catch (error) {
            console.error('Error loading services:', error);
            showToast('Failed to load services. Please refresh the page.', 'error');
            populateCategoryOptions();
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
            const category = e.target.value;
            serviceSelect.innerHTML = '<option value="" disabled selected>Select a service</option>';
            
            if (category && servicesData[category]) {
                servicesData[category].forEach(service => {
                    const option = document.createElement('option');
                    option.value = service.id;
                    const hasPublicId = Number.isFinite(service.publicId);
                    const labelId = hasPublicId ? `#${service.publicId}` : 'ID Pending';
                    option.textContent = `[${labelId}] ${service.name}`;
                    option.dataset.price = service.price;
                    option.dataset.min = service.min;
                    option.dataset.max = service.max === Infinity ? 'Infinity' : service.max;
                    option.dataset.avgTime = service.avgTime;
                    option.dataset.description = service.description;
                    option.dataset.serviceName = service.name;
                    option.dataset.currency = service.currency;
                    option.dataset.capabilities = JSON.stringify(service.capabilities || {});
                    const providerRef = service.provider_order_id || service.provider_service_id;
                    if (providerRef) {
                        option.dataset.providerId = providerRef;
                    }
                    if (hasPublicId) {
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
                    publicId: option.dataset.publicId ? Number(option.dataset.publicId) : null,
                    providerReference: option.dataset.providerId || '',
                    currency: option.dataset.currency ? option.dataset.currency.toUpperCase() : 'USD',
                    capabilities: option.dataset.capabilities ? JSON.parse(option.dataset.capabilities) : {}
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
                    const serviceLabel = Number.isFinite(selectedService.publicId)
                        ? `#${selectedService.publicId}`
                        : 'ID Pending';
                    const providerRefRaw = selectedService.providerReference?.toString().trim();
                    const providerRefLabel = providerRefRaw
                        ? escapeHtml(providerRefRaw)
                        : 'Pending from provider';
                    const priceDisplay = formatCurrencyDisplay(selectedService.price, selectedService.currency, 4);
                    const capabilityMarkup = renderCapabilityPills(selectedService.capabilities || {});
                    serviceInfo.innerHTML = `
                        <div class="service-meta-row service-meta-row--wrap">
                            <span><strong>Service ID:</strong> ${serviceLabel}</span>
                            <span><strong>Provider Ref:</strong> ${providerRefLabel}</span>
                            <span><strong>Price:</strong> ${priceDisplay} / 1000</span>
                            <span><strong>Range:</strong> ${selectedService.min} - ${Number.isFinite(selectedService.max) ? selectedService.max.toLocaleString() : 'Unlimited'}</span>
                        </div>
                        <div class="service-meta-row service-meta-row--compact">${capabilityMarkup}</div>
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
                chargeAmount.textContent = formatCurrencyDisplay(charge, selectedService.currency);
            }
        } else if (chargeAmount) {
            chargeAmount.textContent = formatCurrencyDisplay(0, selectedService.currency);
        }
    }

    function resetOrderCalculation() {
        selectedService = null;
        if (chargeAmount) chargeAmount.textContent = formatCurrencyDisplay(0);
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
                        (service.provider_order_id && service.provider_order_id.toString().includes(searchTerm)) ||
                        (service.provider_service_id && service.provider_service_id.toString().includes(searchTerm))) {
                        results.push({ ...service, category });
                    }
                });
            });

            // Populate service select with results
            serviceSelect.innerHTML = '<option value="" disabled selected>Search results...</option>';
            results.forEach(service => {
                const option = document.createElement('option');
                const hasPublicId = Number.isFinite(service.publicId);
                const labelId = hasPublicId ? `#${service.publicId}` : 'ID Pending';
                option.value = service.id;
                const categoryDisplay = `${getCategoryIcon(service.categorySlug)} ${service.categoryLabel}`;
                option.textContent = `[${labelId}] [${categoryDisplay}] ${service.name}`;
                option.dataset.price = service.price;
                option.dataset.min = service.min;
                option.dataset.max = service.max === Infinity ? 'Infinity' : service.max;
                option.dataset.avgTime = service.avgTime;
                option.dataset.description = service.description;
                option.dataset.serviceName = service.name;
                option.dataset.currency = service.currency;
                option.dataset.capabilities = JSON.stringify(service.capabilities || {});
                const providerRef = service.provider_order_id || service.provider_service_id;
                if (providerRef) {
                    option.dataset.providerId = providerRef;
                }
                if (hasPublicId) {
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
                // Network error message removed - silent failure
            }
        });
    }

    // ==========================================
    // ORDERS VIEW
    // ==========================================
    const ordersLink = document.getElementById('ordersLink');
    const dashboardLink = document.querySelector('.sidebar-link[href="dashboard.html"]');
    const dashboardContent = document.getElementById('dashboardContent');
    const ordersView = document.getElementById('ordersView');

    function setActiveSidebarLink(activeLink) {
        document.querySelectorAll('.sidebar-link').forEach(link => {
            link.classList.remove('active');
            link.removeAttribute('aria-current');
        });

        if (activeLink) {
            activeLink.classList.add('active');
            activeLink.setAttribute('aria-current', 'page');
        }
    }

    function showOrdersView() {
        if (dashboardContent) dashboardContent.classList.add('hidden');
        if (ordersView) ordersView.classList.remove('hidden');

        setActiveSidebarLink(ordersLink);
    }

    function showDashboardView() {
        if (ordersView) ordersView.classList.add('hidden');
        if (paymentsView) paymentsView.classList.add('hidden');
        if (dashboardContent) dashboardContent.classList.remove('hidden');

        setActiveSidebarLink(dashboardLink);
    }

    if (ordersLink) {
        ordersLink.addEventListener('click', (e) => {
            e.preventDefault();
            showOrdersView();
            loadOrders();
        });
    }

    // Ensure initial active state has aria-current set
    if (dashboardLink) {
        setActiveSidebarLink(dashboardLink);
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

        ordersTableBody.innerHTML = orders.map(order => {
            // Prioritize order_number (37M range) for display
            let primaryLabel = '—';
            if (order.order_number !== undefined && order.order_number !== null && String(order.order_number).trim().length > 0) {
                primaryLabel = `#${String(order.order_number).trim()}`;
            } else if (order.id) {
                const compactId = String(order.id).replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
                primaryLabel = `#${compactId}`;
            }
            
            // Show provider order ID as secondary if available
            const providerOrderId = resolveProviderOrderId(order);
            const providerMarkup = providerOrderId 
                ? `<span class="order-id-secondary">Provider: ${escapeHtml(providerOrderId)}</span>`
                : '';
            
            const orderIdCell = `
                <div class="order-id-cell">
                    <span class="order-id-primary">${escapeHtml(primaryLabel)}</span>
                    ${providerMarkup}
                </div>
            `;
            const createdAt = order.created_at ? new Date(order.created_at).toLocaleDateString() : '—';
            const orderLink = typeof order.link === 'string' && order.link.trim().length > 0
                ? order.link.trim()
                : null;
            const linkLabel = orderLink
                ? `${orderLink.substring(0, 30)}${orderLink.length > 30 ? '…' : ''}`
                : 'No link provided';
            const safeOrderLink = orderLink ? escapeHtml(orderLink) : '';

            const currencyGuess = order.currency
                || order.retail_currency
                || order.customer_currency
                || order.service?.currency
                || 'USD';
            const chargeRaw = Number(order.charge ?? order.retail_charge ?? order.customer_charge ?? order.amount ?? 0);
            const chargeDisplay = formatCurrencyDisplay(chargeRaw, currencyGuess);

            const quantity = Number.isFinite(Number(order.quantity))
                ? Number(order.quantity)
                : 0;
            const statusKey = buildStatusKey(order.status);
            const statusLabel = formatOrderStatusLabel(order.status);

            return `
                <tr>
                    <td>${orderIdCell}</td>
                    <td>${createdAt}</td>
                    <td>${orderLink
                        ? `<a href="${safeOrderLink}" target="_blank" rel="noopener" style="color: var(--primary-pink);">${escapeHtml(linkLabel)}</a>`
                        : '<span style="color: var(--text-muted, #94a3b8); font-style: italic;">No link</span>'}
                    </td>
                    <td>${chargeDisplay}</td>
                    <td>${escapeHtml(order.start_count || 0)}</td>
                    <td>${escapeHtml(quantity)}</td>
                    <td><span class="status-badge status-${statusKey}">${escapeHtml(statusLabel)}</span></td>
                    <td>${escapeHtml(order.remains || 0)}</td>
                </tr>
            `;
        }).join('');
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

    // ==========================================
    // PAYMENTS VIEW
    // ==========================================
    const paymentsLink = document.getElementById('paymentsLink');
    const paymentsView = document.getElementById('paymentsView');
    const paymentsTableBody = document.getElementById('paymentsTableBody');
    const paymentsLoadingState = document.getElementById('paymentsLoadingState');
    const paymentsEmptyState = document.getElementById('paymentsEmptyState');
    const paymentsErrorState = document.getElementById('paymentsErrorState');
    const refreshPaymentsBtn = document.getElementById('refreshPaymentsBtn');

    function showPaymentsView() {
        // Hide other views
        if (dashboardContent) dashboardContent.classList.add('hidden');
        if (ordersView) ordersView.classList.add('hidden');
        
        // Show payments view
        if (paymentsView) paymentsView.classList.remove('hidden');

        setActiveSidebarLink(paymentsLink);
    }

    async function loadPayments() {
        if (!paymentsTableBody || !paymentsLoadingState || !paymentsEmptyState || !paymentsErrorState) {
            console.error('Payments view elements not found');
            return;
        }

        // Show loading state
        paymentsLoadingState.classList.remove('hidden');
        paymentsEmptyState.classList.add('hidden');
        paymentsErrorState.classList.add('hidden');

        try {
            const response = await fetch('/.netlify/functions/payments', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'history'
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();

            // Hide loading state
            paymentsLoadingState.classList.add('hidden');

            if (result.payments && result.payments.length > 0) {
                displayPayments(result.payments);
            } else {
                paymentsEmptyState.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Failed to load payments:', error);
            
            // Hide loading state and show error
            paymentsLoadingState.classList.add('hidden');
            paymentsErrorState.classList.remove('hidden');
            paymentsErrorState.innerHTML = `
                <h3>Failed to load payments</h3>
                <p>Please try again later or contact support if the problem persists.</p>
                <button class="btn-secondary" onclick="location.reload()">Retry</button>
            `;
        }
    }

    function displayPayments(payments) {
        if (!paymentsTableBody) return;

        paymentsTableBody.innerHTML = payments.map(payment => {
            const date = new Date(payment.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            const amount = formatCurrencyDisplay(payment.amount);
            const method = escapeHtml(payment.payment_method || 'Unknown');
            const status = payment.status || 'pending';
            const statusClass = status.toLowerCase();

            return `
                <tr>
                    <td>#${escapeHtml(payment.id)}</td>
                    <td>${date}</td>
                    <td><span class="payment-method">${method}</span></td>
                    <td class="payment-amount">+${amount}</td>
                    <td><span class="payment-status ${statusClass}">${escapeHtml(status)}</span></td>
                </tr>
            `;
        }).join('');
    }

    // Payments navigation
    if (paymentsLink) {
        paymentsLink.addEventListener('click', (e) => {
            e.preventDefault();
            showPaymentsView();
            loadPayments();
        });
    }

    // Refresh payments button
    if (refreshPaymentsBtn) {
        refreshPaymentsBtn.addEventListener('click', () => {
            loadPayments();
        });
    }

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
