(function() {
    'use strict';

    // Cache
    let allRefills = [];
    let filteredRefills = [];

    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
        checkAuth();
        loadRefills();
    });

    // Check authentication
    function checkAuth() {
        const token = localStorage.getItem('token');
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        
        if (!token || user.role !== 'admin') {
            window.location.href = '../signin.html';
        }
    }

    // Load refills
    async function loadRefills() {
        try {
            showLoadingState();
            const token = localStorage.getItem('token');
            
            console.log('[REFILLS] Loading refills with token...');
            const response = await fetch('/.netlify/functions/admin-refills?action=list', {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log('[REFILLS] API Response status:', response.status);
            if (!response.ok) {
                throw new Error('Failed to load refill requests');
            }

            const data = await response.json();
            console.log('[REFILLS] API Response data:', data);
            
            if (data.success) {
                allRefills = data.refills || [];
                console.log('[REFILLS] Loaded refills count:', allRefills.length);
                filteredRefills = [...allRefills];
                renderRefills();
            } else {
                console.error('[REFILLS] API returned success:false', data.error);
                showErrorState(data.error || 'Failed to load refill requests');
            }
        } catch (error) {
            console.error('[REFILLS] Load error:', error);
            showErrorState(error.message);
        }
    }

    // Render refills table
    function renderRefills() {
        const container = document.getElementById('refillsContainer');
        if (!container) {
            console.error('[REFILLS] Container not found');
            return;
        }

        if (filteredRefills.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><p>No refill requests found</p></div>';
            return;
        }

        let html = `
            <table class="refill-table">
                <thead>
                    <tr>
                        <th style="width: 30px;"><input type="checkbox" id="selectAllRefills" onchange="window.toggleSelectAll()"></th>
                        <th>Refill ID</th>
                        <th>P. Refill ID<br><small>Provider</small></th>
                        <th>P. Order ID<br><small>Provider Order</small></th>
                        <th>Order Number</th>
                        <th>Username</th>
                        <th>Service ID</th>
                        <th>Qty</th>
                        <th>Status</th>
                        <th>Requested</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>`;
        
        filteredRefills.forEach(refill => {
            const status = refill.status || 'pending';
            const requestedDate = new Date(refill.requested_at).toLocaleDateString();
            const isSelected = window.selectedRefills?.has(refill.id) ? 'checked' : '';
            
            let actionButtons = '';
            
            if (status === 'pending') {
                actionButtons += `<button class="refill-actions__btn refill-actions__progress" onclick="window.setRefillInProgress('${refill.id}')" title="Mark as In Progress"><i class="fas fa-spinner"></i></button>`;
                actionButtons += `<button class="refill-actions__btn refill-actions__accept" onclick="window.completeRefill('${refill.id}')" title="Complete"><i class="fas fa-check"></i></button>`;
                actionButtons += `<button class="refill-actions__btn refill-actions__reject" onclick="window.rejectRefill('${refill.id}')" title="Reject"><i class="fas fa-times"></i></button>`;
            }
            
            // View button always last
            actionButtons += `<button class="refill-actions__btn refill-actions__view" onclick="window.viewDetails('${refill.id}')" title="View details"><i class="fas fa-eye"></i></button>`;
            
            html += `
                <tr>
                    <td style="width: 30px;"><input type="checkbox" class="refill-checkbox" data-refill-id="${refill.id}" onchange="window.updateRefillSelection()" ${isSelected}></td>
                    <td><span class="refill-id">#${refill.refill_id || '-'}</span></td>
                    <td>
                        <span class="provider-id">#${refill.provider_refill_id || '-'}</span>
                        <br><small style="color: var(--admin-gray-text);">${refill.provider_name || refill.orders?.service?.provider?.name || 'Unknown'}</small>
                    </td>
                    <td><span class="provider-order-id">#${refill.provider_order_id || '-'}</span></td>
                    <td>${refill.order_number}</td>
                    <td>${refill.user_email || 'Unknown'}</td>
                    <td>${refill.service_id}</td>
                    <td>${refill.quantity}</td>
                    <td><span class="refill-status-badge ${status.replace(/ /g, '-')}">${status}</span></td>
                    <td>${requestedDate}</td>
                    <td><div class="refill-actions">${actionButtons}</div></td>
                </tr>`;
        });
        
        html += `</tbody></table>`;
        container.innerHTML = html;
        
        // Show bulk actions bar if items selected
        updateBulkActionsBar();
    }

    // UI Helpers
    function showLoadingState() {
        const container = document.getElementById('refillsContainer');
        if (container) {
            container.innerHTML = '<div class="loading-state"><i class="fas fa-spinner"></i><p>Loading refill requests...</p></div>';
        }
    }

    function showErrorState(message) {
        const container = document.getElementById('refillsContainer');
        if (container) {
            container.innerHTML = `<div class="error-state"><i class="fas fa-exclamation-circle"></i><p>${message}</p></div>`;
        }
    }

    // Apply filters
    window.applyFilters = function() {
        const statusFilter = document.getElementById('statusFilter').value;
        const searchInput = document.getElementById('searchInput').value.toLowerCase();

        filteredRefills = allRefills.filter(refill => {
            const matchesStatus = !statusFilter || refill.status === statusFilter;
            const matchesSearch = !searchInput || 
                String(refill.order_number).includes(searchInput) ||
                String(refill.refill_id).includes(searchInput) ||
                String(refill.service_id).includes(searchInput);
            
            return matchesStatus && matchesSearch;
        });

        renderRefills();
    };

    // Clear filters
    window.clearFilters = function() {
        const statusFilter = document.getElementById('statusFilter');
        const searchInput = document.getElementById('searchInput');
        if (statusFilter) statusFilter.value = '';
        if (searchInput) searchInput.value = '';
        filteredRefills = [...allRefills];
        renderRefills();
    };

    // View details modal
    window.viewDetails = function(refillId) {
        const refill = allRefills.find(r => r.id === refillId);
        if (!refill) return;

        document.getElementById('detailRefillId').value = `#${refill.refill_id}`;
        document.getElementById('detailOrderNumber').value = refill.order_number;
        document.getElementById('detailUserEmail').value = refill.user_email || 'Unknown';
        document.getElementById('detailServiceId').value = refill.service_id;
        document.getElementById('detailQuantity').value = refill.quantity;
        document.getElementById('detailStatus').value = refill.status || 'pending';
        document.getElementById('detailRequestedAt').value = new Date(refill.requested_at).toLocaleString();
        document.getElementById('detailAdminNotes').value = refill.admin_notes || '';
        document.getElementById('detailReason').value = refill.reason || '';

        // Show/hide action buttons based on status
        const status = refill.status || 'pending';
        const acceptBtn = document.getElementById('acceptBtn');
        const rejectBtn = document.getElementById('rejectBtn');
        
        if (acceptBtn) acceptBtn.style.display = status === 'pending' ? 'block' : 'none';
        if (rejectBtn) rejectBtn.style.display = status === 'pending' ? 'block' : 'none';

        // Store current refill ID for actions
        window.currentRefillId = refillId;

        const modal = document.getElementById('detailsModal');
        if (modal) modal.classList.add('show');
    };

    window.closeDetailsModal = function() {
        const modal = document.getElementById('detailsModal');
        if (modal) modal.classList.remove('show');
    };

    window.saveNotes = async function() {
        const notes = document.getElementById('detailAdminNotes').value;
        const refillId = window.currentRefillId;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/.netlify/functions/admin-refills', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'update_notes',
                    refill_id: refillId,
                    admin_notes: notes
                })
            });

            if (response.ok) {
                showNotification('Notes saved successfully', 'success');
                loadRefills();
                window.closeDetailsModal();
            } else {
                showNotification('Failed to save notes', 'error');
            }
        } catch (error) {
            showNotification('Error saving notes: ' + error.message, 'error');
        }
    };

    window.completeRefill = async function(refillId) {
        // Use parameter if provided, otherwise use stored value
        const id = refillId || window.currentRefillId;
        
        if (!confirm('Are you sure you want to complete this refill request?')) return;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/.netlify/functions/admin-refills', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'completed',
                    refill_id: id
                })
            });

            if (response.ok) {
                showNotification('Refill request completed', 'success');
                loadRefills();
                window.closeDetailsModal();
            } else {
                showNotification('Failed to complete refill request', 'error');
            }
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    };

    window.rejectRefill = async function(refillId) {
        // Use parameter if provided, otherwise use stored value
        const id = refillId || window.currentRefillId;
        
        if (!confirm('Are you sure you want to reject this refill request?')) return;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/.netlify/functions/admin-refills', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'reject',
                    refill_id: id,
                    reason: null
                })
            });

            if (response.ok) {
                showNotification('Refill request rejected', 'success');
                loadRefills();
                window.closeDetailsModal();
            } else {
                showNotification('Failed to reject refill request', 'error');
            }
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    };

    window.updateRefillStatus = async function() {
        const newStatus = document.getElementById('detailStatus').value;
        const id = window.currentRefillId;

        if (!confirm(`Are you sure you want to change status to "${newStatus}"?`)) return;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/.netlify/functions/admin-refills', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'update_status',
                    refill_id: id,
                    status: newStatus
                })
            });

            if (response.ok) {
                showNotification('Status updated successfully', 'success');
                loadRefills();
                window.closeDetailsModal();
            } else {
                const error = await response.json();
                showNotification('Failed to update status: ' + (error.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    };

    window.setRefillInProgress = async function(refillId) {
        const id = refillId;

        try {
            const token = localStorage.getItem('token');
            const response = await fetch('/.netlify/functions/admin-refills', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    action: 'update_status',
                    refill_id: id,
                    status: 'in progress'
                })
            });

            if (response.ok) {
                showNotification('Refill marked as in progress', 'success');
                loadRefills();
            } else {
                const error = await response.json();
                showNotification('Failed to update status: ' + (error.error || 'Unknown error'), 'error');
            }
        } catch (error) {
            showNotification('Error: ' + error.message, 'error');
        }
    };

    function showNotification(message, type) {
        // Use existing notification system from main.js
        if (window.showNotification) {
            window.showNotification(message, type);
        } else {
            alert(message);
        }
    }

    // Bulk selection tracking
    window.selectedRefills = new Set();

    // Toggle select all
    window.toggleSelectAll = function() {
        const selectAllCheckbox = document.getElementById('selectAllRefills');
        const checkboxes = document.querySelectorAll('.refill-checkbox');
        
        if (selectAllCheckbox.checked) {
            checkboxes.forEach(cb => {
                cb.checked = true;
                window.selectedRefills.add(cb.dataset.refillId);
            });
        } else {
            window.selectedRefills.clear();
            checkboxes.forEach(cb => cb.checked = false);
        }
        
        updateBulkActionsBar();
    };

    // Update selection
    window.updateRefillSelection = function() {
        const checkboxes = document.querySelectorAll('.refill-checkbox');
        const selectAllCheckbox = document.getElementById('selectAllRefills');
        
        window.selectedRefills.clear();
        checkboxes.forEach(cb => {
            if (cb.checked) {
                window.selectedRefills.add(cb.dataset.refillId);
            }
        });
        
        // Update select all checkbox
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        const someChecked = Array.from(checkboxes).some(cb => cb.checked);
        
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = allChecked;
            selectAllCheckbox.indeterminate = someChecked && !allChecked;
        }
        
        updateBulkActionsBar();
    };

    // Update bulk actions bar
    function updateBulkActionsBar() {
        let bulkBar = document.getElementById('bulkActionsBar');
        const selectedCount = window.selectedRefills.size;
        
        if (selectedCount === 0) {
            if (bulkBar) bulkBar.style.display = 'none';
            return;
        }
        
        // Create bulk actions bar if doesn't exist
        if (!bulkBar) {
            bulkBar = document.createElement('div');
            bulkBar.id = 'bulkActionsBar';
            bulkBar.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                background: linear-gradient(135deg, rgba(16, 18, 22, 0.95) 0%, rgba(26, 31, 39, 0.98) 100%);
                border: 1px solid var(--admin-border);
                border-radius: 12px;
                padding: 15px 25px;
                box-shadow: 0 12px 28px rgba(0,0,0,0.45);
                z-index: 1000;
                display: flex;
                align-items: center;
                gap: 15px;
                color: var(--admin-light-text);
                font-weight: 600;
            `;
            document.body.appendChild(bulkBar);
        }
        
        bulkBar.innerHTML = `
            <span>${selectedCount} selected</span>
            <button onclick="window.copyProviderOrderIds()" style="padding: 8px 16px; background: rgba(var(--admin-primary-rgb), 0.18); color: var(--admin-primary); border: 1px solid rgba(var(--admin-primary-rgb), 0.4); border-radius: 8px; cursor: pointer; font-weight: 600;">
                <i class="fas fa-copy"></i> Copy Order IDs
            </button>
            <button onclick="window.bulkCompleteRefills()" style="padding: 8px 16px; background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.45); border-radius: 8px; cursor: pointer; font-weight: 600;">
                <i class="fas fa-check"></i> Complete All
            </button>
            <button onclick="window.bulkRejectRefills()" style="padding: 8px 16px; background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.45); border-radius: 8px; cursor: pointer; font-weight: 600;">
                <i class="fas fa-times"></i> Reject All
            </button>
            <button onclick="window.clearRefillSelection()" style="padding: 8px 16px; background: var(--admin-darker-bg); color: var(--admin-light-text); border: 1px solid var(--admin-border); border-radius: 8px; cursor: pointer;">
                Clear
            </button>
        `;
        
        bulkBar.style.display = 'flex';
    }

    // Bulk complete refills
    window.bulkCompleteRefills = async function() {
        if (!confirm(`Complete ${window.selectedRefills.size} refill requests?`)) return;
        
        const token = localStorage.getItem('token');
        let successCount = 0;
        let errorCount = 0;
        
        for (const refillId of window.selectedRefills) {
            try {
                const response = await fetch('/.netlify/functions/admin-refills', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'completed',
                        refill_id: refillId
                    })
                });
                
                if (response.ok) {
                    successCount++;
                } else {
                    errorCount++;
                }
            } catch (error) {
                errorCount++;
            }
        }
        
        showNotification(`${successCount} completed, ${errorCount} failed`, successCount > 0 ? 'success' : 'error');
        window.clearRefillSelection();
        loadRefills();
    };

    // Bulk reject refills
    window.bulkRejectRefills = async function() {
        if (!confirm(`Reject ${window.selectedRefills.size} refill requests?`)) return;
        
        const token = localStorage.getItem('token');
        let successCount = 0;
        let errorCount = 0;
        
        for (const refillId of window.selectedRefills) {
            try {
                const response = await fetch('/.netlify/functions/admin-refills', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        action: 'reject',
                        refill_id: refillId,
                        reason: null
                    })
                });
                
                if (response.ok) {
                    successCount++;
                } else {
                    errorCount++;
                }
            } catch (error) {
                errorCount++;
            }
        }
        
        showNotification(`${successCount} rejected, ${errorCount} failed`, successCount > 0 ? 'success' : 'error');
        window.clearRefillSelection();
        loadRefills();
    };

    // Copy provider order IDs to clipboard
    window.copyProviderOrderIds = function() {
        const orderIds = [];
        for (const refillId of window.selectedRefills) {
            const refill = allRefills.find(r => r.id === refillId);
            if (refill && refill.provider_order_id) {
                orderIds.push(refill.provider_order_id);
            }
        }
        
        if (orderIds.length === 0) {
            showNotification('No provider order IDs to copy', 'warning');
            return;
        }
        
        const text = orderIds.join(',');
        navigator.clipboard.writeText(text).then(() => {
            showNotification(`Copied ${orderIds.length} provider order IDs: ${text}`, 'success');
        }).catch(err => {
            showNotification('Failed to copy to clipboard', 'error');
            console.error('Copy failed:', err);
        });
    };

    // Clear selection
    window.clearRefillSelection = function() {
        window.selectedRefills.clear();
        document.querySelectorAll('.refill-checkbox').forEach(cb => cb.checked = false);
        const selectAllCheckbox = document.getElementById('selectAllRefills');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        updateBulkActionsBar();
    };

    // Logout
    window.logout = function() {
        localStorage.clear();
        window.location.href = '../signin.html';
    };
})();
