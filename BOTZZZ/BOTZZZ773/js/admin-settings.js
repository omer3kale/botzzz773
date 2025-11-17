// Admin Settings Management with Full Panel Implementation
// Note: createModal() and closeModal() are now in admin.js (shared across all pages)

let settingsProvidersCache = [];
let settingsProvidersLoading = false;
let lastSettingsProvidersRefreshAt = null;

const SETTINGS_SECTION_CONFIG = {
    general: {
        formId: 'generalSettingsForm',
        action: 'update-general',
        successMessage: 'General settings saved successfully!',
        storageKey: 'general'
    },
    payment: {
        formId: 'paymentSettingsForm',
        action: 'update-payment',
        successMessage: 'Payment settings saved successfully!',
        storageKey: 'payment'
    },
    notification: {
        formId: 'notificationSettingsForm',
        action: 'update-notification',
        successMessage: 'Notification settings saved successfully!',
        storageKey: 'notification'
    },
    bonus: {
        formId: 'bonusSettingsForm',
        action: 'update-bonus',
        successMessage: 'Bonus settings saved successfully!',
        storageKey: 'bonus'
    },
    signup: {
        formId: 'signupSettingsForm',
        action: 'update-signup',
        successMessage: 'Signup settings saved successfully!',
        storageKey: 'signup'
    },
    ticket: {
        formId: 'ticketSettingsForm',
        action: 'update-ticket',
        successMessage: 'Ticket settings saved successfully!',
        storageKey: 'ticket'
    },
    modules: {
        formId: 'modulesSettingsForm',
        action: 'update-modules',
        successMessage: 'Module settings saved successfully!',
        storageKey: 'modules'
    },
    integrations: {
        formId: 'integrationsSettingsForm',
        action: 'update-integrations',
        successMessage: 'Integration settings saved successfully!',
        storageKey: 'integrations'
    }
};

const SETTINGS_UI_SECTION_MAP = {
    general: 'general',
    payments: 'payment',
    notifications: 'notification',
    bonuses: 'bonus',
    signup: 'signup',
    ticket: 'ticket',
    modules: 'modules',
    integrations: 'integrations'
};

let adminSettingsCache = null;
let adminSettingsPromise = null;

function attachSettingsQuickActionCard(element, handler) {
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

function setSettingsRefreshStatus(message) {
    const statusEl = document.getElementById('settingsRefreshStatus');
    if (statusEl) {
        statusEl.textContent = message;
    }
}

function updateSettingsProvidersSummary() {
    const countEl = document.getElementById('settingsProvidersCount');
    const detailEl = document.getElementById('settingsProvidersDetail');
    const cardEl = document.getElementById('settingsProvidersCard');

    if (!countEl || !detailEl || !cardEl) {
        return;
    }

    const total = settingsProvidersCache.length;
    const active = settingsProvidersCache.filter(provider => (provider.status || '').toLowerCase() === 'active').length;

    if (total === 0) {
        countEl.textContent = 'No providers';
        detailEl.textContent = 'Connect an SMM provider to start syncing services.';
    } else {
        countEl.textContent = `${active} active of ${total}`;
        if (active === total) {
            detailEl.textContent = 'All providers are active and ready to sync services.';
        } else if (active === 0) {
            detailEl.textContent = 'All providers are currently inactive. Enable at least one to sync.';
        } else {
            const paused = total - active;
            detailEl.textContent = `${paused} provider${paused === 1 ? '' : 's'} paused. Review status before syncing.`;
        }
    }

    cardEl.classList.toggle('is-active', total > 0);
    cardEl.setAttribute('aria-pressed', total > 0 ? 'true' : 'false');
}

function updateSettingsModulesSummary() {
    const primaryEl = document.getElementById('settingsModulesStatus');
    const detailEl = document.getElementById('settingsModulesDetail');
    const cardEl = document.getElementById('settingsModulesCard');

    if (!primaryEl || !detailEl || !cardEl) {
        return;
    }

    const toggles = document.querySelectorAll('#modules-section input[type="checkbox"]');
    if (toggles.length === 0) {
        primaryEl.textContent = 'Feature controls';
        detailEl.textContent = 'Open the modules panel to review available features.';
        cardEl.classList.remove('is-active');
        cardEl.setAttribute('aria-pressed', 'false');
        return;
    }

    const enabled = Array.from(toggles).filter(toggle => toggle.checked).length;
    const total = toggles.length;
    primaryEl.textContent = `${enabled} of ${total} features on`;
    detailEl.textContent = enabled === total
        ? 'Everything is live. Toggle off modules you do not need.'
        : 'Use quick toggles to enable or pause platform features.';
    cardEl.classList.add('is-active');
    cardEl.setAttribute('aria-pressed', 'true');
}

function scrollToSettingsSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function openSettingsProvidersPanel() {
    showSettingsSection('providers');
    updateSettingsProvidersSummary();
    scrollToSettingsSection('providers-section');
}

function openAddProviderQuickAction() {
    openSettingsProvidersPanel();
    addProvider();
}

function openSettingsModulesPanel() {
    showSettingsSection('modules');
    updateSettingsModulesSummary();
    scrollToSettingsSection('modules-section');
}

function triggerSettingsProvidersRefresh() {
    if (settingsProvidersLoading) {
        showNotification('Providers are already refreshing. Please wait...', 'info');
        return;
    }
    loadProviders();
}

function initializeSettingsQuickActions() {
    attachSettingsQuickActionCard(document.getElementById('settingsProvidersCard'), openSettingsProvidersPanel);
    attachSettingsQuickActionCard(document.getElementById('settingsAddProviderCard'), openAddProviderQuickAction);
    attachSettingsQuickActionCard(document.getElementById('settingsModulesCard'), openSettingsModulesPanel);
    attachSettingsQuickActionCard(document.getElementById('settingsRefreshCard'), triggerSettingsProvidersRefresh);
    updateSettingsProvidersSummary();
    updateSettingsModulesSummary();
    if (!lastSettingsProvidersRefreshAt) {
        setSettingsRefreshStatus('Sync latest updates');
    }
}

// Show settings section
function showSettingsSection(section, navEvent) {
    if (navEvent) {
        navEvent.preventDefault();
    }

    const navItems = document.querySelectorAll('.settings-nav-item');
    navItems.forEach(item => item.classList.remove('active'));

    const targetNav = navEvent?.currentTarget || document.querySelector(`.settings-nav-item[data-section="${section}"]`);
    if (targetNav) {
        targetNav.classList.add('active');
    }

    document.querySelectorAll('.settings-section').forEach(sec => {
        sec.style.display = 'none';
    });

    const sectionElement = document.getElementById(`${section}-section`);
    if (sectionElement) {
        sectionElement.style.display = 'block';
    } else {
        loadSettingsSection(section);
    }

    if (section === 'modules') {
        updateSettingsModulesSummary();
    }
    if (section === 'providers') {
        updateSettingsProvidersSummary();
    }

    if (typeof applyStoredSettingsToSection === 'function') {
        applyStoredSettingsToSection(section);
    }
}

// Load settings section dynamically
function loadSettingsSection(section) {
    const container = document.querySelector('.settings-content');
    const sections = {
        general: generateGeneralSettings(),
        providers: '', // Already in HTML
        payments: generatePaymentSettings(),
        modules: generateModuleSettings(),
        integrations: generateIntegrationSettings(),
        notifications: generateNotificationSettings(),
        bonuses: generateBonusSettings(),
        signup: generateSignupSettings(),
        ticket: generateTicketSettings()
    };
    
    if (sections[section]) {
        // Hide providers section
        const providersSection = document.getElementById('providers-section');
        if (providersSection) providersSection.style.display = 'none';
        
        // Add new section if it doesn't exist
        let sectionEl = document.getElementById(`${section}-section`);
        if (!sectionEl) {
            sectionEl = document.createElement('div');
            sectionEl.id = `${section}-section`;
            sectionEl.className = 'settings-section';
            sectionEl.innerHTML = sections[section];
            container.appendChild(sectionEl);
        }
        sectionEl.style.display = 'block';
        if (section === 'modules') {
            updateSettingsModulesSummary();
        }
        if (typeof applyStoredSettingsToSection === 'function') {
            applyStoredSettingsToSection(section);
        }
    }
}

function isRadioNodeList(element) {
    if (typeof RadioNodeList !== 'undefined' && element instanceof RadioNodeList) {
        return true;
    }
    return Boolean(element && typeof element.length === 'number' && typeof element.item === 'function');
}

function serializeForm(form) {
    const data = {};
    Array.from(form?.elements || []).forEach(field => {
        if (!field.name || field.disabled) {
            return;
        }

        if (field.type === 'checkbox') {
            data[field.name] = field.checked;
            return;
        }

        if (field.type === 'radio') {
            if (field.checked) {
                data[field.name] = field.value;
            } else if (!(field.name in data)) {
                data[field.name] = '';
            }
            return;
        }

        data[field.name] = field.value;
    });
    return data;
}

function populateFormValues(form, values = {}) {
    if (!form) {
        return;
    }

    Object.entries(values).forEach(([name, value]) => {
        const field = form.elements[name];
        if (!field) {
            return;
        }

        if (isRadioNodeList(field)) {
            Array.from(field).forEach(radio => {
                radio.checked = radio.value === String(value);
            });
            return;
        }

        if (field.type === 'checkbox') {
            field.checked = Boolean(value);
            return;
        }

        field.value = value ?? '';
    });
}

function updateSettingsCache(storageKey, values) {
    if (!storageKey) {
        return;
    }
    if (!adminSettingsCache || typeof adminSettingsCache !== 'object') {
        adminSettingsCache = {};
    }
    adminSettingsCache[storageKey] = values;
}

async function getStoredSettings(forceRefresh = false) {
    if (adminSettingsCache && !forceRefresh) {
        return adminSettingsCache;
    }

    if (!adminSettingsPromise || forceRefresh) {
        adminSettingsPromise = fetchSettingsFromServer()
            .then(settings => {
                adminSettingsCache = settings;
                return settings;
            })
            .catch(error => {
                adminSettingsPromise = null;
                throw error;
            });
    }

    return adminSettingsPromise;
}

async function fetchSettingsFromServer() {
    const token = localStorage.getItem('token');
    if (!token) {
        console.warn('[WARN] No auth token found while fetching settings');
        return {};
    }

    try {
        const response = await fetch('/.netlify/functions/settings', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            let errorMessage = 'Failed to load settings';
            try {
                const data = await response.json();
                errorMessage = data.error || errorMessage;
            } catch (parseError) {
                console.warn('[WARN] Non-JSON error while fetching settings');
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        return data.settings || {};
    } catch (error) {
        console.error('[ERROR] Unable to fetch settings:', error);
        if (typeof showNotification === 'function') {
            showNotification('Unable to load existing settings from storage', 'error');
        }
        return {};
    }
}

async function applyStoredSettingsToSection(section) {
    const configKey = SETTINGS_UI_SECTION_MAP[section];
    if (!configKey) {
        return;
    }

    const config = SETTINGS_SECTION_CONFIG[configKey];
    if (!config) {
        return;
    }

    try {
        const settings = await getStoredSettings();
        const values = settings?.[config.storageKey];
        if (!values) {
            return;
        }
        const form = document.getElementById(config.formId);
        populateFormValues(form, values);
    } catch (error) {
        console.warn(`[WARN] Failed to hydrate ${section} settings:`, error);
    }
}

async function submitSettingsSection(configKey) {
    const config = SETTINGS_SECTION_CONFIG[configKey];
    if (!config) {
        console.warn(`[WARN] No settings config found for ${configKey}`);
        return;
    }

    const form = document.getElementById(config.formId);
    if (!form) {
        showNotification('Settings form not found', 'error');
        return;
    }

    const settings = serializeForm(form);

    try {
        await sendSettingsUpdate(config, settings);
        showNotification(config.successMessage, 'success');
    } catch (error) {
        console.error('[ERROR] Failed to save settings:', error);
        showNotification(error.message || 'Failed to save settings', 'error');
    }
}

async function sendSettingsUpdate(config, settings) {
    const token = localStorage.getItem('token');
    if (!token) {
        throw new Error('Please login to save settings');
    }

    const response = await fetch('/.netlify/functions/settings', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
            action: config.action,
            settings
        })
    });

    let data = {};
    try {
        data = await response.json();
    } catch (error) {
        console.warn('[WARN] Non-JSON response while saving settings');
    }

    if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to save settings');
    }

    updateSettingsCache(config.storageKey, settings);
    return data;
}

// Generate General Settings HTML
function generateGeneralSettings() {
    return `
        <div class="settings-header">
            <h2>General Settings</h2>
            <button class="btn-primary" onclick="saveGeneralSettings()">
                <i class="fas fa-save"></i> Save Changes
            </button>
        </div>
        <form id="generalSettingsForm" class="settings-form-grid">
            <div class="settings-card">
                <h3><i class="fas fa-globe"></i> Site Information</h3>
                <div class="form-group">
                    <label>Site Name</label>
                    <input type="text" name="siteName" value="SMM Reseller Panel" required>
                </div>
                <div class="form-group">
                    <label>Site URL</label>
                    <input type="url" name="siteUrl" value="https://smmPanel.com" required>
                </div>
                <div class="form-group">
                    <label>Admin Email</label>
                    <input type="email" name="adminEmail" value="admin@smmPanel.com" required>
                </div>
                <div class="form-group">
                    <label>Support Email</label>
                    <input type="email" name="supportEmail" value="support@smmPanel.com">
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-palette"></i> Appearance</h3>
                <div class="form-group">
                    <label>Brand Color</label>
                    <input type="color" name="brandColor" value="#FF1494">
                </div>
                <div class="form-group">
                    <label>Logo URL</label>
                    <input type="url" name="logoUrl" placeholder="https://...">
                </div>
                <div class="form-group">
                    <label>Favicon URL</label>
                    <input type="url" name="faviconUrl" placeholder="https://...">
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="darkMode" checked>
                        Enable Dark Mode by Default
                    </label>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-users"></i> User Settings</h3>
                <div class="form-group">
                    <label>Default Currency</label>
                    <select name="defaultCurrency">
                        <option value="USD" selected>USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="GBP">GBP (£)</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Default User Rate (%)</label>
                    <input type="number" name="defaultUserRate" value="0" min="0" max="100">
                </div>
                <div class="form-group">
                    <label>Minimum Order Amount</label>
                    <input type="number" name="minOrder" value="1.00" step="0.01">
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="emailVerification">
                        Require Email Verification
                    </label>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-cog"></i> System Settings</h3>
                <div class="form-group">
                    <label>Timezone</label>
                    <select name="timezone">
                        <option value="UTC" selected>UTC</option>
                        <option value="America/New_York">Eastern Time</option>
                        <option value="Europe/London">London</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Date Format</label>
                    <select name="dateFormat">
                        <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                        <option value="DD/MM/YYYY" selected>DD/MM/YYYY</option>
                        <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="maintenanceMode">
                        Maintenance Mode
                    </label>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="debugMode">
                        Debug Mode
                    </label>
                </div>
            </div>
        </form>
    `;
}

// Generate Payment Settings HTML
function generatePaymentSettings() {
    return `
        <div class="settings-header">
            <h2>Payment Settings</h2>
            <button class="btn-primary" onclick="savePaymentSettings()">
                <i class="fas fa-save"></i> Save Changes
            </button>
        </div>
        <form id="paymentSettingsForm" class="settings-form-grid">
            <div class="settings-card">
                <h3><i class="fab fa-stripe"></i> Stripe</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="stripeEnabled" checked>
                        Enable Stripe Payments
                    </label>
                </div>
                <div class="form-group">
                    <label>Publishable Key</label>
                    <input type="text" name="stripePublishable" placeholder="pk_live_...">
                </div>
                <div class="form-group">
                    <label>Secret Key</label>
                    <input type="password" name="stripeSecret" placeholder="sk_live_...">
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fab fa-paypal"></i> PayPal</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="paypalEnabled" checked>
                        Enable PayPal Payments
                    </label>
                </div>
                <div class="form-group">
                    <label>Client ID</label>
                    <input type="text" name="paypalClientId" placeholder="AYSq3RDG...">
                </div>
                <div class="form-group">
                    <label>Secret</label>
                    <input type="password" name="paypalSecret" placeholder="ELDhF9W...">
                </div>
                <div class="form-group">
                    <label>Mode</label>
                    <select name="paypalMode">
                        <option value="sandbox">Sandbox</option>
                        <option value="live" selected>Live</option>
                    </select>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fab fa-bitcoin"></i> Cryptocurrency</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="cryptoEnabled">
                        Enable Crypto Payments
                    </label>
                </div>
                <div class="form-group">
                    <label>Bitcoin Address</label>
                    <input type="text" name="btcAddress" placeholder="bc1q...">
                </div>
                <div class="form-group">
                    <label>Ethereum Address</label>
                    <input type="text" name="ethAddress" placeholder="0x...">
                </div>
                <div class="form-group">
                    <label>USDT Address (TRC20)</label>
                    <input type="text" name="usdtAddress" placeholder="T...">
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-university"></i> Bank Transfer</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="bankEnabled">
                        Enable Bank Transfer
                    </label>
                </div>
                <div class="form-group">
                    <label>Bank Name</label>
                    <input type="text" name="bankName" placeholder="Bank of America">
                </div>
                <div class="form-group">
                    <label>Account Number</label>
                    <input type="text" name="accountNumber" placeholder="XXXX-XXXX-XXXX">
                </div>
                <div class="form-group">
                    <label>SWIFT/BIC</label>
                    <input type="text" name="swiftCode" placeholder="BOFAUS3N">
                </div>
            </div>
        </form>
    `;
}

// Generate Module Settings HTML
function generateModuleSettings() {
    return `
        <div class="settings-header">
            <h2>Modules & Features</h2>
            <button class="btn-primary" onclick="saveModuleSettings()">
                <i class="fas fa-save"></i> Save Changes
            </button>
        </div>
        <form id="modulesSettingsForm" class="settings-form-grid">
            <div class="settings-card">
                <h3><i class="fas fa-toggle-on"></i> Core Modules</h3>
                <div class="module-list">
                    <div class="module-item">
                        <div class="module-info">
                            <i class="fas fa-shopping-cart"></i>
                            <div>
                                <strong>Order System</strong>
                                <p>Main ordering functionality</p>
                            </div>
                        </div>
                        <input type="hidden" name="moduleOrders" value="true">
                        <label class="toggle-switch">
                            <input type="checkbox" name="moduleOrders" checked disabled>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="module-item">
                        <div class="module-info">
                            <i class="fas fa-ticket-alt"></i>
                            <div>
                                <strong>Support Tickets</strong>
                                <p>Customer support system</p>
                            </div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" name="moduleTickets" checked onchange="toggleModule('tickets', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="module-item">
                        <div class="module-info">
                            <i class="fas fa-sync-alt"></i>
                            <div>
                                <strong>Subscriptions</strong>
                                <p>Recurring order services</p>
                            </div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" name="moduleSubscriptions" checked onchange="toggleModule('subscriptions', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-plug"></i> Optional Features</h3>
                <div class="module-list">
                    <div class="module-item">
                        <div class="module-info">
                            <i class="fas fa-gift"></i>
                            <div>
                                <strong>Bonus System</strong>
                                <p>Referral and signup bonuses</p>
                            </div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" name="moduleBonuses" onchange="toggleModule('bonuses', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="module-item">
                        <div class="module-info">
                            <i class="fas fa-code"></i>
                            <div>
                                <strong>API Access</strong>
                                <p>Allow users to use API</p>
                            </div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" name="moduleApi" checked onchange="toggleModule('api', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="module-item">
                        <div class="module-info">
                            <i class="fas fa-percentage"></i>
                            <div>
                                <strong>Child Panels</strong>
                                <p>Allow reseller accounts</p>
                            </div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" name="moduleChildPanels" onchange="toggleModule('childpanels', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
            </div>
        </form>
    `;
}

// Generate Integration Settings HTML
function generateIntegrationSettings() {
    return `
        <div class="settings-header">
            <h2>Third-Party Integrations</h2>
            <button class="btn-primary" onclick="saveIntegrationSettings()">
                <i class="fas fa-save"></i> Save Changes
            </button>
        </div>
        <form id="integrationsSettingsForm" class="settings-form-grid">
            <div class="settings-card">
                <h3><i class="fab fa-google"></i> Analytics Tracking</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="gaEnabled">
                        Enable Analytics Tracking
                    </label>
                </div>
                <div class="form-group">
                    <label>Analytics Provider</label>
                    <select name="analyticsProvider">
                        <option value="gtag" selected>Google Analytics 4 (gtag)</option>
                        <option value="ua">Universal Analytics (legacy)</option>
                        <option value="custom">Custom Script</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>GA4 Measurement ID</label>
                    <input type="text" name="gaMeasurementId" placeholder="G-XXXXXXXXXX">
                </div>
                <div class="form-group">
                    <label>Universal Analytics ID</label>
                    <input type="text" name="gaTrackingId" placeholder="UA-XXXXXXXXX-X">
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="analyticsAutoPageview" checked>
                        Auto track page views
                    </label>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fab fa-facebook"></i> Facebook Pixel</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="fbPixelEnabled">
                        Enable Facebook Pixel
                    </label>
                </div>
                <div class="form-group">
                    <label>Pixel ID</label>
                    <input type="text" name="fbPixelId" placeholder="XXXXXXXXXXXXXXX">
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-comments"></i> Live Chat</h3>
                <div class="form-group">
                    <label>Chat Provider</label>
                    <select name="chatProvider">
                        <option value="">None</option>
                        <option value="tawk">Tawk.to</option>
                        <option value="intercom">Intercom</option>
                        <option value="crisp">Crisp</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Widget Code</label>
                    <textarea name="chatCode" rows="4" placeholder="Paste chat widget code"></textarea>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-bug"></i> Error Tracking (Sentry)</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="sentryEnabled">
                        Enable Sentry Monitoring
                    </label>
                </div>
                <div class="form-group">
                    <label>DSN</label>
                    <input type="text" name="sentryDsn" placeholder="https://public@sentry.io/12345">
                </div>
                <div class="form-group">
                    <label>Environment</label>
                    <input type="text" name="sentryEnvironment" placeholder="production">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Traces Sample Rate</label>
                        <input type="number" name="sentryTracesSampleRate" step="0.01" min="0" max="1" placeholder="0.2">
                    </div>
                    <div class="form-group">
                        <label>Replay Sample Rate</label>
                        <input type="number" name="sentryReplaysSessionSampleRate" step="0.01" min="0" max="1" placeholder="0.05">
                    </div>
                </div>
                <div class="form-group">
                    <label>Replay on Error Sample Rate</label>
                    <input type="number" name="sentryReplaysOnErrorSampleRate" step="0.1" min="0" max="1" placeholder="1.0">
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-video"></i> Session Replay (LogRocket)</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="logRocketEnabled">
                        Enable LogRocket Sessions
                    </label>
                </div>
                <div class="form-group">
                    <label>App ID</label>
                    <input type="text" name="logRocketAppId" placeholder="team/app">
                </div>
                <div class="form-group">
                    <label>Release Tag</label>
                    <input type="text" name="logRocketRelease" placeholder="botzzz@1.0.0">
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="logRocketConsoleLogging" checked>
                        Capture console logs
                    </label>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-heartbeat"></i> Uptime Monitoring</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="uptimeEnabled">
                        Enable Heartbeat Endpoint
                    </label>
                </div>
                <div class="form-group">
                    <label>Monitoring Provider</label>
                    <select name="uptimeProvider">
                        <option value="custom" selected>Custom / Netlify</option>
                        <option value="uptime-kuma">Uptime Kuma</option>
                        <option value="betterstack">Better Stack</option>
                        <option value="statuspage">StatusPage</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Heartbeat URL</label>
                    <input type="url" name="uptimeHeartbeatUrl" placeholder="/.netlify/functions/heartbeat">
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Ping Interval (ms)</label>
                        <input type="number" name="uptimePingInterval" placeholder="120000" min="60000">
                    </div>
                    <div class="form-group">
                        <label>Transport</label>
                        <select name="uptimeTransport">
                            <option value="fetch" selected>Fetch</option>
                            <option value="beacon">Navigator Beacon</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fab fa-telegram"></i> Telegram</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="telegramEnabled">
                        Enable Telegram Notifications
                    </label>
                </div>
                <div class="form-group">
                    <label>Bot Token</label>
                    <input type="text" name="telegramToken" placeholder="123456:ABC-DEF...">
                </div>
                <div class="form-group">
                    <label>Chat ID</label>
                    <input type="text" name="telegramChatId" placeholder="123456789">
                </div>
            </div>
        </form>
    `;
}

// Generate Notification Settings HTML
function generateNotificationSettings() {
    return `
        <div class="settings-header">
            <h2>Notification Settings</h2>
            <button class="btn-primary" onclick="saveNotificationSettings()">
                <i class="fas fa-save"></i> Save Changes
            </button>
        </div>
        <div class="settings-form-grid">
            <div class="settings-card">
                <h3><i class="fas fa-envelope"></i> Email Notifications</h3>
                <div class="notification-list">
                    <div class="notification-item">
                        <label>
                            <input type="checkbox" name="emailNewOrder" checked>
                            New Order Placed
                        </label>
                    </div>
                    <div class="notification-item">
                        <label>
                            <input type="checkbox" name="emailOrderComplete" checked>
                            Order Completed
                        </label>
                    </div>
                    <div class="notification-item">
                        <label>
                            <input type="checkbox" name="emailPayment" checked>
                            Payment Received
                        </label>
                    </div>
                    <div class="notification-item">
                        <label>
                            <input type="checkbox" name="emailNewUser">
                            New User Registration
                        </label>
                    </div>
                    <div class="notification-item">
                        <label>
                            <input type="checkbox" name="emailTicket" checked>
                            New Support Ticket
                        </label>
                    </div>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-bell"></i> Admin Notifications</h3>
                <div class="notification-list">
                    <div class="notification-item">
                        <label>
                            <input type="checkbox" name="adminLowBalance" checked>
                            Provider Low Balance Alert
                        </label>
                    </div>
                    <div class="notification-item">
                        <label>
                            <input type="checkbox" name="adminOrderFail" checked>
                            Order Failure Alert
                        </label>
                    </div>
                    <div class="notification-item">
                        <label>
                            <input type="checkbox" name="adminHighRefund">
                            High Refund Rate Warning
                        </label>
                    </div>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-server"></i> SMTP Settings</h3>
                <div class="form-group">
                    <label>SMTP Host</label>
                    <input type="text" name="smtpHost" placeholder="smtp.gmail.com">
                </div>
                <div class="form-group">
                    <label>SMTP Port</label>
                    <input type="number" name="smtpPort" value="587">
                </div>
                <div class="form-group">
                    <label>SMTP Username</label>
                    <input type="text" name="smtpUsername" placeholder="your@email.com">
                </div>
                <div class="form-group">
                    <label>SMTP Password</label>
                    <input type="password" name="smtpPassword">
                </div>
                <div class="form-group">
                    <label>From Email</label>
                    <input type="email" name="smtpFrom" placeholder="noreply@yoursite.com">
                </div>
            </div>
        </div>
    `;
}

// Generate Bonus Settings HTML
function generateBonusSettings() {
    return `
        <div class="settings-header">
            <h2>Bonus & Rewards</h2>
            <button class="btn-primary" onclick="saveBonusSettings()">
                <i class="fas fa-save"></i> Save Changes
            </button>
        </div>
        <div class="settings-form-grid">
            <div class="settings-card">
                <h3><i class="fas fa-user-plus"></i> Signup Bonus</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="signupBonusEnabled" checked>
                        Enable Signup Bonus
                    </label>
                </div>
                <div class="form-group">
                    <label>Bonus Amount</label>
                    <input type="number" name="signupBonusAmount" value="5.00" step="0.01">
                </div>
                <div class="form-group">
                    <label>Minimum Deposit to Unlock</label>
                    <input type="number" name="signupBonusMinDeposit" value="10.00" step="0.01">
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-users"></i> Referral Program</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="referralEnabled">
                        Enable Referral System
                    </label>
                </div>
                <div class="form-group">
                    <label>Commission Rate (%)</label>
                    <input type="number" name="referralRate" value="10" min="0" max="100">
                </div>
                <div class="form-group">
                    <label>Minimum Payout</label>
                    <input type="number" name="referralMinPayout" value="50.00" step="0.01">
                </div>
                <div class="form-group">
                    <label>Commission Type</label>
                    <select name="referralType">
                        <option value="lifetime">Lifetime</option>
                        <option value="first">First Order Only</option>
                        <option value="30days">30 Days</option>
                    </select>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-crown"></i> Loyalty Tiers</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="loyaltyEnabled">
                        Enable Loyalty Tiers
                    </label>
                </div>
                <div class="tier-list">
                    <div class="tier-item">
                        <strong>Bronze</strong>
                        <span>$0 - $100 spent</span>
                        <input type="number" name="bronzeDiscount" value="0" min="0" max="100" style="width: 80px;"> % discount
                    </div>
                    <div class="tier-item">
                        <strong>Silver</strong>
                        <span>$100 - $500 spent</span>
                        <input type="number" name="silverDiscount" value="5" min="0" max="100" style="width: 80px;"> % discount
                    </div>
                    <div class="tier-item">
                        <strong>Gold</strong>
                        <span>$500+ spent</span>
                        <input type="number" name="goldDiscount" value="10" min="0" max="100" style="width: 80px;"> % discount
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Generate Signup Settings HTML
function generateSignupSettings() {
    return `
        <div class="settings-header">
            <h2>Signup Form Settings</h2>
            <button class="btn-primary" onclick="saveSignupSettings()">
                <i class="fas fa-save"></i> Save Changes
            </button>
        </div>
        <div class="settings-form-grid">
            <div class="settings-card">
                <h3><i class="fas fa-user-plus"></i> Registration</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="registrationEnabled" checked>
                        Allow New Registrations
                    </label>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="emailVerificationRequired">
                        Require Email Verification
                    </label>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="recaptchaEnabled">
                        Enable reCAPTCHA
                    </label>
                </div>
                <div class="form-group">
                    <label>reCAPTCHA Site Key</label>
                    <input type="text" name="recaptchaSiteKey" placeholder="6Lc...">
                </div>
                <div class="form-group">
                    <label>reCAPTCHA Secret Key</label>
                    <input type="password" name="recaptchaSecretKey">
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-shield-alt"></i> Password Policy</h3>
                <div class="form-group">
                    <label>Minimum Password Length</label>
                    <input type="number" name="minPasswordLength" value="8" min="6" max="32">
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="requireUppercase" checked>
                        Require Uppercase Letters
                    </label>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="requireNumbers" checked>
                        Require Numbers
                    </label>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="requireSpecialChars">
                        Require Special Characters
                    </label>
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-file-alt"></i> Terms & Conditions</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="termsRequired" checked>
                        Require Terms Acceptance
                    </label>
                </div>
                <div class="form-group">
                    <label>Terms & Conditions URL</label>
                    <input type="url" name="termsUrl" placeholder="https://yoursite.com/terms">
                </div>
                <div class="form-group">
                    <label>Privacy Policy URL</label>
                    <input type="url" name="privacyUrl" placeholder="https://yoursite.com/privacy">
                </div>
            </div>
        </div>
    `;
}

// Generate Ticket Settings HTML
function generateTicketSettings() {
    return `
        <div class="settings-header">
            <h2>Ticket Form Settings</h2>
            <button class="btn-primary" onclick="saveTicketSettings()">
                <i class="fas fa-save"></i> Save Changes
            </button>
        </div>
        <div class="settings-form-grid">
            <div class="settings-card">
                <h3><i class="fas fa-ticket-alt"></i> Ticket System</h3>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="ticketsEnabled" checked>
                        Enable Support Tickets
                    </label>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="guestTickets">
                        Allow Guest Tickets
                    </label>
                </div>
                <div class="form-group">
                    <label>Max Open Tickets per User</label>
                    <input type="number" name="maxOpenTickets" value="5" min="1">
                </div>
                <div class="form-group">
                    <label>Auto-Close After (days)</label>
                    <input type="number" name="autoCloseDays" value="7" min="1">
                </div>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-tags"></i> Ticket Categories</h3>
                <div class="category-list">
                    <div class="category-item">
                        <input type="text" value="Orders" disabled>
                        <button class="btn-icon"><i class="fas fa-trash"></i></button>
                    </div>
                    <div class="category-item">
                        <input type="text" value="Payment" disabled>
                        <button class="btn-icon"><i class="fas fa-trash"></i></button>
                    </div>
                    <div class="category-item">
                        <input type="text" value="Technical" disabled>
                        <button class="btn-icon"><i class="fas fa-trash"></i></button>
                    </div>
                    <div class="category-item">
                        <input type="text" value="Account" disabled>
                        <button class="btn-icon"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
                <button class="btn-secondary btn-sm" onclick="addTicketCategory()">
                    <i class="fas fa-plus"></i> Add Category
                </button>
            </div>

            <div class="settings-card">
                <h3><i class="fas fa-bolt"></i> Priority Levels</h3>
                <div class="priority-list">
                    <div class="priority-item">
                        <span class="priority-badge low">Low</span>
                        <span>Response time: 48 hours</span>
                    </div>
                    <div class="priority-item">
                        <span class="priority-badge medium">Medium</span>
                        <span>Response time: 24 hours</span>
                    </div>
                    <div class="priority-item">
                        <span class="priority-badge high">High</span>
                        <span>Response time: 12 hours</span>
                    </div>
                    <div class="priority-item">
                        <span class="priority-badge urgent">Urgent</span>
                        <span>Response time: 4 hours</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// Save Functions
async function saveGeneralSettings() {
    return submitSettingsSection('general');
}

async function savePaymentSettings() {
    return submitSettingsSection('payment');
}

async function saveNotificationSettings() {
    return submitSettingsSection('notification');
}

async function saveBonusSettings() {
    return submitSettingsSection('bonus');
}

async function saveSignupSettings() {
    return submitSettingsSection('signup');
}

async function saveTicketSettings() {
    return submitSettingsSection('ticket');
}

async function saveModuleSettings() {
    return submitSettingsSection('modules');
}

async function saveIntegrationSettings() {
    return submitSettingsSection('integrations');
}

function toggleModule(module, enabled) {
    showNotification(`${module} module ${enabled ? 'enabled' : 'disabled'}`, 'success');
    updateSettingsModulesSummary();
}

function addTicketCategory() {
    const content = `
        <form id="addCategoryForm" class="admin-form">
            <div class="form-group">
                <label>Category Name *</label>
                <input type="text" name="categoryName" placeholder="e.g., Billing" required>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="addCategoryForm" class="btn-primary">Add Category</button>
    `;
    
    createModal('Add Ticket Category', content, actions);
    
    document.getElementById('addCategoryForm').addEventListener('submit', (e) => {
        e.preventDefault();
        showNotification('Category added successfully!', 'success');
        closeModal();
    });
}

// Provider Management Functions
function addProvider() {
    const content = `
        <form id="addProviderForm" onsubmit="submitAddProvider(event)" class="admin-form">
            <div class="form-group">
                <label>Provider Name *</label>
                <input type="text" name="providerName" placeholder="SMM Provider Inc." required>
            </div>
            <div class="form-group">
                <label>API URL *</label>
                <input type="url" name="apiUrl" placeholder="https://api.provider.com/v2" required>
            </div>
            <div class="form-group">
                <label>API Key *</label>
                <input type="text" name="apiKey" placeholder="Enter API key" required>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Default Markup (%)</label>
                    <input type="number" name="markup" value="15" min="0" max="100">
                </div>
                <div class="form-group">
                    <label>Status</label>
                    <select name="status">
                        <option value="Active" selected>Active</option>
                        <option value="Inactive">Inactive</option>
                    </select>
                </div>
            </div>
        </form>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" form="addProviderForm" class="btn-primary">
            <i class="fas fa-plus"></i> Add Provider
        </button>
    `;
    
    createModal('Add New Provider', content, actions);
}

function submitAddProvider(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const providerData = Object.fromEntries(formData);
    
    // Show loading state
    const submitBtn = document.querySelector('button[form="addProviderForm"]');
    const originalBtnHTML = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }
    
    console.log('[DEBUG] Creating provider:', {
        name: providerData.providerName,
        apiUrl: providerData.apiUrl,
        apiKey: providerData.apiKey ? providerData.apiKey.substring(0, 10) + '...' : undefined,
        markup: parseFloat(providerData.markup) || 15,
        status: (providerData.status || 'Active').toLowerCase()
    });
    
    // Call backend API to add provider
    fetch('/.netlify/functions/providers', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
            action: 'create',
            name: providerData.providerName,
            apiUrl: providerData.apiUrl,
            apiKey: providerData.apiKey,
            markup: parseFloat(providerData.markup) || 15,
            status: (providerData.status || 'Active').toLowerCase()
        })
    })
    .then(response => {
        console.log('[DEBUG] Provider creation response status:', response.status);
        return response.json().then(data => ({
            status: response.status,
            ok: response.ok,
            data
        }));
    })
    .then(({ status, ok, data }) => {
        console.log('[DEBUG] Provider creation response:', { status, ok, data });
        
        if (data.success) {
            showNotification(`Provider "${providerData.providerName}" added successfully!`, 'success');
            closeModal();
            loadProviders();
            // Invalidate services page provider cache
            if (typeof window.invalidateProvidersCache === 'function') {
                window.invalidateProvidersCache();
            }
        } else {
            const errorMsg = data.error || data.message || data.details || 'Failed to create provider';
            console.error('[ERROR] Provider creation failed:', errorMsg);
            showNotification(errorMsg, 'error');
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnHTML;
            }
        }
    })
    .catch(error => {
        console.error('[ERROR] Provider creation exception:', error);
        showNotification(error.message || 'Failed to add provider. Check console for details.', 'error');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHTML;
        }
    });
}

// Load providers from backend
async function loadProviders() {
    const grid = document.getElementById('providersGrid');
    if (!grid) return;

    settingsProvidersLoading = true;
    const refreshCard = document.getElementById('settingsRefreshCard');
    if (refreshCard) {
        refreshCard.classList.add('is-active');
        refreshCard.setAttribute('aria-pressed', 'true');
    }
    setSettingsRefreshStatus('Refreshing...');

    // Show loading state
    grid.innerHTML = '<div class="loading" style="text-align: center; padding: 40px;"><i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: #888;"></i><p style="margin-top: 1rem; color: #888;">Loading providers...</p></div>';

    try {
        const response = await fetch('/.netlify/functions/providers', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success && data.providers) {
            settingsProvidersCache = Array.isArray(data.providers) ? data.providers : [];
            displayProviders(settingsProvidersCache);
            lastSettingsProvidersRefreshAt = new Date();
            const timeText = lastSettingsProvidersRefreshAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setSettingsRefreshStatus(`Updated ${timeText}`);
        } else {
            console.error('Failed to load providers:', data.error);
            settingsProvidersCache = [];
            updateSettingsProvidersSummary();
            setSettingsRefreshStatus('Refresh failed');
            grid.innerHTML = `
                <div class="error-state" style="text-align: center; padding: 40px;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #ef4444; margin-bottom: 1rem;"></i>
                    <p>Failed to load providers</p>
                    <p style="color: #888;">${data.error || 'Unknown error'}</p>
                    <button class="btn-primary" onclick="loadProviders()" style="margin-top: 1rem;">Retry</button>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading providers:', error);
        settingsProvidersCache = [];
        updateSettingsProvidersSummary();
        setSettingsRefreshStatus('Refresh failed');
        grid.innerHTML = `
            <div class="error-state" style="text-align: center; padding: 40px;">
                <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #ef4444; margin-bottom: 1rem;"></i>
                <p>Failed to load providers</p>
                <p style="color: #888;">${error.message}</p>
                <button class="btn-primary" onclick="loadProviders()" style="margin-top: 1rem;">Retry</button>
            </div>
        `;
    } finally {
        settingsProvidersLoading = false;
        if (refreshCard) {
            refreshCard.classList.remove('is-active');
            refreshCard.setAttribute('aria-pressed', 'false');
        }
    }
}

// Display providers in the grid
function displayProviders(providers) {
    const providersGrid = document.getElementById('providersGrid');
    
    if (!providersGrid) return;
    settingsProvidersCache = Array.isArray(providers) ? providers : [];
    updateSettingsProvidersSummary();
    
    if (settingsProvidersCache.length === 0) {
        providersGrid.innerHTML = `
            <div class="empty-state" style="text-align: center; padding: 40px;">
                <i class="fas fa-plug" style="font-size: 3rem; color: #888; margin-bottom: 1rem;"></i>
                <p>No providers configured yet.</p>
                <p style="color: #888;">Click "Add Provider" to get started.</p>
            </div>
        `;
        return;
    }
    
    providersGrid.innerHTML = settingsProvidersCache.map(provider => `
        <div class="provider-card">
            <div class="provider-header">
                <div class="provider-info">
                    <h3>${escapeHtml(provider.name)}</h3>
                    <span class="status-badge ${provider.status === 'active' ? 'completed' : 'pending'}">${provider.status}</span>
                </div>
                <div class="provider-actions">
                    <button class="btn-icon" onclick="editProvider('${provider.id}')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon" onclick="deleteProvider('${provider.id}')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="provider-details">
                <div class="provider-detail-item">
                    <span class="detail-label">API URL:</span>
                    <span class="detail-value">${escapeHtml(provider.api_url)}</span>
                </div>
                <div class="provider-detail-item">
                    <span class="detail-label">API Key:</span>
                    <span class="detail-value">••••••${provider.api_key ? provider.api_key.slice(-4) : '••••'}</span>
                </div>
                <div class="provider-detail-item">
                    <span class="detail-label">Markup:</span>
                    <span class="detail-value">${provider.markup}%</span>
                </div>
            </div>
            <div class="provider-footer">
                <button class="btn-secondary btn-sm" onclick="syncProvider('${provider.id}')">
                    <i class="fas fa-sync"></i> Sync Services
                </button>
                <button class="btn-secondary btn-sm" onclick="testProvider('${provider.id}')">
                    <i class="fas fa-check-circle"></i> Test Connection
                </button>
            </div>
        </div>
    `).join('');
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function editProvider(providerId) {
    console.log('[DEBUG] Editing provider:', providerId);
    
    // Show loading modal first
    createModal('Edit Provider', `
        <div style="text-align: center; padding: 40px;">
            <i class="fas fa-spinner fa-spin" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>Loading provider data...</p>
        </div>
    `);
    
    try {
        // Fetch the current provider data
        const response = await fetch('/.netlify/functions/providers', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!data.success || !data.providers) {
            throw new Error('Failed to load provider data');
        }
        
        // Find the specific provider
        const provider = data.providers.find(p => p.id === providerId);
        
        if (!provider) {
            throw new Error('Provider not found');
        }
        
        // Now show the edit form with actual data
        const content = `
            <form id="editProviderForm" onsubmit="submitEditProvider(event, '${providerId}')" class="admin-form">
                <div class="form-group">
                    <label>Provider Name *</label>
                    <input type="text" name="providerName" value="${escapeHtml(provider.name)}" required>
                </div>
                <div class="form-group">
                    <label>API URL *</label>
                    <input type="url" name="apiUrl" value="${escapeHtml(provider.api_url)}" required>
                </div>
                <div class="form-group">
                    <label>API Key *</label>
                    <input type="text" name="apiKey" value="${escapeHtml(provider.api_key)}" required>
                    <small style="color: #888;">Enter new key or leave unchanged</small>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Default Markup (%)</label>
                        <input type="number" name="markup" value="${provider.markup || 0}" min="0" max="100" step="0.01">
                    </div>
                    <div class="form-group">
                        <label>Status</label>
                        <select name="status">
                            <option value="active" ${provider.status === 'active' ? 'selected' : ''}>Active</option>
                            <option value="inactive" ${provider.status === 'inactive' ? 'selected' : ''}>Inactive</option>
                        </select>
                    </div>
                </div>
            </form>
        `;
        
        const actions = `
            <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
            <button type="submit" form="editProviderForm" class="btn-primary">
                <i class="fas fa-save"></i> Save Changes
            </button>
        `;
        
        createModal(`Edit Provider: ${escapeHtml(provider.name)}`, content, actions);
        
    } catch (error) {
        console.error('Error loading provider:', error);
        const content = `
            <div style="text-align: center; padding: 40px;">
                <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #ef4444; margin-bottom: 20px;"></i>
                <p style="color: #ef4444;">${error.message || 'Failed to load provider'}</p>
                <button class="btn-primary" onclick="closeModal()" style="margin-top: 20px;">Close</button>
            </div>
        `;
        createModal('Error', content);
    }
}

function submitEditProvider(event, providerId) {
    event.preventDefault();
    console.log('[DEBUG] Submitting edit for provider:', providerId);
    
    const formData = new FormData(event.target);
    const providerData = Object.fromEntries(formData);
    
    // Disable submit button
    const submitBtn = event.target.querySelector('button[type="submit"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    }
    
    const payload = {
        providerId: providerId,
        name: providerData.providerName,
        api_url: providerData.apiUrl,
        api_key: providerData.apiKey,
        markup: parseFloat(providerData.markup) || 0,
        status: providerData.status
    };
    
    console.log('[DEBUG] Update payload:', payload);
    
    fetch(`/.netlify/functions/providers/${providerId}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify(payload)
    })
    .then(response => {
        console.log('[DEBUG] Update response status:', response.status);
        return response.json();
    })
    .then(data => {
        console.log('[DEBUG] Update response data:', data);
        if (data.success) {
            showNotification(`Provider updated successfully!`, 'success');
            closeModal();
            loadProviders(); // Reload the providers list
        } else {
            throw new Error(data.error || 'Failed to update provider');
        }
    })
    .catch(error => {
        console.error('Error updating provider:', error);
        showNotification(error.message || 'Failed to update provider', 'error');
        // Re-enable button
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="fas fa-save"></i> Save Changes';
        }
    });
}

function deleteProvider(providerId) {
    const content = `
        <div class="confirmation-message danger">
            <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #ef4444; margin-bottom: 20px;"></i>
            <p>Delete this provider?</p>
            <p style="color: #888; font-size: 14px; margin-top: 10px;">
                This will affect all services using this provider and cannot be undone.
            </p>
        </div>
    `;
    
    const actions = `
        <button type="button" class="btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="button" class="btn-danger" onclick="confirmDeleteProvider(${providerId})">
            <i class="fas fa-trash"></i> Delete Provider
        </button>
    `;
    
    createModal('Delete Provider', content, actions);
}

function confirmDeleteProvider(providerId) {
    console.log('[DEBUG] Deleting provider:', providerId);
    
    fetch(`/.netlify/functions/providers/${providerId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ providerId: providerId })
    })
    .then(response => {
        console.log('[DEBUG] Delete response status:', response.status);
        return response.json();
    })
    .then(data => {
        console.log('[DEBUG] Delete response data:', data);
        if (data.success) {
            showNotification(`Provider deleted successfully`, 'success');
            closeModal();
            loadProviders(); // Reload the providers list
        } else {
            throw new Error(data.error || 'Failed to delete provider');
        }
    })
    .catch(error => {
        console.error('Error deleting provider:', error);
        showNotification(error.message || 'Failed to delete provider', 'error');
    });
}

async function syncProvider(providerId) {
    console.log('[DEBUG] Syncing provider:', providerId);
    
    const content = `
        <div style="text-align: center; padding: 20px;">
            <i class="fas fa-sync fa-spin" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>Syncing services from provider...</p>
            <div style="background: rgba(0,0,0,0.3); border-radius: 8px; height: 8px; margin-top: 20px; overflow: hidden;">
                <div id="syncProgress" style="background: #FF1494; height: 100%; width: 30%; transition: width 0.3s;"></div>
            </div>
            <p id="syncStatus" style="color: #888; margin-top: 12px;">Connecting to provider API...</p>
        </div>
    `;
    
    createModal('Syncing Services', content, '', false); // No close button during sync
    
    try {
        const token = localStorage.getItem('token');
        
        // Update progress
        const updateProgress = (percent, status) => {
            const progressBar = document.getElementById('syncProgress');
            const statusText = document.getElementById('syncStatus');
            if (progressBar) progressBar.style.width = percent + '%';
            if (statusText) statusText.textContent = status;
        };
        
        updateProgress(50, 'Fetching services from provider...');
        
        const response = await fetch('/.netlify/functions/providers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'sync',
                providerId: providerId
            })
        });
        
        updateProgress(80, 'Processing services...');
        
        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            console.warn('[WARN] Non-JSON response received:', text);
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw new Error('Invalid response from server');
            }
        }
        
        console.log('[DEBUG] Sync response:', data);
        
        if (data.success) {
            updateProgress(100, 'Sync completed!');
            
            const message = `Successfully synced services!\n` +
                `Added: ${data.added || 0}\n` +
                `Updated: ${data.updated || 0}\n` +
                `Total: ${data.total || 0}`;
            
            setTimeout(() => {
                closeModal();
                showNotification(message, 'success');
                loadProviders(); // Refresh provider list
                // Invalidate services cache
                if (typeof window.invalidateProvidersCache === 'function') {
                    window.invalidateProvidersCache();
                }
            }, 1000);
        } else {
            throw new Error(data.error || 'Sync failed');
        }
    } catch (error) {
        console.error('[ERROR] Sync provider failed:', error);
        const statusText = document.getElementById('syncStatus');
        if (statusText) {
            statusText.innerHTML = `<span style="color: #ef4444;">❌ ${error.message}</span>`;
        }
        
        setTimeout(() => {
            closeModal();
            showNotification('Sync failed: ' + error.message, 'error');
        }, 2000);
    }
}

async function testProvider(providerId) {
    console.log('[DEBUG] Testing provider:', providerId);
    
    const content = `
        <div style="text-align: center; padding: 20px;">
            <i class="fas fa-circle-notch fa-spin" style="font-size: 48px; color: #FF1494; margin-bottom: 20px;"></i>
            <p>Testing connection to provider...</p>
            <p id="testStatus" style="color: #888; margin-top: 12px;">Connecting to API...</p>
        </div>
    `;
    
    createModal('Testing Connection', content, '', false);
    
    try {
        const token = localStorage.getItem('token');
        
        const response = await fetch('/.netlify/functions/providers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                action: 'test',
                providerId: providerId
            })
        });
        
        let data;
        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            const text = await response.text();
            console.warn('[WARN] Non-JSON response received:', text);
            try {
                data = JSON.parse(text);
            } catch (e) {
                throw new Error('Invalid response from server');
            }
        }
        
        console.log('[DEBUG] Test response:', data);
        
        closeModal();
        
        if (data.success) {
            const resultContent = `
                <div style="text-align: center; padding: 20px;">
                    <i class="fas fa-check-circle" style="font-size: 48px; color: #10b981; margin-bottom: 20px;"></i>
                    <p style="font-size: 18px; font-weight: 600; margin-bottom: 20px;">Connection Successful!</p>
                    <div style="background: rgba(0,0,0,0.3); border-radius: 8px; padding: 16px; text-align: left;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                            <div>
                                <div style="color: #888; font-size: 12px;">Response Time</div>
                                <div style="font-weight: 600;">${data.responseTime || '-'}ms</div>
                            </div>
                            <div>
                                <div style="color: #888; font-size: 12px;">API Status</div>
                                <div style="font-weight: 600; color: #10b981;">Online</div>
                            </div>
                            <div>
                                <div style="color: #888; font-size: 12px;">Available Services</div>
                                <div style="font-weight: 600;">${data.servicesCount || '-'}</div>
                            </div>
                            <div>
                                <div style="color: #888; font-size: 12px;">Balance</div>
                                <div style="font-weight: 600; color: #10b981;">$${data.balance || '0.00'}</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            const actions = `
                <button type="button" class="btn-primary" onclick="closeModal()">Close</button>
            `;
            
            createModal('Connection Test Result', resultContent, actions);
        } else {
            throw new Error(data.error || 'Connection test failed');
        }
    } catch (error) {
        console.error('[ERROR] Test provider failed:', error);
        closeModal();
        
        const errorContent = `
            <div style="text-align: center; padding: 20px;">
                <i class="fas fa-times-circle" style="font-size: 48px; color: #ef4444; margin-bottom: 20px;"></i>
                <p style="font-size: 18px; font-weight: 600; margin-bottom: 20px;">Connection Failed</p>
                <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid #ef4444; border-radius: 8px; padding: 16px;">
                    <p style="color: #ef4444; margin: 0;">${error.message}</p>
                </div>
                <p style="color: #888; margin-top: 12px; font-size: 14px;">Please check your API credentials and try again.</p>
            </div>
        `;
        
        const actions = `
            <button type="button" class="btn-primary" onclick="closeModal()">Close</button>
        `;
        
        createModal('Connection Test Result', errorContent, actions);
    }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', async () => {
    initializeSettingsQuickActions();
    try {
        await getStoredSettings();
    } catch (error) {
        console.warn('[WARN] Settings preload failed:', error);
    }
    showSettingsSection('providers');
    loadProviders();
});

