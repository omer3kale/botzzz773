// ==========================================
// Admin Link Management JavaScript
// ==========================================

let authToken = null;
let linkData = [];
let filteredData = [];
let currentLinkId = null;

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    initializeLinkManagement();
});

async function initializeLinkManagement() {
    try {
        // Check authentication
        authToken = localStorage.getItem('adminToken');
        if (!authToken) {
            window.location.href = '../signin.html';
            return;
        }

        // Load initial data
        await loadLinkData();
        setupEventListeners();
        
    } catch (error) {
        console.error('Failed to initialize link management:', error);
        showToast('Failed to load link management data', 'error');
    }
}

function setupEventListeners() {
    // Filter event listeners
    document.getElementById('serviceFilter').addEventListener('change', applyFilters);
    document.getElementById('statusFilter').addEventListener('change', applyFilters);
    document.getElementById('providerFilter').addEventListener('change', applyFilters);
    document.getElementById('searchFilter').addEventListener('input', debounce(applyFilters, 300));
}

async function loadLinkData() {
    // DISABLED: Link Management requires database migration
    try {
        const errorMsg = 'Link Management system requires database migration to be applied first. Please contact administrator.';
        console.warn('Link Management disabled:', errorMsg);
        showError(errorMsg);
        
        // Set empty data to prevent errors
        linkData = [];
        updateStatistics({
            totalLinks: 0,
            conflictedLinks: 0,
            totalOrders: 0,
            totalValue: 0
        });
        
    } catch (error) {
        console.error('Error in loadLinkData:', error);
        showError('Link Management system is currently unavailable');
    }
}

function updateStatistics(stats) {
    document.getElementById('totalLinks').textContent = stats?.totalLinks || 0;
    document.getElementById('conflictedLinks').textContent = stats?.conflictedLinks || 0;
    document.getElementById('totalOrders').textContent = stats?.totalOrders || 0;
    document.getElementById('failedOrders').textContent = stats?.failedOrders || 0;
}

function populateFilters() {
    // Get unique services
    const services = [...new Set(linkData.flatMap(link => 
        link.orders.map(order => order.service_name)
    ))].sort();
    
    const serviceFilter = document.getElementById('serviceFilter');
    serviceFilter.innerHTML = '<option value="">All Services</option>';
    services.forEach(service => {
        const option = document.createElement('option');
        option.value = service;
        option.textContent = service;
        serviceFilter.appendChild(option);
    });

    // Get unique providers
    const providers = [...new Set(linkData.flatMap(link => 
        link.orders.map(order => order.provider_name)
    ))].filter(Boolean).sort();
    
    const providerFilter = document.getElementById('providerFilter');
    providerFilter.innerHTML = '<option value="">All Providers</option>';
    providers.forEach(provider => {
        const option = document.createElement('option');
        option.value = provider;
        option.textContent = provider;
        providerFilter.appendChild(option);
    });
}

function applyFilters() {
    const serviceFilter = document.getElementById('serviceFilter').value;
    const statusFilter = document.getElementById('statusFilter').value;
    const providerFilter = document.getElementById('providerFilter').value;
    const searchFilter = document.getElementById('searchFilter').value.toLowerCase();

    filteredData = linkData.filter(link => {
        // Service filter
        if (serviceFilter && !link.orders.some(order => order.service_name === serviceFilter)) {
            return false;
        }

        // Status filter
        if (statusFilter && link.status !== statusFilter) {
            return false;
        }

        // Provider filter
        if (providerFilter && !link.orders.some(order => order.provider_name === providerFilter)) {
            return false;
        }

        // Search filter
        if (searchFilter && !link.url.toLowerCase().includes(searchFilter) && 
            !link.id.toString().includes(searchFilter)) {
            return false;
        }

        return true;
    });

    renderTable();
}

function renderTable() {
    const tableContent = document.getElementById('tableContent');
    
    if (filteredData.length === 0) {
        tableContent.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-link"></i>
                <h3>No Links Found</h3>
                <p>No links match your current filters.</p>
            </div>
        `;
        return;
    }

    const tableHTML = `
        <table class="links-table">
            <thead>
                <tr>
                    <th>Link ID</th>
                    <th>URL</th>
                    <th>Service</th>
                    <th>Orders</th>
                    <th>Total Quantity</th>
                    <th>Status</th>
                    <th>Last Updated</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                ${filteredData.map(link => renderTableRow(link)).join('')}
            </tbody>
        </table>
    `;

    tableContent.innerHTML = tableHTML;
}

function renderTableRow(link) {
    const primaryService = link.orders[0]?.service_name || 'Unknown';
    const totalQuantity = link.orders.reduce((sum, order) => sum + (order.quantity || 0), 0);
    const lastUpdated = new Date(link.updated_at).toLocaleString();
    
    return `
        <tr>
            <td><strong>${link.id}</strong></td>
            <td class="link-cell">
                <a href="${link.url}" target="_blank" title="${link.url}">
                    ${truncateUrl(link.url, 40)}
                </a>
            </td>
            <td>
                <span class="service-badge">${primaryService}</span>
                ${link.orders.length > 1 ? `<small>(+${link.orders.length - 1} more)</small>` : ''}
            </td>
            <td>
                <div class="orders-info">
                    <span class="total-orders">${link.orders.length} orders</span>
                    <span class="order-details">
                        ${link.orders.filter(o => o.status === 'completed').length} completed,
                        ${link.orders.filter(o => o.status === 'failed').length} failed
                    </span>
                </div>
            </td>
            <td><strong>${totalQuantity.toLocaleString()}</strong></td>
            <td>
                <span class="status-badge status-${link.status}">
                    ${link.status}
                </span>
            </td>
            <td>${lastUpdated}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn-sm btn-primary" onclick="viewLinkDetails('${link.id}')" title="View Details">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${link.status === 'conflicted' ? `
                        <button class="btn-sm btn-warning" onclick="resolveConflict('${link.id}')" title="Resolve Conflict">
                            <i class="fas fa-wrench"></i>
                        </button>
                    ` : ''}
                    ${link.orders && link.orders.length > 0 ? `
                        <button class="btn-sm btn-success" onclick="resendLinkOrders('${link.id}')" title="Resend Orders">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    ` : ''}
                    <button class="btn-sm btn-danger" onclick="mergeLinkOrders('${link.id}')" title="Merge Orders">
                        <i class="fas fa-compress-alt"></i>
                    </button>
                </div>
            </td>
        </tr>
    `;
}

function truncateUrl(url, maxLength) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
}

// Modal Functions
function viewLinkDetails(linkId) {
    const link = linkData.find(l => l.id === linkId);
    if (!link) return;

    currentLinkId = linkId;
    
    const modalContent = document.getElementById('linkDetailsContent');
    modalContent.innerHTML = `
        <div class="link-details">
            <h4>Link Information</h4>
            <p><strong>URL:</strong> <a href="${link.url}" target="_blank">${link.url}</a></p>
            <p><strong>Status:</strong> <span class="status-badge status-${link.status}">${link.status}</span></p>
            <p><strong>Created:</strong> ${new Date(link.created_at).toLocaleString()}</p>
            
            <h4>Order History (${link.orders.length} orders)</h4>
            <div class="order-history">
                ${link.orders.map(order => `
                    <div class="order-item" style="border: 1px solid #e1e5e9; border-radius: 4px; padding: 15px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 10px;">
                            <strong>Order #${order.id}</strong>
                            <span class="status-badge status-${order.status}">${order.status}</span>
                        </div>
                        <p><strong>Service:</strong> ${order.service_name}</p>
                        <p><strong>Provider:</strong> ${order.provider_name}</p>
                        <p><strong>Quantity:</strong> ${order.quantity?.toLocaleString()}</p>
                        <p><strong>Created:</strong> ${new Date(order.created_at).toLocaleString()}</p>
                        ${order.external_id ? `<p><strong>External ID:</strong> ${order.external_id}</p>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    document.getElementById('linkDetailsModal').classList.add('show');
}

function closeLinkDetailsModal() {
    document.getElementById('linkDetailsModal').classList.remove('show');
    currentLinkId = null;
}

function resolveConflict(linkId) {
    const link = linkData.find(l => l.id === linkId);
    if (!link) return;

    const modalContent = document.getElementById('conflictResolutionContent');
    modalContent.innerHTML = `
        <div class="conflict-resolution">
            <h4>Resolve Conflicts for:</h4>
            <p><strong>URL:</strong> ${truncateUrl(link.url, 60)}</p>
            <p><strong>Conflicted Orders:</strong> ${link.orders.length}</p>
            
            <h5>Resolution Options:</h5>
            <div class="resolution-options">
                <label>
                    <input type="radio" name="resolutionType" value="merge" checked>
                    <strong>Merge Orders</strong> - Combine quantities and keep the most recent order
                </label>
                <label>
                    <input type="radio" name="resolutionType" value="cancel_duplicates">
                    <strong>Cancel Duplicates</strong> - Keep only the first order, cancel others
                </label>
                <label>
                    <input type="radio" name="resolutionType" value="manual">
                    <strong>Manual Resolution</strong> - Review each order individually
                </label>
            </div>
            
            <div class="warning-message" style="background: #fff3e0; border: 1px solid #f57c00; border-radius: 4px; padding: 15px; margin-top: 15px;">
                <i class="fas fa-exclamation-triangle" style="color: #f57c00;"></i>
                <strong>Warning:</strong> This action will modify existing orders. Make sure to review the changes carefully.
            </div>
        </div>
    `;
    
    document.getElementById('conflictResolutionModal').classList.add('show');
}

function closeConflictModal() {
    document.getElementById('conflictResolutionModal').classList.remove('show');
}

async function executeResolution() {
    const resolutionType = document.querySelector('input[name="resolutionType"]:checked')?.value;
    if (!resolutionType) return;

    try {
        const response = await fetch('/.netlify/functions/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                // DISABLED: Database migration required
                action: 'disabled_resolve_link_conflicts',
                error: 'Link management requires database migration'
            })
        });

        if (!response.ok) {
            throw new Error('Failed to resolve conflicts');
        }

        const result = await response.json();
        showToast(`Successfully resolved conflicts: ${result.message}`, 'success');
        
        closeConflictModal();
        await loadLinkData(); // Refresh data
        
    } catch (error) {
        console.error('Error resolving conflicts:', error);
        showToast('Failed to resolve conflicts', 'error');
    }
}

async function mergeOrders() {
    if (!currentLinkId) return;

    try {
        const response = await fetch('/.netlify/functions/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                // DISABLED: Database migration required
                action: 'disabled_merge_link_orders',
                error: 'Link management requires database migration'
            })
        });

        if (!response.ok) {
            throw new Error('Failed to merge orders');
        }

        const result = await response.json();
        showToast(`Successfully merged orders: ${result.message}`, 'success');
        
        closeLinkDetailsModal();
        await loadLinkData(); // Refresh data
        
    } catch (error) {
        console.error('Error merging orders:', error);
        showToast('Failed to merge orders', 'error');
    }
}

async function mergeLinkOrders(linkId) {
    if (!confirm('Are you sure you want to merge all orders for this link? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch('/.netlify/functions/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                // DISABLED: Database migration required
                action: 'disabled_merge_link_orders',
                error: 'Link management requires database migration'
            })
        });

        if (!response.ok) {
            throw new Error('Failed to merge orders');
        }

        const result = await response.json();
        showToast(`Successfully merged orders: ${result.message}`, 'success');
        
        await loadLinkData(); // Refresh data
        
    } catch (error) {
        console.error('Error merging orders:', error);
        showToast('Failed to merge orders', 'error');
    }
}

async function resendLinkOrders(linkId) {
    const link = linkData.find(l => l.id === linkId);
    if (!link || !link.orders || link.orders.length === 0) {
        showToast('No orders found to resend', 'error');
        return;
    }

    const orderCount = link.orders.length;
    if (!confirm(`Are you sure you want to resend ${orderCount} order(s) to the provider? This will create new provider requests for all pending/failed orders.`)) {
        return;
    }

    try {
        showToast('Resending orders...', 'info');

        const response = await fetch('/.netlify/functions/link-management/resend', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                linkId: linkId
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to resend orders');
        }

        const result = await response.json();
        showToast(`Successfully resent ${result.sent || 0} orders. Failed: ${result.failed || 0}`, 'success');
        
        await loadLinkData(); // Refresh data
        
    } catch (error) {
        console.error('Error resending orders:', error);
        showToast(`Failed to resend orders: ${error.message}`, 'error');
    }
}

async function resolveAllConflicts() {
    if (!confirm('Are you sure you want to resolve all conflicted links? This will merge duplicate orders automatically.')) {
        return;
    }

    try {
        const response = await fetch('/.netlify/functions/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
                action: 'resolve_all_conflicts'
            })
        });

        if (!response.ok) {
            throw new Error('Failed to resolve all conflicts');
        }

        const result = await response.json();
        showToast(`Successfully resolved ${result.resolved} conflicts`, 'success');
        
        await loadLinkData(); // Refresh data
        
    } catch (error) {
        console.error('Error resolving all conflicts:', error);
        showToast('Failed to resolve all conflicts', 'error');
    }
}

async function refreshData() {
    await loadLinkData();
    showToast('Data refreshed successfully', 'success');
}

async function exportData() {
    try {
        const csvData = generateCSV(filteredData);
        downloadCSV(csvData, 'link-management-export.csv');
        showToast('Data exported successfully', 'success');
    } catch (error) {
        console.error('Error exporting data:', error);
        showToast('Failed to export data', 'error');
    }
}

function generateCSV(data) {
    const headers = ['Link ID', 'URL', 'Status', 'Total Orders', 'Total Quantity', 'Primary Service', 'Created At'];
    const rows = data.map(link => [
        link.id,
        `"${link.url}"`,
        link.status,
        link.orders.length,
        link.orders.reduce((sum, order) => sum + (order.quantity || 0), 0),
        link.orders[0]?.service_name || 'Unknown',
        new Date(link.created_at).toISOString()
    ]);
    
    return [headers, ...rows].map(row => row.join(',')).join('\n');
}

function downloadCSV(csvData, filename) {
    const blob = new Blob([csvData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
}

// Utility Functions
function showLoading() {
    const tableContent = document.getElementById('tableContent');
    tableContent.innerHTML = `
        <div class="loading">
            <i class="fas fa-spinner fa-spin"></i> Loading link data...
        </div>
    `;
}

function showError(message) {
    const tableContent = document.getElementById('tableContent');
    tableContent.innerHTML = `
        <div class="empty-state">
            <i class="fas fa-exclamation-triangle" style="color: #d32f2f;"></i>
            <h3>Error Loading Data</h3>
            <p>${message}</p>
            <button class="btn btn-primary" onclick="loadLinkData()">
                <i class="fas fa-retry"></i> Retry
            </button>
        </div>
    `;
}

function showToast(message, type = 'info') {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        background: ${type === 'success' ? '#2e7d32' : type === 'error' ? '#d32f2f' : '#1976d2'};
        color: white;
        border-radius: 4px;
        z-index: 1001;
        font-weight: 500;
    `;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
        document.body.removeChild(toast);
    }, 4000);
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}