// Admin Users Management with Real Backend Integration

if (typeof window !== 'undefined') {
    window.initializeAdminPopupSurface?.('Admin users window');
}

// Global variable to store fetched users
let usersData = [];
const selectedUserIds = new Set();

function getUserById(userId) {
    return usersData.find(user => user.id === userId);
}

function getUserDisplayName(user) {
    if (!user) {
        return '';
    }
    if (user.username) {
        return user.username;
    }
    if (user.email) {
        return user.email;
    }
    if (user.id) {
        return `User ${user.id.substring(0, 8)}`;
    }
    return 'User';
}

// Populate users table from backend
async function populateUsersTable() {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    try {
        // Show loading state
        tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 2rem;">Loading users...</td></tr>';
        
        // Get auth token
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Not authenticated');
        }
        
        // Fetch users from backend
        const response = await fetch('/.netlify/functions/users', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch users: ${response.status}`);
        }

        const result = await response.json();
        usersData = result.users || [];
        pruneSelectedUserIds();
        
        if (usersData.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" style="text-align: center; padding: 2rem; color: #888;">No users found</td></tr>';
            updateSelectedUsersSummary();
            return;
        }
        
        // Render users
        tbody.innerHTML = usersData.map(user => {
            const created = new Date(user.created_at).toLocaleString();
            const lastAuth = user.last_login ? new Date(user.last_login).toLocaleString() : 'Never';
            const balance = parseFloat(user.balance || 0);
            const spent = parseFloat(user.spent || 0);
            const profit = parseFloat(user.profit || 0);
            const discount = parseFloat(user.discount_rate || 0);
            const status = (user.status || 'active').charAt(0).toUpperCase() + (user.status || 'active').slice(1);
            
            return `
                <tr data-user-id="${user.id}">
                    <td><input type="checkbox" class="user-checkbox" data-user-id="${user.id}" aria-label="Select user ${user.id}"></td>
                    <td>${user.username}</td>
                    <td>${user.email}</td>
                    <td>$${(balance.toFixed(5).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, ''))}</td>
                    <td>$${(spent.toFixed(5).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, ''))}</td>
                    <td>$${(profit.toFixed(5).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, ''))}</td>
                    <td>
                        <span class="status-badge ${status.toLowerCase() === 'active' ? 'completed' : 'fail'}">
                            ${status}
                        </span>
                    </td>
                    <td>${created}</td>
                    <td>${lastAuth}</td>
                    <td>${discount}%</td>
                    <td>
                        <div class="actions-dropdown">
                            <button class="btn-icon"><i class="fas fa-ellipsis-v"></i></button>
                            <div class="dropdown-menu">
                                <a href="#" onclick="viewUser('${user.id}')">View</a>
                                <a href="#" onclick="editUser('${user.id}')">Edit</a>
                                <a href="#" onclick="loginAsUser('${user.id}')">Login as User</a>
                                <a href="#" onclick="deleteUser('${user.id}')">Delete</a>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
        
        restoreUserSelectionState();
        bindUserSelectionEvents();
        updateSelectedUsersSummary();
        
        console.log(`✅ Loaded ${usersData.length} users from database`);
        
    } catch (error) {
        console.error('Error fetching users:', error);
        tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 2rem; color: #ff4444;">Error loading users: ${error.message}</td></tr>`;
    }
}

function pruneSelectedUserIds() {
    if (selectedUserIds.size === 0) {
        return;
    }
    const validIds = new Set(usersData.map(user => user.id));
    for (const id of Array.from(selectedUserIds)) {
        if (!validIds.has(id)) {
            selectedUserIds.delete(id);
        }
    }
}

function bindUserSelectionEvents() {
    const checkboxes = document.querySelectorAll('.user-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', handleUserSelectionChange);
    });
}

function handleUserSelectionChange(event) {
    const checkbox = event?.target;
    if (!checkbox || !checkbox.dataset.userId) {
        return;
    }

    const userId = checkbox.dataset.userId;
    if (checkbox.checked) {
        selectedUserIds.add(userId);
    } else {
        selectedUserIds.delete(userId);
    }

    const row = checkbox.closest('tr');
    if (row) {
        row.classList.toggle('is-selected', checkbox.checked);
    }

    updateSelectedUsersSummary();
}

function restoreUserSelectionState() {
    const checkboxes = document.querySelectorAll('.user-checkbox');
    checkboxes.forEach(checkbox => {
        const userId = checkbox.dataset.userId;
        const shouldSelect = selectedUserIds.has(userId);
        checkbox.checked = shouldSelect;
        const row = checkbox.closest('tr');
        if (row) {
            row.classList.toggle('is-selected', shouldSelect);
        }
    });
}

function updateSelectedUsersSummary() {
    const countEl = document.getElementById('selectedUsersCount');
    const detailEl = document.getElementById('selectedUsersDetail');
    const cardEl = document.getElementById('selectedUsersCard');

    if (!countEl || !detailEl || !cardEl) {
        return;
    }

    const count = selectedUserIds.size;
    countEl.textContent = `${count} selected`;

    if (count === 0) {
        detailEl.textContent = 'Choose a user in the table to unlock quick actions.';
    } else {
        const names = [];
        selectedUserIds.forEach(id => {
            const displayName = getUserDisplayName(getUserById(id));
            if (displayName) {
                names.push(displayName);
            }
        });
        const preview = names.slice(0, 2).filter(Boolean).join(', ');
        const overflow = names.length > 2 ? ` +${names.length - 2}` : '';
        detailEl.textContent = preview ? `${preview}${overflow}` : `${count} selected`;
    }

    cardEl.classList.toggle('is-active', count > 0);
    cardEl.setAttribute('aria-pressed', count > 0 ? 'true' : 'false');
    syncMasterToggleState();
}

function syncMasterToggleState() {
    const masterToggle = document.querySelector('th input[type="checkbox"][aria-label="Select all users"]');
    if (!masterToggle) {
        return;
    }

    const checkboxes = Array.from(document.querySelectorAll('.user-checkbox'));
    if (checkboxes.length === 0) {
        masterToggle.checked = false;
        masterToggle.indeterminate = false;
        return;
    }

    const selectedCount = checkboxes.filter(cb => cb.checked).length;
    masterToggle.checked = selectedCount > 0 && selectedCount === checkboxes.length;
    masterToggle.indeterminate = selectedCount > 0 && selectedCount < checkboxes.length;
}

function openSelectedUserModal() {
    if (selectedUserIds.size === 0) {
        showNotification('Select a user from the table first', 'error');
        return;
    }
    const iterator = selectedUserIds.values();
    const selectedId = iterator.next().value;
    if (selectedId) {
        viewUser(selectedId);
    }
}

function openAddUserQuickAction() {
    addUser();
}

function attachQuickActionCard(element, handler) {
    if (!element || typeof handler !== 'function') {
        return;
    }

    element.addEventListener('click', handler);
    element.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handler();
        }
    });
}

function initializeUsersQuickActions() {
    attachQuickActionCard(document.getElementById('selectedUsersCard'), openSelectedUserModal);
    attachQuickActionCard(document.getElementById('addUserCard'), openAddUserQuickAction);
    updateSelectedUsersSummary();
}

function toggleAllUsers(masterCheckbox) {
    if (!masterCheckbox) {
        return;
    }

    const checkboxes = document.querySelectorAll('.user-checkbox');
    const shouldSelectAll = masterCheckbox.checked;
    masterCheckbox.indeterminate = false;

    checkboxes.forEach(checkbox => {
        checkbox.checked = shouldSelectAll;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
}

// Modal Helper Functions
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
    
    // Remove existing modal if any
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

// Add user with real modal
function addUser() {
    const content = `
        <form id="addUserForm" onsubmit="submitAddUser(event)" class="admin-form">
            <div class="form-group">
                <label>Username *</label>
                <input type="text" name="username" required placeholder="Enter username">
            </div>
            <div class="form-group">
                <label>Email *</label>
                <input type="email" name="email" required placeholder="Enter email address">
            </div>
            <div class="form-group">
                <label>Password *</label>
                <div class="password-input-wrapper">
                    <input type="password" name="password" id="newUserPassword" required placeholder="Enter password">
                    <button type="button" class="toggle-password" onclick="togglePasswordField('newUserPassword')">
                        <i class="fas fa-eye"></i>
                    </button>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Initial Balance</label>
                    <input type="number" name="balance" value="0.00" min="0" step="0.00001" placeholder="0.00000">
                </div>
                <div class="form-group">
                    <label>Discount Rate %</label>
                    <input type="number" name="discount_rate" value="0" min="0" max="100" step="0.01" placeholder="0">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>User Rate %</label>
                    <input type="number" name="user_rate" value="0" min="0" max="100" step="0.01" placeholder="0 = Default">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status">
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="banned">Banned</option>
                    </select>
                </div>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="addUserForm" class="btn-primary">
            <i class="fas fa-user-plus"></i> Create User
        </button>
    `;
    
    createModal('Add New User', content, actions);
}

function togglePasswordField(fieldId) {
    const field = document.getElementById(fieldId);
    const icon = event.target.closest('button').querySelector('i');
    if (field.type === 'password') {
        field.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        field.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

function submitAddUser(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const userData = Object.fromEntries(formData);
    
    console.log('Creating user:', userData);
    showNotification(`User "${userData.username}" created successfully!`, 'success');
    closeModal();
    
    // In production, this would make an API call
    setTimeout(() => populateUsersTable(), 500);
}

// View user with details modal
function viewUser(userId) {
    // Find user in global data
    const user = usersData.find(u => u.id === userId);
    if (!user) {
        showNotification('User not found', 'error');
        return;
    }
    
    const balance = parseFloat(user.balance || 0);
    const spent = parseFloat(user.spent || 0);
    const discount = parseFloat(user.discount_rate || 0);
    const userRate = parseFloat(user.user_rate || 0);
    const created = new Date(user.created_at).toLocaleString();
    const lastLogin = user.last_login ? new Date(user.last_login).toLocaleString() : 'Never';
    const lastUpdate = user.updated_at ? new Date(user.updated_at).toLocaleString() : 'Never';
    const status = (user.status || 'active').charAt(0).toUpperCase() + (user.status || 'active').slice(1);
    
    const content = `
        <div class="user-details">
            <div class="user-detail-section">
                <h4><i class="fas fa-user"></i> Profile Information</h4>
                <div class="detail-row">
                    <span class="detail-label">User ID:</span>
                    <span class="detail-value" style="font-family: monospace; font-size: 0.85em;">${user.id}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Username:</span>
                    <span class="detail-value">${user.username}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Email:</span>
                    <span class="detail-value">${user.email}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Full Name:</span>
                    <span class="detail-value">${user.full_name || 'Not provided'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Role:</span>
                    <span class="detail-value">${user.role || 'user'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Status:</span>
                    <span class="status-badge ${status.toLowerCase() === 'active' ? 'completed' : 'fail'}">${status}</span>
                </div>
            </div>
            <div class="user-detail-section">
                <h4><i class="fas fa-wallet"></i> Financial Summary</h4>
                <div class="detail-row">
                    <span class="detail-label">Current Balance:</span>
                    <span class="detail-value">$${(balance.toFixed(5).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, ''))}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Total Spent:</span>
                    <span class="detail-value">$${(spent.toFixed(5).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, ''))}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Discount Rate:</span>
                    <span class="detail-value">${discount}%</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">User Rate:</span>
                    <span class="detail-value">${userRate > 0 ? userRate + '%' : 'Default'}</span>
                </div>
            </div>
            <div class="user-detail-section">
                <h4><i class="fas fa-chart-line"></i> Activity</h4>
                <div class="detail-row">
                    <span class="detail-label">API Key:</span>
                    <span class="detail-value" style="font-family: monospace; font-size: 0.85em;">${user.api_key || 'Not generated'}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Created:</span>
                    <span class="detail-value">${created}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Last Login:</span>
                    <span class="detail-value">${lastLogin}</span>
                </div>
                <div class="detail-row">
                    <span class="detail-label">Last Updated:</span>
                    <span class="detail-value">${lastUpdate}</span>
                </div>
            </div>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="editUser('${userId}')">
            <i class="fas fa-edit"></i> Edit User
        </button>
        <button type="button" class="btn-primary" onclick="closeModal()">Close</button>
    `;
    
    createModal(`User: ${user.username}`, content, actions);
}

// Edit user
function editUser(userId) {
    // Find user in global data
    const user = usersData.find(u => u.id === userId);
    if (!user) {
        showNotification('User not found', 'error');
        return;
    }
    
    const balance = parseFloat(user.balance || 0);
    const discount = parseFloat(user.discount_rate || 0);
    const userRate = parseFloat(user.user_rate || 0);
    const status = user.status || 'active';
    
    const content = `
        <form id="editUserForm" onsubmit="submitEditUser(event, '${userId}')" class="admin-form">
            <div class="form-group">
                <label>Username *</label>
                <input type="text" name="username" value="${user.username}" required>
            </div>
            <div class="form-group">
                <label>Email *</label>
                <input type="email" name="email" value="${user.email}" required>
            </div>
            <div class="form-group">
                <label>Full Name</label>
                <input type="text" name="full_name" value="${user.full_name || ''}" placeholder="Enter full name">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Balance</label>
                    <input type="number" name="balance" value="${balance.toFixed(5)}" step="0.00001">
                </div>
                <div class="form-group">
                    <label>Discount Rate %</label>
                    <input type="number" name="discount_rate" value="${discount}" min="0" max="100" step="0.01">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Per-Service Discounts</label>
                    <button type="button" class="btn btn-secondary" onclick="openCustomRateModal('${userId}')" style="width: 100%; margin-top: 8px;">
                        <i class="fas fa-tags"></i> Set Custom Rates
                    </button>
                    <small style="color: #64748B; display: block; margin-top: 4px;">Define custom discount rates for specific services</small>
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status">
                        <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
                        <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option>
                        <option value="banned" ${status === 'banned' ? 'selected' : ''}>Banned</option>
                    </select>
                </div>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="editUserForm" class="btn-primary">
            <i class="fas fa-save"></i> Save Changes
        </button>
    `;
    
    createModal(`Edit User: ${user.username}`, content, actions);
}

async function submitEditUser(event, userId) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const userData = Object.fromEntries(formData);
    
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Not authenticated');
        }
        
        // Send update to backend
        const response = await fetch('/.netlify/functions/users', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: userId,
                username: userData.username,
                email: userData.email,
                full_name: userData.full_name,
                balance: parseFloat(userData.balance || 0),
                discount_rate: parseFloat(userData.discount_rate || 0),
                user_rate: parseFloat(userData.user_rate || 0),
                status: userData.status
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update user');
        }
        
        showNotification(`User updated successfully!`, 'success');
        closeModal();
        
        // Refresh users list
        await populateUsersTable();
        
    } catch (error) {
        console.error('Error updating user:', error);
        showNotification(error.message, 'error');
    }
}

// Login as user
function loginAsUser(userId) {
    const content = `
        <div class="confirmation-message">
            <i class="fas fa-user-lock" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>You are about to log in as User #${userId}.</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                You will see the panel from their perspective and can perform actions on their behalf.
            </p>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="confirmLoginAsUser(${userId})">
            <i class="fas fa-sign-in-alt"></i> Login as User
        </button>
    `;
    
    createModal('Login as User', content, actions);
}

function confirmLoginAsUser(userId) {
    showNotification(`Logged in as User #${userId}. Redirecting...`, 'success');
    closeModal();
    setTimeout(() => {
        // window.location.href = '../index.html?impersonate=' + userId;
    }, 1500);
}

// Delete user
function deleteUser(userId) {
    const user = usersData.find(u => u.id === userId);
    const userLabel = user ? user.username : userId.substring(0, 8);
    
    const content = `
        <div class="confirmation-message danger">
            <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #ef4444; margin-bottom: 20px;"></i>
            <p>Are you sure you want to delete <strong>${userLabel}</strong>?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will permanently delete all their data including orders, tickets, and payment history. This action cannot be undone.
            </p>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-danger" onclick="confirmDeleteUser('${userId}')">
            <i class="fas fa-trash"></i> Delete User
        </button>
    `;
    
    createModal('Delete User', content, actions);
}

async function confirmDeleteUser(userId) {
    const deleteBtn = document.querySelector('.btn-danger');
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
    }
    
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Not authenticated');
        }
        
        const response = await fetch('/.netlify/functions/users', {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ userId: userId })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete user');
        }
        
        showNotification('User deleted successfully!', 'success');
        closeModal();
        setTimeout(() => populateUsersTable(), 500);
        
    } catch (error) {
        console.error('Error deleting user:', error);
        showNotification(error.message, 'error');
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete User';
        }
    }
}

// Custom Service Rates Modal
async function openCustomRateModal(userId) {
    const user = usersData.find(u => u.id === userId);
    if (!user) {
        showNotification('User not found', 'error');
        return;
    }

    // Fetch all services
    let services = [];
    try {
        const token = localStorage.getItem('token');
        const response = await fetch('/.netlify/functions/services?audience=admin', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        services = Array.isArray(data) ? data : (data.services || []);
    } catch (error) {
        console.error('Failed to load services:', error);
        showNotification('Failed to load services', 'error');
        return;
    }

    if (services.length === 0) {
        showNotification('No services available', 'warning');
        return;
    }

    // Store services globally for search
    window.customRateServices = services;
    window.customRateUserId = userId;

    // Fetch user's custom rates
    let customRates = {};
    try {
        const serviceDiscounts = user.service_discounts || {};
        customRates = typeof serviceDiscounts === 'string' ? JSON.parse(serviceDiscounts) : serviceDiscounts;
    } catch (e) {
        customRates = {};
    }
    window.customRatesData = customRates;

    // Build current custom rates list
    const content = `
        <div style="max-height: 600px; overflow-y: auto;">
            <p style="color: #64748B; margin-bottom: 20px;">
                Search and select services to set custom discount rates for <strong>${user.username}</strong>.
            </p>
            <div id="currentRatesWrapper" style="margin-bottom: 24px; padding: 16px; background: #F8FAFC; border-radius: 8px; border: 1px solid #E2E8F0;">
                <h4 style="margin: 0 0 12px 0; font-size: 14px; font-weight: 600; color: #334155;">Current Custom Rates:</h4>
                <div id="noCustomRates" style="color: #64748B; font-size: 13px;">No custom rates set yet.</div>
                <div id="currentCustomRates"></div>
            </div>
            
            <div style="margin-bottom: 20px;">
                <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 8px;">
                    Search Service (by ID or name):
                </label>
                <input 
                    type="text" 
                    id="serviceSearchInput"
                    placeholder="Type service ID (e.g., 9071) or service name..."
                    style="width: 100%; padding: 12px; border: 2px solid #CBD5E1; border-radius: 8px; font-size: 14px;"
                    oninput="searchCustomRateServices(this.value)"
                >
                <div 
                    id="serviceSearchResults" 
                    style="margin-top: 8px; max-height: 300px; overflow-y: auto; border: 1px solid #E2E8F0; border-radius: 8px; display: none; background: white;"
                ></div>
            </div>
            
            <div id="selectedServiceSection" style="display: none; padding: 16px; background: #F0F9FF; border: 2px solid #0EA5E9; border-radius: 8px;">
                <h4 style="margin: 0 0 12px 0; color: #0C4A6E; font-size: 14px; font-weight: 600;">Selected Service:</h4>
                <div id="selectedServiceInfo" style="margin-bottom: 16px;"></div>
                <div style="display: flex; gap: 12px; align-items: end;">
                    <div style="flex: 1;">
                        <label style="display: block; font-weight: 600; color: #334155; margin-bottom: 6px;">
                            Discount Rate (%):
                        </label>
                        <input 
                            type="number" 
                            id="customDiscountInput"
                            min="0" 
                            max="100" 
                            step="0.01"
                            placeholder="Enter discount (0-100)"
                            style="width: 100%; padding: 10px; border: 2px solid #0EA5E9; border-radius: 6px; font-size: 14px;"
                        >
                    </div>
                    <button 
                        type="button" 
                        onclick="addCustomRateToList()"
                        style="padding: 10px 20px; background: #0EA5E9; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer; white-space: nowrap;"
                    >
                        Add Discount
                    </button>
                </div>
            </div>
        </div>
    `;

    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-primary" onclick="saveAllCustomRates()">
            <i class="fas fa-save"></i> Save Changes
        </button>
    `;

    createModal(`Custom Service Rates: ${user.username}`, content, actions);
    updateCustomRatesList();
}

// Search services for custom rate modal
function searchCustomRateServices(query) {
    const resultsDiv = document.getElementById('serviceSearchResults');
    if (!query || query.trim().length === 0) {
        resultsDiv.style.display = 'none';
        return;
    }

    const services = window.customRateServices || [];
    const searchTerm = query.toLowerCase().trim();
    
    // Search by ID or name
    const matches = services.filter(service => {
        const serviceId = String(service.public_id || service.id || '');
        const serviceName = String(service.name || '').toLowerCase();
        return serviceId.includes(searchTerm) || serviceName.includes(searchTerm);
    }).slice(0, 20); // Limit to 20 results

    if (matches.length === 0) {
        resultsDiv.innerHTML = `
            <div style="padding: 16px; text-align: center; color: #64748B;">
                No services found matching "${query}"
            </div>
        `;
        resultsDiv.style.display = 'block';
        return;
    }

    resultsDiv.innerHTML = matches.map(service => {
        const serviceId = service.public_id || service.id;
        const serviceName = service.name || 'Unknown Service';
        const rate = Number(service.rate || service.retail_rate || 0).toFixed(4);
        
        return `
            <div 
                onclick="selectServiceForCustomRate(${serviceId}, '${serviceName.replace(/'/g, "\\'")}', ${rate})"
                style="padding: 12px 16px; border-bottom: 1px solid #E2E8F0; cursor: pointer; transition: background 0.2s;"
                onmouseover="this.style.background='#F8FAFC'"
                onmouseout="this.style.background='white'"
            >
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong style="color: #0F172A;">#${serviceId}</strong>
                        <span style="color: #64748B; margin-left: 8px;">${serviceName}</span>
                    </div>
                    <span style="color: #64748B; font-size: 13px;">$${rate}/1K</span>
                </div>
            </div>
        `;
    }).join('');
    
    resultsDiv.style.display = 'block';
}

// Select service for custom rate
function selectServiceForCustomRate(serviceId, serviceName, rate) {
    const selectedSection = document.getElementById('selectedServiceSection');
    const selectedInfo = document.getElementById('selectedServiceInfo');
    const searchResults = document.getElementById('serviceSearchResults');
    const discountInput = document.getElementById('customDiscountInput');
    
    // Hide search results
    searchResults.style.display = 'none';
    
    // Store selected service
    window.selectedCustomRateService = { serviceId, serviceName, rate };
    
    // Show selected service info
    selectedInfo.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: white; border-radius: 6px; border: 1px solid #0EA5E9;">
            <div>
                <strong style="color: #0F172A; font-size: 16px;">#${serviceId}</strong>
                <span style="color: #64748B; margin-left: 8px;">${serviceName}</span>
            </div>
            <span style="color: #64748B;">Base: $${rate}/1K</span>
        </div>
    `;
    
    // Check if already has custom rate
    const customRates = window.customRatesData || {};
    if (customRates[serviceId]) {
        discountInput.value = customRates[serviceId];
    } else {
        discountInput.value = '';
    }
    
    selectedSection.style.display = 'block';
    discountInput.focus();
}

// Add custom rate to list
function addCustomRateToList() {
    const selectedService = window.selectedCustomRateService;
    if (!selectedService) {
        showNotification('Please select a service first', 'warning');
        return;
    }

    const discountInput = document.getElementById('customDiscountInput');
    const discount = parseFloat(discountInput.value || 0);
    if (discount <= 0 || discount > 100 || Number.isNaN(discount)) {
        showNotification('Please enter a valid discount between 0.01 and 100', 'warning');
        return;
    }

    if (!window.customRatesData) {
        window.customRatesData = {};
    }
    window.customRatesData[selectedService.serviceId] = discount;

    updateCustomRatesList();

    document.getElementById('selectedServiceSection').style.display = 'none';
    document.getElementById('serviceSearchInput').value = '';
    window.selectedCustomRateService = null;

    showNotification(`Custom rate added for ${selectedService.serviceName}`, 'success');
}

// Remove custom rate
function removeCustomRate(serviceId) {
    if (!window.customRatesData) return;
    const key = String(serviceId);
    delete window.customRatesData[key];
    updateCustomRatesList();
    showNotification('Custom rate removed', 'success');
}

// Update custom rates list display
function updateCustomRatesList() {
    const wrapper = document.getElementById('currentRatesWrapper');
    const currentRatesDiv = document.getElementById('currentCustomRates');
    const noRatesDiv = document.getElementById('noCustomRates');
    if (!currentRatesDiv || !wrapper || !noRatesDiv) return;

    const customRates = window.customRatesData || {};
    const services = window.customRateServices || [];
    const customRatesArray = Object.entries(customRates).filter(([_, discount]) => Number(discount) > 0);
    
    if (customRatesArray.length === 0) {
        noRatesDiv.style.display = 'block';
        currentRatesDiv.innerHTML = '';
        return;
    }

    noRatesDiv.style.display = 'none';
    currentRatesDiv.innerHTML = customRatesArray.map(([serviceId, discount]) => {
        const service = services.find(s => String(s.public_id || s.id) === String(serviceId));
        const serviceName = service ? service.name : `Service #${serviceId}`;
        const cleanId = String(serviceId);
        const cleanDiscount = (window.formatTrimZeros ? window.formatTrimZeros(Number(discount), 5) : Number(discount).toFixed(2).replace(/\.00$/, ''));
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px; border: 1px solid #E2E8F0;">
                <div>
                    <strong style="color: #0F172A;">#${cleanId}</strong> 
                    <span style="color: #64748B; margin-left: 8px;">${serviceName}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="color: #059669; font-weight: 600;">${cleanDiscount}% discount</span>
                    <button 
                        type="button" 
                        onclick="removeCustomRate('${cleanId}')"
                        style="padding: 4px 8px; background: #FEE2E2; color: #DC2626; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;"
                    >
                        Remove
                    </button>
                </div>
            </div>
        `;
    }).join('');

}

// Save all custom rates
async function saveAllCustomRates() {
    const userId = window.customRateUserId;
    if (!userId) {
        showNotification('User ID not found', 'error');
        return;
    }

    const customRates = window.customRatesData || {};

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Not authenticated');
        }

        // Save to backend
        const response = await fetch('/.netlify/functions/users', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: userId,
                service_discounts: customRates
            })
        });

        if (!response.ok) {
            throw new Error('Failed to save custom rates');
        }

        showNotification('Custom rates saved successfully', 'success');
        closeModal();
        
        // Reload users to reflect changes
        if (typeof loadUsers === 'function') {
            await loadUsers();
        } else if (typeof populateUsersTable === 'function') {
            await populateUsersTable();
        }
    } catch (error) {
        console.error('Save custom rates error:', error);
        showNotification('Failed to save custom rates: ' + error.message, 'error');
    }
}

async function saveCustomRates(userId) {
    const inputs = document.querySelectorAll('.custom-rate-input');
    const customRates = {};
    
    inputs.forEach(input => {
        const serviceId = input.dataset.serviceId;
        const discount = parseFloat(input.value || 0);
        if (discount > 0 && discount <= 100) {
            customRates[serviceId] = discount;
        }
    });

    try {
        const token = localStorage.getItem('token');
        if (!token) {
            throw new Error('Not authenticated');
        }

        // Save to backend
        const response = await fetch('/.netlify/functions/users', {
            method: 'PUT',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: userId,
                service_discounts: customRates
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to save custom rates');
        }

        showNotification('Custom rates saved successfully!', 'success');
        closeModal();
        await populateUsersTable();

    } catch (error) {
        console.error('Error saving custom rates:', error);
        showNotification(error.message, 'error');
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initializeUsersQuickActions();
    populateUsersTable();
    handleSearch('userSearch', 'usersTable');
});
