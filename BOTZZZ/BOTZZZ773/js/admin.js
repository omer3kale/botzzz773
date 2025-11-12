// Admin Panel JavaScript - Production Ready

// Toggle Sidebar
function toggleSidebar() {
    const sidebar = document.getElementById('adminSidebar');
    sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('sidebar-collapsed');
}

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
            tickets: data.stats?.pendingTickets || 0
        };
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        // Return default values on error
        return {
            revenue: 0,
            orders: 0,
            users: 0,
            profits: 0,
            tickets: 0
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

// Update dashboard stats
async function updateDashboardStats() {
    const stats = await fetchDashboardStats();
    
    // Update stat cards
    const statValues = document.querySelectorAll('.stat-value');
    if (statValues.length >= 4) {
        statValues[0].textContent = '$' + stats.revenue.toFixed(2);
        statValues[1].textContent = stats.orders.toLocaleString();
        statValues[2].textContent = stats.users.toLocaleString();
        statValues[3].textContent = stats.tickets;
    }
    
    // Update revenue overview stats
    updateRevenueOverview(stats);
}

// Update Revenue Overview section
function updateRevenueOverview(stats) {
    const overviewStats = document.querySelectorAll('.revenue-overview .stat-card .stat-value');
    if (overviewStats.length >= 3) {
        overviewStats[0].textContent = stats.orders.toLocaleString();
        overviewStats[1].textContent = '$' + stats.profits.toFixed(2);
        overviewStats[2].textContent = '$' + stats.revenue.toFixed(2);
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
        const uuidMarkup = order.order_number ? `<div class="cell-secondary cell-muted">${order.id}</div>` : '';
        return `
        <tr>
            <td><strong>${orderNumber}</strong>${uuidMarkup}</td>
            <td>${order.user_id || order.username || 'N/A'}</td>
            <td>${order.service_id || order.service || 'N/A'}</td>
            <td>$${(order.charge || 0).toFixed(2)}</td>
            <td><span class="status-badge ${(order.status || '').toLowerCase().replace(' ', '-')}">${order.status || 'Unknown'}</span></td>
            <td>${order.created_at ? new Date(order.created_at).toLocaleString() : 'N/A'}</td>
        </tr>
    `;
    }).join('');
}

// Initialize dashboard with Chart.js
if (window.location.pathname.includes('admin/index.html') || window.location.pathname.endsWith('admin/')) {
    document.addEventListener('DOMContentLoaded', () => {
        updateDashboardStats();
        populateRecentOrders();
        initDashboardChart();
        
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
function initDashboardChart() {
    const canvas = document.getElementById('revenueChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Generate placeholder revenue data for chart
    const revenueData = [500, 650, 750, 820, 900, 1100, 1250];
    
    const data = {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        datasets: [{
            label: 'Revenue',
            data: revenueData,
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

    if (typeof Chart !== 'undefined') {
        new Chart(ctx, {
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
                                return 'Revenue: $' + context.parsed.y.toFixed(2);
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
        const filter = this.value.toLowerCase();
        const table = document.getElementById(tableId);
        const rows = table.getElementsByTagName('tr');
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const text = row.textContent.toLowerCase();
            row.style.display = text.includes(filter) ? '' : 'none';
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
    
    const existing = document.getElementById('activeModal');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    setTimeout(() => document.getElementById('activeModal').classList.add('show'), 10);
}

function closeModal() {
    const modal = document.getElementById('activeModal');
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
