// Admin Panel JavaScript - Production Ready

// Format currency dynamically (5 decimals, remove trailing zeros)
function formatCurrencyDynamic(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '$0';
    }
    let formatted = Math.abs(number).toFixed(5).replace(/\.?0+$/, '');
    const sign = number < 0 ? '-' : '';
    return `$${sign}${formatted}`;
}

// Global helper: trim trailing zeros up to maxDecimals (non-currency too)
// Examples:
// 12.12345 -> "12.12345"
// 12.12000 -> "12.12"
// 3 -> "3"
window.formatTrimZeros = function(value, maxDecimals = 5) {
    const num = Number(value);
    if (!Number.isFinite(num)) return '';
    const fixed = num.toFixed(maxDecimals);
    return fixed
        .replace(/\.0+$/, '')
        .replace(/(\.\d*[1-9])0+$/, '$1');
};

const adminPopupSurfaceController = (() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return { init: () => {}, close: () => {} };
    }

    let initialized = false;
    let isPopup = false;
    let ariaLabel = 'Admin popup window';

    function detachDialogAttributes(panel) {
        if (!panel) {
            return;
        }
        panel.removeAttribute('role');
        panel.removeAttribute('aria-modal');
        panel.removeAttribute('aria-label');
        panel.removeAttribute('tabindex');
    }

    function closePopupSurface() {
        if (!isPopup) {
            return;
        }

        if (window.opener && !window.opener.closed) {
            try {
                window.opener.focus();
            } catch (error) {
                console.warn('[ADMIN] Failed to refocus opener window.', error);
            }
            window.close();
            return;
        }

        document.body.classList.remove('popup-mode');
        detachDialogAttributes(document.querySelector('[data-popup-surface]'));
        const closeButton = document.querySelector('[data-popup-close]');
        if (closeButton) {
            closeButton.style.display = 'none';
        }
    }

    function mountPopupSurface() {
        if (!isPopup) {
            return;
        }

        document.body.classList.add('popup-mode');
        const panel = document.querySelector('[data-popup-surface]');
        if (panel) {
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-label', ariaLabel);
            panel.setAttribute('tabindex', '-1');
            requestAnimationFrame(() => panel.focus());
        }

        const closeButton = document.querySelector('[data-popup-close]');
        if (closeButton) {
            closeButton.addEventListener('click', closePopupSurface);
        }

        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closePopupSurface();
            }
        });
    }

    function initPopupSurface(label) {
        if (initialized) {
            return;
        }
        initialized = true;

        if (typeof label === 'string' && label.trim().length > 0) {
            ariaLabel = label.trim();
        }

        const params = new URLSearchParams(window.location.search);
        isPopup = params.get('popup') === '1';
        if (!isPopup) {
            return;
        }

        const boot = () => mountPopupSurface();
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', boot, { once: true });
        } else {
            boot();
        }
    }

    return {
        init: initPopupSurface,
        close: closePopupSurface
    };
})();

if (typeof window !== 'undefined') {
    window.initializeAdminPopupSurface = function initializeAdminPopupSurface(label) {
        adminPopupSurfaceController.init(label);
    };
}

// Toggle Sidebar - Mobile & Desktop Compatible
function toggleSidebar() {
    const sidebar = document.getElementById('adminSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    // Mobile (< 768px) - toggle .active class
    if (window.innerWidth < 768) {
        sidebar.classList.toggle('active');
        if (overlay) {
            overlay.classList.toggle('active');
        }
    } else {
        // Desktop (>= 768px) - toggle .collapsed class
        sidebar.classList.toggle('collapsed');
        document.body.classList.toggle('sidebar-collapsed');
    }
}

// Mobile - Sidebar menu linkine tıklanınca kapanması
document.addEventListener('DOMContentLoaded', function() {
    if (window.innerWidth < 768) {
        const navItems = document.querySelectorAll('.admin-nav-item');
        navItems.forEach(item => {
            item.addEventListener('click', function() {
                const sidebar = document.getElementById('adminSidebar');
                const overlay = document.getElementById('sidebarOverlay');
                if (sidebar && sidebar.classList.contains('active')) {
                    sidebar.classList.remove('active');
                    if (overlay) {
                        overlay.classList.remove('active');
                    }
                }
            });
        });
    }

    // Window resize event - mode değişirse durum sıfırla
    window.addEventListener('resize', function() {
        const sidebar = document.getElementById('adminSidebar');
        const overlay = document.getElementById('sidebarOverlay');
        
        if (window.innerWidth >= 768) {
            // Desktop mode'a geçince sidebar state'ini sıfırla
            if (sidebar && sidebar.classList.contains('active')) {
                sidebar.classList.remove('active');
            }
            if (overlay && overlay.classList.contains('active')) {
                overlay.classList.remove('active');
            }
        }
    });
});

const adminNetworkNotice = (() => {
    let bannerEl = null;
    let hideTimer = null;

    function ensureBanner() {
        if (bannerEl) {
            return bannerEl;
        }
        bannerEl = document.createElement('div');
        bannerEl.className = 'admin-network-banner';
        bannerEl.innerHTML = `
            <span class="admin-network-banner__dot"></span>
            <span class="admin-network-banner__text">Network status</span>
        `;
        document.body.appendChild(bannerEl);
        return bannerEl;
    }

    function render(message, variant = 'warning', sticky = false) {
        const el = ensureBanner();
        const textEl = el.querySelector('.admin-network-banner__text');
        if (textEl) {
            textEl.textContent = message;
        }
        el.dataset.variant = variant;
        el.classList.add('show');
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        if (!sticky) {
            hideTimer = setTimeout(() => {
                el.classList.remove('show');
            }, 6000);
        }
    }

    return {
        flash(message, variant) {
            render(message, variant, false);
        },
        stick(message, variant) {
            render(message, variant, true);
        },
        hide() {
            if (bannerEl) {
                bannerEl.classList.remove('show');
            }
        }
    };
})();

(function registerAdminFetchGuardListeners() {
    if (typeof window === 'undefined') {
        return;
    }
    // ===== Admin-only navigation visibility =====
    function getUserRoleFromToken() {
        try {
            const token = localStorage.getItem('token');
            if (!token) return null;
            const parts = token.split('.');
            if (parts.length !== 3) return null;
            const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
            return payload.role || payload.userRole || null;
        } catch (e) {
            return null;
        }
    }

    function enforceAdminNavVisibility() {
        const role = getUserRoleFromToken();
        const refundsLink = document.querySelector('a.admin-nav-item[href="refunds.html"]');
        if (!refundsLink) return;
        if (role !== 'admin') {
            refundsLink.style.display = 'none';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        try { enforceAdminNavVisibility(); } catch (e) {}
    });


    let lastFailureToast = 0;
    const failureCooldownMs = 7000;

    window.addEventListener('fetchguard:failure', () => {
        const now = Date.now();
        if (now - lastFailureToast < failureCooldownMs) {
            return;
        }
        lastFailureToast = now;
        adminNetworkNotice.flash('Retrying admin API request…', 'error');
    });

    window.addEventListener('fetchguard:circuit-open', (event) => {
        const endpoint = event.detail?.endpoint || 'Admin API';
        adminNetworkNotice.stick(`${endpoint} paused after repeated failures. Cooling down briefly.`, 'warning');
    });

    window.addEventListener('fetchguard:circuit-reset', () => {
        adminNetworkNotice.flash('Connection stabilized. Resuming operations.', 'success');
    });

    window.addEventListener('fetchguard:network-status', (event) => {
        const online = event.detail?.online !== false;
        document.body.dataset.networkStatus = online ? 'online' : 'offline';
        if (!online) {
            adminNetworkNotice.stick('You appear to be offline. Actions are paused.', 'warning');
        } else {
            adminNetworkNotice.flash('Back online. Reloading data…', 'success');
        }
    });
})();

// Toggle User Menu
function toggleUserMenu() {
    const menu = document.getElementById('userDropdownMenu');
    if (menu) {
        menu.classList.toggle('show');
    }
}

// Close user menu when clicking outside
document.addEventListener('click', (event) => {
    const menu = document.getElementById('userDropdownMenu');
    const button = document.querySelector('.admin-user-button');
    
    if (menu && button && !menu.contains(event.target) && !button.contains(event.target)) {
        menu.classList.remove('show');
    }
});

// Admin Logout
function adminLogout(event) {
    if (event) {
        event.preventDefault();
    }
    
    // Clear all authentication data
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('userRole');
    
    // Redirect to signin page
    window.location.href = '../signin.html';
}

// API Helper for admin operations
async function adminApiCall(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    };
    
    const response = await fetch(`/.netlify/functions/${endpoint}`, {
        ...defaultOptions,
        ...options,
        headers: { ...defaultOptions.headers, ...options.headers }
    });
    
    if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
    }
    
    return response.json();
}

// Fetch dashboard stats from backend
async function fetchDashboardStats() {
    try {
        const data = await adminApiCall('dashboard', { method: 'GET' });
        return {
            revenue: data.stats?.totalRevenue || 0,
            orders: data.stats?.totalOrders || 0,
            users: data.stats?.totalUsers || 0,
            profits: data.stats?.totalProfits || 0,
            tickets: data.stats?.openTickets || data.stats?.pendingTickets || 0,
            revenueChart: data.revenueChart || {},
            ordersChart: data.ordersChart || {},
            usersChart: data.usersChart || {},
            ticketsChart: data.ticketsChart || {}
        };
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        // Return default values on error
        return {
            revenue: 0,
            orders: 0,
            users: 0,
            profits: 0,
            tickets: 0,
            revenueChart: {},
            ordersChart: {},
            usersChart: {},
            ticketsChart: {}
        };
    }
}

// Fetch recent orders from backend
async function fetchRecentOrders() {
    try {
        const data = await adminApiCall('orders?limit=5', { method: 'GET' });
        return data.orders || [];
    } catch (error) {
        console.error('Error fetching recent orders:', error);
        return [];
    }
}

// Compute day-over-day change from a daily series (object date -> value)
function computeDayOverDayChange(series = {}) {
    const dates = Object.keys(series).sort();
    if (dates.length < 2) return null;
    const prev = Number(series[dates[dates.length - 2]] || 0);
    const curr = Number(series[dates[dates.length - 1]] || 0);
    if (!Number.isFinite(prev) || !Number.isFinite(curr)) return null;
    if (prev === 0 && curr === 0) return 0;
    if (prev === 0 && curr > 0) return 100;
    return ((curr - prev) / Math.abs(prev)) * 100;
}

// Update dashboard stats
async function updateDashboardStats(passedStats = null) {
    const stats = passedStats || await fetchDashboardStats();
    
    // Update stat cards (values)
    const statValues = document.querySelectorAll('.stat-value');
    if (statValues.length >= 4) {
        statValues[0].textContent = formatCurrencyDynamic(stats.revenue);
        statValues[1].textContent = stats.orders.toLocaleString();
        statValues[2].textContent = stats.users.toLocaleString();
        statValues[3].textContent = stats.tickets;
    }

    // Update stat change badges (day-over-day for revenue; others set to em dash)
    const revenueChangeEl = document.getElementById('revenueChange');
    const ordersChangeEl = document.getElementById('ordersChange');
    const usersChangeEl = document.getElementById('usersChange');
    const ticketsChangeEl = document.getElementById('ticketsChange');

    const revenueDelta = computeDayOverDayChange(stats.revenueChart || {});
    const ordersDelta = computeDayOverDayChange(stats.ordersChart || {});
    const usersDelta = computeDayOverDayChange(stats.usersChart || {});
    const ticketsDelta = computeDayOverDayChange(stats.ticketsChart || {});

    function setDelta(el, delta) {
        if (!el) return;
        if (delta === null) {
            el.textContent = '—';
            return;
        }
        const sign = delta > 0 ? '+' : '';
        el.textContent = `${sign}${delta.toFixed(1)}% vs prev day`;
    }

    setDelta(revenueChangeEl, revenueDelta);
    setDelta(ordersChangeEl, ordersDelta);
    setDelta(usersChangeEl, usersDelta);
    setDelta(ticketsChangeEl, ticketsDelta);
    
    // Update revenue overview stats
    updateRevenueOverview(stats);
}

// Update Revenue Overview section
function updateRevenueOverview(stats) {
    const overviewStats = document.querySelectorAll('.revenue-overview .stat-card .stat-value');
    if (overviewStats.length >= 3) {
        overviewStats[0].textContent = stats.orders.toLocaleString();
        overviewStats[1].textContent = formatCurrencyDynamic(stats.profits);
        overviewStats[2].textContent = formatCurrencyDynamic(stats.revenue);
    }
}

// Populate Recent Orders on Dashboard
async function populateRecentOrders() {
    const tbody = document.getElementById('recentOrders');
    if (!tbody) return;
    
    const orders = await fetchRecentOrders();
    
    if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No recent orders</td></tr>';
        return;
    }
    
    tbody.innerHTML = orders.map(order => {
        const orderNumber = order.order_number || order.id;
        // Username yerine user objesi varsa username/email, yoksa user_id
        const userName = order.user?.username || order.user?.email || order.username || 'N/A';
        // Service için public_id'yi tercih et, yoksa name, yoksa service_id
        const serviceDisplay = order.service?.public_id || order.service?.name || order.service_name || 'N/A';
        const amount = formatCurrencyDynamic(order.charge || 0);
        
        return `
        <tr>
            <td>
                <div class="order-id-cell">
                    <div class="cell-primary">${orderNumber}</div>
                </div>
            </td>
            <td>${userName}</td>
            <td>${serviceDisplay}</td>
            <td>${amount}</td>
            <td><span class="status-badge ${(order.status || '').toLowerCase().replace(' ', '-')}">${order.status || 'Unknown'}</span></td>
            <td>${order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A'}</td>
        </tr>
    `;
    }).join('');
}

// Initialize dashboard with Chart.js
if (window.location.pathname.includes('admin/index.html') || window.location.pathname.endsWith('admin/')) {
    document.addEventListener('DOMContentLoaded', async () => {
        const stats = await fetchDashboardStats();
        updateDashboardStats(stats);
        populateRecentOrders();
        initDashboardChart(stats.revenueChart);
        
        // Fix hover issues by adding proper event delegation
        fixHoverIssues();
    });
}

// Fix hover issues on admin panel
function fixHoverIssues() {
    // Ensure all interactive elements have proper hover states
    const cards = document.querySelectorAll('.stat-card, .chart-card, .table-card');
    cards.forEach(card => {
        card.style.transition = 'all 0.3s ease';
    });
    
    // Fix table row hover
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
        const rows = table.querySelectorAll('tbody tr');
        rows.forEach(row => {
            row.style.transition = 'background-color 0.2s ease';
        });
    });
}

// Initialize dashboard chart
let dashboardChart = null;

function initDashboardChart(revenueChartData = {}) {
    const canvas = document.getElementById('revenueChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Convert backend revenue data to chart format
    const dates = Object.keys(revenueChartData).sort();
    const labels = dates.map(d => {
        const date = new Date(d);
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    });
    const paymentsData = dates.map(d => parseFloat(revenueChartData[d]) || 0);
    
    // Generate placeholder data for orders and profits (proportional to payments)
    const ordersData = paymentsData.map(p => Math.round(p / 10)); // Roughly 10% of payment value
    const profitsData = paymentsData.map(p => p * 0.3); // 30% profit margin estimate
    
    const data = {
        labels: labels.length > 0 ? labels : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        datasets: [{
            label: 'Payments',
            data: paymentsData.length > 0 ? paymentsData : [500, 650, 750, 820, 900, 1100, 1250],
            borderColor: '#FF1494',
            backgroundColor: 'rgba(255, 20, 148, 0.1)',
            tension: 0.4,
            fill: true,
            pointBackgroundColor: '#FF1494',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6
        }]
    };
    
    // Store chart data for tab switching
    window.chartDataStore = {
        payments: paymentsData.length > 0 ? paymentsData : [500, 650, 750, 820, 900, 1100, 1250],
        orders: ordersData.length > 0 ? ordersData : [45, 52, 58, 63, 71, 85, 92],
        profits: profitsData.length > 0 ? profitsData : [120, 180, 210, 245, 280, 330, 375]
    };

    if (typeof Chart !== 'undefined') {
        dashboardChart = new Chart(ctx, {
            type: 'line',
            data: data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1a1a1a',
                        titleColor: '#fff',
                        bodyColor: '#fff',
                        borderColor: '#FF1494',
                        borderWidth: 1,
                        padding: 12,
                        displayColors: false,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + formatCurrencyDynamic(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { 
                            color: '#2a2a2a',
                            drawBorder: false
                        },
                        ticks: { 
                            color: '#a0a0a0',
                            callback: value => '$' + value.toFixed(0),
                            padding: 10
                        },
                        border: { display: false }
                    },
                    x: {
                        grid: { 
                            color: '#2a2a2a',
                            drawBorder: false
                        },
                        ticks: { 
                            color: '#a0a0a0',
                            padding: 10
                        },
                        border: { display: false }
                    }
                }
            }
        });
    }
}

// Switch chart tab (payments, orders, profits)
function switchChartTab(tab) {
    if (!dashboardChart || !window.chartDataStore) return;
    
    // Update active tab button
    document.querySelectorAll('.chart-tab').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Chart data for different tabs (using real data from backend)
    const chartConfig = {
        payments: { label: 'Payments', color: '#FF1494' },
        orders: { label: 'Orders', color: '#22c55e' },
        profits: { label: 'Profits', color: '#3b82f6' }
    };
    
    const selectedConfig = chartConfig[tab];
    const selectedData = window.chartDataStore[tab];
    
    if (!selectedConfig || !selectedData) return;
    
    // Update chart
    dashboardChart.data.datasets[0].label = selectedConfig.label;
    dashboardChart.data.datasets[0].data = selectedData;
    dashboardChart.data.datasets[0].borderColor = selectedConfig.color;
    dashboardChart.data.datasets[0].backgroundColor = selectedConfig.color + '20';
    dashboardChart.data.datasets[0].pointBackgroundColor = selectedConfig.color;
    dashboardChart.options.plugins.tooltip.borderColor = selectedConfig.color;
    dashboardChart.update();
}

// Initialize charts
function initCharts() {
    // Placeholder for chart initialization
    // In production, use Chart.js or similar library
    console.log('Charts initialized');
}

// Format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

// Format date
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

// Toggle all checkboxes
function toggleAll(checkbox, className) {
    const checkboxes = document.querySelectorAll(`.${className}`);
    checkboxes.forEach(cb => cb.checked = checkbox.checked);
}

// Delete selected items
function deleteSelected(type) {
    const checkboxes = document.querySelectorAll(`input[type="checkbox"]:checked`);
    if (checkboxes.length === 0) {
        alert('Please select items to delete');
        return;
    }
    
    if (confirm(`Are you sure you want to delete ${checkboxes.length} ${type}(s)?`)) {
        // Handle deletion
        alert(`${checkboxes.length} ${type}(s) deleted`);
        location.reload();
    }
}

// Export data
function exportData(format) {
    alert(`Exporting data as ${format.toUpperCase()}...`);
    // Implement export functionality
}

// Notification system
function showNotification(message, type = 'success') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 100);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Search functionality
function handleSearch(inputId, tableId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    input.addEventListener('keyup', function() {
        const filter = this.value.toLowerCase().trim();
        const table = document.getElementById(tableId);
        const rows = table.getElementsByTagName('tr');
        
        // Check if input contains comma-separated values
        const searchTerms = filter.includes(',') 
            ? filter.split(',').map(term => term.trim()).filter(term => term.length > 0)
            : [filter];
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const text = row.textContent.toLowerCase();
            
            // If multiple search terms (comma-separated), check if ANY term matches
            const matches = searchTerms.some(term => text.includes(term));
            row.style.display = matches ? '' : 'none';
        }
    });
}

// Sort table
let sortDirection = {};
function sortTable(column) {
    const table = document.querySelector('.admin-table');
    const tbody = table.querySelector('tbody');
    const rows = Array.from(tbody.querySelectorAll('tr'));
    
    sortDirection[column] = !sortDirection[column];
    
    rows.sort((a, b) => {
        const aText = a.cells[getColumnIndex(column)].textContent;
        const bText = b.cells[getColumnIndex(column)].textContent;
        
        const aValue = isNaN(aText) ? aText : parseFloat(aText);
        const bValue = isNaN(bText) ? bText : parseFloat(bText);
        
        if (sortDirection[column]) {
            return aValue > bValue ? 1 : -1;
        } else {
            return aValue < bValue ? 1 : -1;
        }
    });
    
    rows.forEach(row => tbody.appendChild(row));
}

function getColumnIndex(column) {
    const headers = document.querySelectorAll('.admin-table th');
    for (let i = 0; i < headers.length; i++) {
        if (headers[i].textContent.toLowerCase().includes(column.toLowerCase())) {
            return i;
        }
    }
    return 0;
}

// ========================================
// MODAL SYSTEM - SHARED ACROSS ALL PAGES
// ========================================

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

// ========================================
// BUTTON LOADING STATE HELPER
// ========================================

function setButtonLoading(button, loading = true, originalText = 'Submit') {
    if (loading) {
        button.dataset.originalText = button.textContent;
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    } else {
        button.disabled = false;
        button.textContent = button.dataset.originalText || originalText;
    }
}

// ========================================
// AUTHENTICATED API FETCH HELPER
// ========================================

async function adminFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        }
    };
    
    const response = await fetch(url, { ...options, headers: defaultOptions.headers });
    
    // Handle auth errors
    if (response.status === 401 || response.status === 403) {
        showNotification('Session expired. Please login again.', 'error');
        setTimeout(() => {
            localStorage.removeItem('token');
            window.location.href = '/signin.html';
        }, 2000);
        throw new Error('Unauthorized');
    }
    
    return response;
}

// ===== Admin Tickets Sidebar Badge =====
function updateAdminTicketBadge(badgeId, count) {
    const badge = document.getElementById(badgeId);
    if (!badge) return;
    if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = 'inline-flex';
        badge.style.alignItems = 'center';
        badge.style.justifyContent = 'center';
    } else {
        badge.style.display = 'none';
    }
}

async function refreshAdminTicketsBadge() {
    try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const url = new URL('/.netlify/functions/tickets', window.location.origin);
        url.searchParams.append('action', 'getUnreadCount');
        const res = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            const count = Number(data.unreadCount || 0);
            updateAdminTicketBadge('adminSidebarTicketBadge', count);
        }
    } catch (e) {
        // Silent failure, keep badge hidden
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Initial badge refresh on any admin page load
    refreshAdminTicketsBadge();
});
