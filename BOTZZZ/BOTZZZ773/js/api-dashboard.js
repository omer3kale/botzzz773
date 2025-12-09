// API Dashboard JavaScript with Encryption

let isPopupMode = false;
let authGuardTriggered = false;
let authToken = null;
let userProfile = null;

const AUTH_ALERT_MESSAGE = 'You must be signed in to access the API dashboard. Please sign in or create an account.';

function enablePopupSurface() {
    document.body.classList.add('popup-mode');
    const panel = document.querySelector('[data-popup-surface]');
    if (panel) {
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'API dashboard window');
        panel.setAttribute('tabindex', '-1');
        requestAnimationFrame(() => panel.focus());
    }

    const closeButton = document.querySelector('[data-popup-close]');
    if (closeButton) {
        closeButton.addEventListener('click', handlePopupClose);
    }

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            handlePopupClose();
        }
    });
}

function handlePopupClose() {
    if (window.opener && !window.opener.closed) {
        window.opener.focus();
        window.close();
        return;
    }

    document.body.classList.remove('popup-mode');
    const panel = document.querySelector('[data-popup-surface]');
    if (panel) {
        panel.removeAttribute('role');
        panel.removeAttribute('aria-modal');
        panel.removeAttribute('tabindex');
    }
    const closeButton = document.querySelector('[data-popup-close]');
    if (closeButton) {
        closeButton.style.display = 'none';
    }
}

function notifyOpener(payload) {
    if (!isPopupMode || !window.opener || window.opener.closed) {
        return;
    }
    try {
        window.opener.postMessage(payload, window.location.origin);
    } catch (error) {
        console.warn('[API DASHBOARD] Failed to notify opener.', error);
    }
}

// Security Constants
const ENCRYPTION_KEY = 'BOTZZZ773_SECURE_KEY_2025'; // In production, use user-specific key

// Security Helper: Encrypt API key
function encryptApiKey(apiKey) {
    try {
        const encrypted = CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
        return encrypted;
    } catch (error) {
        console.error('Encryption error:', error);
        return apiKey; // Fallback to plain text if encryption fails
    }
}

// Security Helper: Decrypt API key
function decryptApiKey(encryptedKey) {
    try {
        const decrypted = CryptoJS.AES.decrypt(encryptedKey, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8);
        return decrypted || encryptedKey; // Fallback if decryption fails
    } catch (error) {
        console.error('Decryption error:', error);
        return encryptedKey; // Fallback to encrypted text if decryption fails
    }
}

// Modal functions
function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
    }
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
    }
}

// Generate random API key with secure format
function generateRandomKey() {
    // Generate a secure random API key
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const specialChars = '!@#$%^&*';
    let key = '';
    
    // Generate 48 random characters for maximum security
    for (let i = 0; i < 48; i++) {
        if (i > 0 && i % 12 === 0) {
            // Add dash separator every 12 characters for readability
            key += '-';
        }
        // Mix in special characters occasionally for added security
        if (i % 15 === 7) {
            key += specialChars.charAt(Math.floor(Math.random() * specialChars.length));
        } else {
            key += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    }
    
    // SECURITY: Encrypt the key before storing
    return encryptApiKey(key);
}

// Copy API key function
function copyApiKey() {
    const apiKeyElement = document.getElementById('generatedApiKey');
    const apiKey = apiKeyElement.textContent;
    
    navigator.clipboard.writeText(apiKey).then(() => {
        showMessage('API key copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Failed to copy:', err);
        showMessage('Failed to copy API key', 'error');
    });
}

// Update balance display element
function updateBalanceDisplay(balance) {
    const balanceEl = document.getElementById('currentBalance');
    if (balanceEl && Number.isFinite(balance)) {
        balanceEl.textContent = '$' + balance.toFixed(2);
    }
}

// Load user balance from backend
async function loadUserBalance(context = {}) {
    try {
        const token = resolveAuthToken('load-balance');
        if (!token) {
            return null;
        }
        
        const response = await fetch('/.netlify/functions/users?action=me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch user data');
        }
        
        const data = await response.json();
        
        if (data.success && data.user) {
            const balance = Number(data.user.balance);
            if (Number.isFinite(balance)) {
                updateBalanceDisplay(balance);
                
                // Update BalanceSync
                if (window.BalanceSync) {
                    window.BalanceSync.setUser(data.user, { reason: context.reason || 'api-dashboard-refresh' });
                }
                
                // Update local storage
                userProfile = data.user;
                localStorage.setItem('user', JSON.stringify(data.user));
            }
            return data.user;
        }
        return null;
    } catch (error) {
        console.error('Failed to load user balance:', error);
        return null;
    }
}

// Update dashboard stats from backend
async function updateDashboardStats() {
    try {
        const token = resolveAuthToken('dashboard-stats');
        if (!token) {
            return;
        }
        
        const response = await fetch('/.netlify/functions/dashboard', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            document.getElementById('totalRequests').textContent = (data.totalRequests || 0).toLocaleString();
            document.getElementById('totalOrders').textContent = (data.totalOrders || 0).toLocaleString();
            const activeServicesEl = document.getElementById('activeServices');
            if (activeServicesEl) {
                activeServicesEl.textContent = (data.activeServices || data.activeProviders || 0);
            }
            document.getElementById('totalSpent').textContent = '$' + (data.totalSpent || 0).toFixed(2);
            
            // Also update balance if returned from dashboard endpoint
            if (Number.isFinite(data.balance)) {
                updateBalanceDisplay(data.balance);
            }
        }
    } catch (error) {
        console.error('Failed to load dashboard stats:', error);
        // Set default values on error
        document.getElementById('totalRequests').textContent = '0';
        document.getElementById('totalOrders').textContent = '0';
        const activeServicesEl = document.getElementById('activeServices');
        if (activeServicesEl) {
            activeServicesEl.textContent = '0';
        }
        document.getElementById('totalSpent').textContent = '$0.00';
    }
}

// Render API keys list from backend
async function renderApiKeys() {
    const container = document.getElementById('apiKeysList');
    if (!container) return; // Element removed from DOM
    
    try {
        const token = resolveAuthToken('render-api-keys');
        if (!token) {
            container.innerHTML = '<div class="empty-state"><p>Please login to view API keys</p></div>';
            return;
        }
        
        const response = await fetch('/.netlify/functions/api-keys', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        const apiKeys = data.keys || data.apiKeys || [];
        
        if (apiKeys.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    <h3>No API Keys Yet</h3>
                    <p>Generate your first API key to start integrating our services</p>
                    <button class="btn-primary" onclick="document.getElementById('generateKeyBtn').click()">Generate API Key</button>
                </div>
            `;
            return;
        }
        
        container.innerHTML = apiKeys.map(key => {
            // Show full key for easy sharing with providers like Goupsocial
            const decryptedKey = decryptApiKey(key.key);
            
            return `
            <div class="api-key-card">
                <div class="api-key-header">
                    <div class="api-key-info">
                        <h3>${key.name}</h3>
                        <span class="api-key-date">Created ${new Date(key.created).toLocaleDateString()}</span>
                    </div>
                    <div class="api-key-actions">
                        <button class="btn-icon" onclick="copyKeyToClipboard('${key.key}')" title="Copy API Key">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                        </button>
                        <button class="btn-icon danger" onclick="deleteApiKey('${key.id}')" title="Delete API Key">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="api-key-display-hidden">
                    <code>${decryptedKey}</code>
                </div>
                <div class="api-key-stats">
                    <div class="key-stat">
                        <span class="key-stat-label">Requests</span>
                        <span class="key-stat-value">${key.requests || 0}</span>
                    </div>
                    <div class="key-stat">
                        <span class="key-stat-label">Last Used</span>
                        <span class="key-stat-value">${key.lastUsed ? new Date(key.lastUsed).toLocaleDateString() : 'Never'}</span>
                    </div>
                </div>
                <div class="api-key-permissions">
                    ${key.permissions.map(p => `<span class="permission-badge">${p}</span>`).join('')}
                </div>
            </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Failed to load API keys:', error);
        container.innerHTML = '<div class="empty-state"><p>Failed to load API keys</p></div>';
    }
}

// Copy key to clipboard with decryption
function copyKeyToClipboard(encryptedKey) {
    // SECURITY: Decrypt key before copying
    const decryptedKey = decryptApiKey(encryptedKey);
    
    navigator.clipboard.writeText(decryptedKey).then(() => {
        showMessage('API key copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Failed to copy:', err);
        showMessage('Failed to copy API key', 'error');
    });
}

// Delete API key from backend
async function deleteApiKey(keyId) {
    if (!confirm('Are you sure you want to delete this API key? This action cannot be undone.')) {
        return;
    }
    
    try {
        const token = resolveAuthToken('delete-api-key');
        if (!token) {
            return;
        }
        
        const response = await fetch('/.netlify/functions/api-keys', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ keyId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage('API key deleted successfully', 'success');
            renderApiKeys();
            notifyOpener({ type: 'API_KEY_DELETED', keyId });
        } else {
            showMessage(data.error || 'Failed to delete API key', 'error');
        }
    } catch (error) {
        console.error('Delete API key error:', error);
        showMessage('Failed to delete API key', 'error');
    }
}

// Render providers list from backend
async function renderProviders() {
    const container = document.getElementById('providersList');
    if (!container) return; // Element removed from DOM
    
    try {
        const token = resolveAuthToken('render-providers');
        if (!token) {
            container.innerHTML = '<div class="empty-state"><p>Please login to view providers</p></div>';
            return;
        }
        
        const response = await fetch('/.netlify/functions/providers', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        const providers = data.providers || [];
        
        if (providers.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                    <h3>No Providers Connected</h3>
                    <p>Add your first provider to import services and automate order fulfillment</p>
                </div>
            `;
            return;
        }
        
        container.innerHTML = providers.map(provider => `
            <div class="provider-card">
                <div class="provider-header">
                    <div class="provider-info">
                        <h3>${provider.name}</h3>
                        <span class="provider-url">${provider.api_url || provider.apiUrl}</span>
                    </div>
                    <span class="provider-status ${provider.status}">
                        ${provider.status === 'active' ? '● Active' : '● Inactive'}
                    </span>
                </div>
                <div class="provider-stats-grid">
                    <div class="provider-stat">
                        <span class="provider-stat-label">Services</span>
                        <span class="provider-stat-value">${provider.services_count || provider.servicesCount || 0}</span>
                    </div>
                    <div class="provider-stat">
                        <span class="provider-stat-label">Orders</span>
                        <span class="provider-stat-value">${provider.orders_count || provider.ordersCount || 0}</span>
                    </div>
                    <div class="provider-stat">
                        <span class="provider-stat-label">Markup</span>
                        <span class="provider-stat-value">${provider.markup}%</span>
                    </div>
                    <div class="provider-stat">
                        <span class="provider-stat-label">Added</span>
                        <span class="provider-stat-value">${new Date(provider.created_at || provider.created).toLocaleDateString()}</span>
                    </div>
                </div>
                <div class="provider-actions">
                    <button class="btn-secondary btn-sm" onclick="syncProvider('${provider.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                        Sync Services
                    </button>
                    <button class="btn-secondary btn-sm" onclick="editProvider('${provider.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                        Edit
                    </button>
                    <button class="btn-icon danger" onclick="deleteProvider('${provider.id}')">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to load providers:', error);
        container.innerHTML = '<div class="empty-state"><p>Failed to load providers</p></div>';
    }
}

// Sync provider services with backend
async function syncProvider(providerId) {
    try {
        showMessage('Syncing services...', 'info');
        
        const token = resolveAuthToken('sync-provider');
        if (!token) {
            return;
        }
        
        const response = await fetch('/.netlify/functions/providers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'sync',
                providerId
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage(`Successfully synced ${data.servicesCount || 0} services`, 'success');
            notifyOpener({
                type: 'PROVIDER_SYNCED',
                providerId,
                servicesCount: data.servicesCount || 0
            });
            renderProviders();
            updateDashboardStats();
        } else {
            showMessage(data.error || 'Failed to sync provider', 'error');
        }
    } catch (error) {
        console.error('Sync provider error:', error);
        showMessage('Failed to sync provider', 'error');
    }
}

// Edit provider
function editProvider(providerId) {
    showMessage('Edit provider functionality coming soon', 'info');
}

// Delete provider from backend
async function deleteProvider(providerId) {
    if (!confirm('Are you sure you want to delete this provider? All imported services will be removed.')) {
        return;
    }
    
    try {
        const token = resolveAuthToken('delete-provider');
        if (!token) {
            return;
        }
        
        const response = await fetch('/.netlify/functions/providers', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ providerId })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showMessage('Provider deleted successfully', 'success');
            notifyOpener({ type: 'PROVIDER_DELETED', providerId });
            renderProviders();
            updateDashboardStats();
        } else {
            showMessage(data.error || 'Failed to delete provider', 'error');
        }
    } catch (error) {
        console.error('Delete provider error:', error);
        showMessage('Failed to delete provider', 'error');
    }
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    isPopupMode = urlParams.get('popup') === '1';
    if (isPopupMode) {
        enablePopupSurface();
    }

    authToken = resolveAuthToken('initial-load');
    userProfile = resolveUserProfile('initial-load');
    if (!authToken || !userProfile) {
        return;
    }

    // Initialize BalanceSync for real-time balance updates
    if (window.BalanceSync) {
        window.BalanceSync.configure({
            fetcher: (context = {}) => loadUserBalance(context)
        });
        
        // Subscribe to balance changes
        window.BalanceSync.subscribe(({ balance }) => {
            if (Number.isFinite(balance)) {
                updateBalanceDisplay(balance);
            }
        });
        
        // Set initial balance from user profile
        if (userProfile && Number.isFinite(userProfile.balance)) {
            window.BalanceSync.setUser(userProfile, { reason: 'api-dashboard-init' });
            updateBalanceDisplay(userProfile.balance);
        }
    }

    // Initialize dashboard
    updateDashboardStats();
    loadUserBalance({ reason: 'page-load' }); // Load fresh balance
    
    // Only render API keys if the container exists
    if (document.getElementById('apiKeysList')) {
        renderApiKeys();
    }
    
    // Only render providers if the container exists
    if (document.getElementById('providersList')) {
        renderProviders();
    }
    
    // Generate API Key button (if exists)
    const generateKeyBtn = document.getElementById('generateKeyBtn');
    if (generateKeyBtn) {
        generateKeyBtn.addEventListener('click', function() {
            openModal('generateKeyModal');
        });
    }
    
    // Generate API Key form (if exists)
    const generateKeyForm = document.getElementById('generateKeyForm');
    if (generateKeyForm) {
        generateKeyForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const submitBtn = generateKeyForm.querySelector('button[type="submit"]');
        const originalBtnText = submitBtn ? submitBtn.textContent : '';
        
        const keyName = document.getElementById('keyName').value;
        const permissions = Array.from(document.querySelectorAll('#generateKeyForm input[type="checkbox"]:checked'))
            .map(cb => cb.value);
        
        // Validation
        if (!keyName || keyName.trim().length === 0) {
            showMessage('API key name is required', 'error');
            return;
        }
        
        if (keyName.length > 100) {
            showMessage('API key name must be less than 100 characters', 'error');
            return;
        }
        
        if (permissions.length === 0) {
            showMessage('Please select at least one permission', 'error');
            return;
        }
        
        // Disable submit button
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating...';
        }
        
        try {
            const token = resolveAuthToken('generate-api-key');
            if (!token) {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                }
                showMessage('Authentication required. Please sign in again.', 'error');
                return;
            }
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
            
            const response = await fetch('/.netlify/functions/api-keys', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: keyName.trim(),
                    permissions: permissions
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            let data;
            try {
                data = await response.json();
            } catch (parseError) {
                console.error('[API-DASHBOARD] Failed to parse API response:', parseError);
                // If response is 201 (created) but JSON parse failed, still check if key was created
                if (response.status === 201) {
                    console.warn('[API-DASHBOARD] Got 201 status but could not parse JSON - key may have been created');
                    showMessage('API key may have been created. Please refresh the page to check.', 'warning');
                    // Attempt to refresh keys list
                    await renderApiKeys().catch(err => console.warn('[API-DASHBOARD] Could not refresh keys:', err));
                }
                throw new Error('Invalid response from server. Please try again.');
            }
            
            // Check for successful creation - must have all three: response.ok, data.success, and data.key
            if (response.ok && data.success && data.key) {
                console.log('[API-DASHBOARD] API key created successfully:', {
                    name: keyName,
                    permissions: permissions,
                    keyPrefix: data.key.substring(0, 10)
                });
                
                // Show the key in modal
                const keyElement = document.getElementById('generatedApiKey');
                if (keyElement) {
                    keyElement.textContent = data.key;
                } else {
                    console.warn('[API-DASHBOARD] generatedApiKey element not found');
                }
                
                closeModal('generateKeyModal');
                openModal('apiKeyModal');
                
                // Reset form
                generateKeyForm.reset();
                
                // Re-render keys list
                await renderApiKeys().catch(err => {
                    console.warn('[API-DASHBOARD] Failed to refresh keys list:', err);
                });
                
                // Notify parent window if in iframe/popup
                notifyOpener({
                    type: 'API_KEY_CREATED',
                    name: keyName,
                    permissions: permissions,
                    success: true
                });
                
                showMessage('API key created successfully! Make sure to copy it now.', 'success');
            } else if (response.status === 201 && (!data.success || !data.key)) {
                // Edge case: backend returned 201 but response is incomplete
                console.error('[API-DASHBOARD] Got 201 status but incomplete data:', data);
                showMessage('API key may have been created but response was incomplete. Please refresh to verify.', 'warning');
                // Attempt to refresh keys list to show potentially created key
                await renderApiKeys().catch(err => console.warn('[API-DASHBOARD] Could not refresh keys:', err));
            } else if (response.status === 401 || response.status === 403) {
                console.error('[API-DASHBOARD] Authentication failed:', response.status);
                showMessage('Session expired. Please sign in again.', 'error');
                setTimeout(() => {
                    window.location.href = 'signin.html';
                }, 2000);
            } else if (response.status === 400) {
                console.error('[API-DASHBOARD] Validation error:', data);
                showMessage(data.error || 'Invalid request. Please check your input.', 'error');
            } else if (response.status === 500) {
                console.error('[API-DASHBOARD] Server error:', data);
                showMessage('Server error. Please try again later.', 'error');
            } else {
                console.error('[API-DASHBOARD] API key creation failed:', {
                    status: response.status,
                    statusText: response.statusText,
                    data: data
                });
                showMessage(data.error || data.message || 'Failed to generate API key. Please try again.', 'error');
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.error('[API-DASHBOARD] Request timeout:', error);
                showMessage('Request timed out. Please check your connection and try again.', 'error');
            } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
                console.error('[API-DASHBOARD] Network error:', error);
                showMessage('Network error. Please check your connection and try again.', 'error');
            } else {
                console.error('[API-DASHBOARD] Unexpected error during API key generation:', error);
                showMessage(error.message || 'An unexpected error occurred. Please try again.', 'error');
            }
        } finally {
            // Re-enable submit button
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            }
        }
    });
    }
    
    // Add Provider button (if exists)
    const addProviderBtn = document.getElementById('addProviderBtn');
    if (addProviderBtn) {
        addProviderBtn.addEventListener('click', function() {
            openModal('addProviderModal');
        });
    }
    
    // Add Provider form (if exists)
    const addProviderForm = document.getElementById('addProviderForm');
    if (addProviderForm) {
        addProviderForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const providerName = document.getElementById('providerName').value;
        const providerApiKey = document.getElementById('providerApiKey').value;
        
        // Show loading
        const submitBtn = this.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Adding Provider...</span>';
        
        try {
            // Get auth token
            const token = resolveAuthToken('add-provider');
            if (!token) {
                return;
            }

            // Call backend to create provider
            const response = await fetch('/.netlify/functions/providers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    action: 'create',
                    name: providerName,
                    apiKey: providerApiKey,
                    status: 'active'
                })
            });

            const data = await response.json();

            if (data.success) {
                // Success - show modal
                document.getElementById('providerSuccessTitle').textContent = `${providerName} Added!`;
                document.getElementById('importedServicesCount').textContent = '0';
                document.getElementById('importedCategoriesCount').textContent = '0';
                
                closeModal('addProviderModal');
                openModal('providerSuccessModal');
                
                // Reset form
                document.getElementById('addProviderForm').reset();
                
                // Re-render providers
                const providerId = (data.provider && data.provider.id) || data.providerId || null;
                notifyOpener({
                    type: 'PROVIDER_ADDED',
                    providerName,
                    providerId
                });
                renderProviders();
                updateDashboardStats();
            } else {
                alert(data.error || 'Failed to add provider');
            }
        } catch (error) {
            console.error('Add provider error:', error);
            alert('Failed to add provider. Please try again.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
        });
    }
    
    // Close modals when clicking outside
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeModal(this.id);
            }
        });
    });
});

function resolveAuthToken(reason) {
    const token = getAuthToken();
    // Optional auth - don't block if no token
    return token;
}

function getAuthToken() {
    try {
        const token = localStorage.getItem('token');
        if (token) {
            authToken = token;
        }
        return token;
    } catch (error) {
        console.warn('[API DASHBOARD] Unable to read auth token.', error);
        return null;
    }
}

function resolveUserProfile(reason) {
    const profile = getStoredUser();
    // Optional auth - don't block if no profile
    return profile;
}
}

function getStoredUser() {
    try {
        const raw = localStorage.getItem('user');
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        userProfile = parsed;
        return parsed;
    } catch (error) {
        console.warn('[API DASHBOARD] Failed to parse user profile.', error);
        localStorage.removeItem('user');
        return null;
    }
}

function handleMissingAuth(reason) {
    // Allow public access to API dashboard - just log the reason
    console.debug('[API DASHBOARD] Auth check skipped (public mode).', { reason });
    return;
}

function buildRedirectTarget() {
    const path = window.location.pathname.replace(/^\/+/, '');
    const search = window.location.search || '';
    return search ? `${path}${search}` : path;
}

