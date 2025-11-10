// Admin Orders Management with Real Modals

let servicesCache = [];

// Modal Helper Functions (shared with admin-users.js pattern)
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

// Filter orders by status
function filterOrders(status) {
    const rows = document.querySelectorAll('#ordersTableBody tr');
    const tabs = document.querySelectorAll('.filter-tab');
    
    tabs.forEach(tab => tab.classList.remove('active'));
    document.querySelector(`[data-status="${status}"]`)?.classList.add('active');
    
    if (status === 'all') {
        rows.forEach(row => row.style.display = '');
    } else {
        rows.forEach(row => {
            if (row.dataset.status === status) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }
}

// View order details
function viewOrder(orderId) {
    const content = `
        <div class="user-details">
            <div class="user-detail-section">
                <h4><i class="fas fa-info-circle"></i> Order Details</h4>
                <div class="detail-row">
                    <span class="detail-label">Order ID:</span>
                    <span class="detail-value">#${orderId}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label" style="color: #888;">Loading order details...</span>
                </div>
            </div>
            <div class="user-detail-section" style="text-align: center; padding: 40px 20px; color: #888;">
                <i class="fas fa-spinner fa-spin" style="font-size: 32px; color: #FF1494; margin-bottom: 16px;"></i>
                <p>Fetching order information from database...</p>
            </div>
            <div class="user-detail-section" style="display: none;">
                <h4><i class="fas fa-clock"></i> Timeline</h4>
                <div class="detail-row">
                    <span class="detail-label">Created:</span>
                    <span class="detail-value">-</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Started:</span>
                    <span class="detail-value">-</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Mode:</span>
                    <span class="detail-value">-</span>
                </div>
            </div>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="editOrder(${orderId})">
            <i class="fas fa-edit"></i> Edit
        </button>
        <button type="button" class="btn-primary" onclick="closeModal()">Close</button>
    `;
    
    createModal(`Order #${orderId} Details`, content, actions);
}

// Edit order
async function editOrder(orderId) {
    const servicesOptions = await getServicesOptions();
    
    const content = `
        <form id="editOrderForm" onsubmit="submitEditOrder(event, ${orderId})" class="admin-form">
            <div class="form-group">
                <label>Service</label>
                <select name="service" required>
                    ${servicesOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Link</label>
                <input type="url" name="link" value="https://www.instagram.com/username/" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <span class="detail-label">Quantity:</span>
                    <input type="number" name="quantity" value="1000" min="1" required>
                </div>
                <div class="form-group">
                    <label>Charge</label>
                    <input type="number" name="charge" value="12.50" min="0" step="0.01" required>
                </div>
            </div>
            <div class="form-group">
                <label>Status</label>
                <select name="status">
                    <option value="Pending">Pending</option>
                    <option value="In progress" selected>In progress</option>
                    <option value="Completed">Completed</option>
                    <option value="Partial">Partial</option>
                    <option value="Canceled">Canceled</option>
                </select>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="editOrderForm" class="btn-primary">
            <i class="fas fa-save"></i> Save Changes
        </button>
    `;
    
    createModal(`Edit Order #${orderId}`, content, actions);
}

function submitEditOrder(event, orderId) {
    event.preventDefault();
    showNotification(`Order #${orderId} updated successfully!`, 'success');
    closeModal();
}

// Refill order
function refillOrder(orderId) {
    const content = `
        <div class="confirmation-message">
            <i class="fas fa-redo-alt" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>Refill order #${orderId}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will add the order back to the queue for processing. The remaining quantity will be fulfilled.
            </p>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="confirmRefillOrder(${orderId})">
            <i class="fas fa-redo-alt"></i> Refill Order
        </button>
    `;
    
    createModal('Refill Order', content, actions);
}

function confirmRefillOrder(orderId) {
    showNotification(`Order #${orderId} refill requested successfully`, 'success');
    closeModal();
}

// Cancel order
function cancelOrder(orderId) {
    const content = `
        <div class="confirmation-message danger">
            <i class="fas fa-times-circle" style="font-size: 48px; color: #ef4444; margin-bottom: 20px;"></i>
            <p>Cancel order #${orderId}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will stop the order processing and mark it as canceled. This action cannot be undone.
            </p>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Keep Order</button>
        <button type="button" class="btn-danger" onclick="confirmCancelOrder(${orderId})">
            <i class="fas fa-times"></i> Cancel Order
        </button>
    `;
    
    createModal('Cancel Order', content, actions);
}

function confirmCancelOrder(orderId) {
    showNotification(`Order #${orderId} has been canceled`, 'success');
    closeModal();
}

// Add Order Modal
async function showAddOrderModal() {
    const servicesOptions = await getServicesOptions();
    
    const content = `
        <form id="addOrderForm" onsubmit="submitAddOrder(event)" class="admin-form">
            <div class="form-group">
                <label>User *</label>
                <select name="user" required>
                    <option value="">Select User</option>
                    <option value="11009">sherry5286</option>
                    <option value="11008">azenarky</option>
                    <option value="11007">ami7456727779</option>
                    <option value="11006">yamh48378</option>
                    <option value="11005">jj1302524</option>
                </select>
            </div>
            <div class="form-group">
                <label>Service *</label>
                <select name="service" required>
                    ${servicesOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Link/Username *</label>
                <input type="text" name="link" placeholder="https://instagram.com/username or @username" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Quantity *</label>
                    <input type="number" name="quantity" placeholder="1000" min="1" required>
                </div>
                <div class="form-group">
                    <label>Charge (USD)</label>
                    <input type="number" name="charge" placeholder="12.50" min="0" step="0.01">
                </div>
            </div>
            <div class="form-group">
                <label>Mode</label>
                <select name="mode">
                    <option value="Auto" selected>Auto</option>
                    <option value="Manual">Manual</option>
                </select>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="addOrderForm" class="btn-primary">
            <i class="fas fa-plus"></i> Create Order
        </button>
    `;
    
    createModal('Add New Order', content, actions);
}

function submitAddOrder(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const orderData = Object.fromEntries(formData);
    
    console.log('Creating order:', orderData);
    showNotification('Order created successfully!', 'success');
    closeModal();
}

// Export Orders
function exportData(format) {
    const content = `
        <div class="confirmation-message">
            <i class="fas fa-file-${format === 'csv' ? 'csv' : 'pdf'}" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>Export orders to ${format.toUpperCase()}?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will download all visible orders in ${format.toUpperCase()} format. Current filters will be applied.
            </p>
            <div style="background: rgba(255,20,148,0.1); border: 1px solid rgba(255,20,148,0.3); border-radius: 8px; padding: 12px; margin-top: 16px;">
                <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                    <span style="color: #888;">Total Orders:</span>
                    <span style="color: #fff; font-weight: 600;">5</span>
                </div>
                <div style="display: flex; justify-content: space-between; padding: 4px 0;">
                    <span style="color: #888;">Date Range:</span>
                    <span style="color: #fff;">All Time</span>
                </div>
            </div>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="confirmExport('${format}')">
            <i class="fas fa-download"></i> Export ${format.toUpperCase()}
        </button>
    `;
    
    createModal(`Export Orders`, content, actions);
}

function confirmExport(format) {
    showNotification(`Exporting orders to ${format.toUpperCase()}...`, 'success');
    closeModal();
    
    // Simulate download
    setTimeout(() => {
        showNotification(`Orders exported successfully!`, 'success');
    }, 1500);
}

// Initialize search
document.addEventListener('DOMContentLoaded', () => {
    if (typeof handleSearch === 'function') {
        handleSearch('orderSearch', 'ordersTable');
    }
    
    // Add filter change listeners
    const filters = ['dateFilter', 'serviceFilter', 'providerFilter', 'modeFilter'];
    filters.forEach(filterId => {
        const filter = document.getElementById(filterId);
        if (filter) {
            filter.addEventListener('change', applyFilters);
        }
    });
});

// Apply all filters
function applyFilters() {
    const dateFilter = document.getElementById('dateFilter')?.value;
    const serviceFilter = document.getElementById('serviceFilter')?.value;
    const providerFilter = document.getElementById('providerFilter')?.value;
    const modeFilter = document.getElementById('modeFilter')?.value;
    
    // In production, this would make an API call with filter parameters
    console.log('Applying filters:', {
        date: dateFilter,
        service: serviceFilter,
        provider: providerFilter,
        mode: modeFilter
    });
}

// Load real orders from database
document.addEventListener('DOMContentLoaded', async () => {
    await loadOrders();
});

async function loadOrders() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px;"><i class="fas fa-spinner fa-spin"></i> Loading orders...</td></tr>';

    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/orders', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        
        if (data.orders && data.orders.length > 0) {
            tbody.innerHTML = '';
            
            data.orders.forEach(order => {
                const createdDate = new Date(order.created_at).toLocaleString();
                const statusClass = order.status.toLowerCase().replace(' ', '-');
                
                const row = `
                    <tr data-status="${statusClass}">
                        <td><input type="checkbox" class="order-checkbox"></td>
                        <td>${order.id}</td>
                        <td>${order.users?.username || 'Unknown'}</td>
                        <td>$${parseFloat(order.charge || 0).toFixed(2)}</td>
                        <td><a href="${order.link}" class="link-preview" target="_blank">${order.link.substring(0, 40)}...</a></td>
                        <td>${order.start_count || 0}</td>
                        <td>${order.quantity || 0}</td>
                        <td>${order.services?.name || 'Unknown Service'}</td>
                        <td><span class="status-badge ${statusClass}">${order.status}</span></td>
                        <td>${order.remains || 0}</td>
                        <td>${createdDate}</td>
                        <td>${order.mode || 'Auto'}</td>
                        <td>
                            <div class="actions-dropdown">
                                <button class="btn-icon"><i class="fas fa-ellipsis-v"></i></button>
                                <div class="dropdown-menu">
                                    <a href="#" onclick="viewOrder('${order.id}')">View</a>
                                    ${order.status !== 'completed' && order.status !== 'canceled' ? `<a href="#" onclick="editOrder('${order.id}')">Edit</a>` : ''}
                                    ${order.status === 'completed' ? `<a href="#" onclick="refillOrder('${order.id}')">Refill</a>` : ''}
                                    ${order.status !== 'completed' && order.status !== 'canceled' ? `<a href="#" onclick="cancelOrder('${order.id}')">Cancel</a>` : ''}
                                </div>
                            </div>
                        </td>
                    </tr>
                `;
                tbody.insertAdjacentHTML('beforeend', row);
            });
            
            // Update pagination
            const paginationInfo = document.getElementById('paginationInfo');
            if (paginationInfo) {
                paginationInfo.textContent = `Showing 1-${Math.min(data.orders.length, 50)} of ${data.orders.length}`;
            }
        } else {
             tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px; color: #888;">No orders found</td></tr>';
         }
    } catch (error) {
        console.error('Load orders error:', error);
        tbody.innerHTML = '<tr><td colspan="13" style="text-align: center; padding: 20px; color: #ef4444;">Failed to load orders. Please refresh the page.</td></tr>';
    }
}

// Helper function to get services options
async function getServicesOptions() {
    if (servicesCache.length > 0) {
        return buildServicesOptionsHTML(servicesCache);
    }
    
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/services', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        servicesCache = data.services || [];
        return buildServicesOptionsHTML(servicesCache);
    } catch (error) {
        console.error('Failed to load services:', error);
        return '<option value="">Failed to load services</option>';
    }
}

function buildServicesOptionsHTML(services) {
    if (services.length === 0) {
        return '<option value="">No services available</option>';
    }
    
    // Group by category
    const grouped = {};
    services.forEach(service => {
        const category = (service.category || 'Other').toLowerCase();
        const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
        if (!grouped[categoryName]) {
            grouped[categoryName] = [];
        }
        grouped[categoryName].push(service);
    });
    
    let html = '<option value="">Select Service</option>';
    Object.keys(grouped).sort().forEach(categoryName => {
        html += `<optgroup label="${escapeHtml(categoryName)}">`;
        grouped[categoryName].forEach(service => {
            const rate = parseFloat(service.rate || 0).toFixed(2);
            html += `<option value="${service.id}">${escapeHtml(service.name)} - $${rate}/1k</option>`;
        });
        html += '</optgroup>';
    });
    
    return html;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

