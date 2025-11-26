'use strict';

(function() {
    const SALT_ROUNDS = 10;
    const ENCRYPTION_KEY = 'BOTZZZ773_SECURE_KEY_2025';
    const AUTH_ALERT_MESSAGE = 'You must be signed in as an admin to run the security migration. Please sign in with your admin account.';

    let isPopupMode = false;
    let authGuardTriggered = false;
    let migrationRunning = false;

    document.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        isPopupMode = params.get('popup') === '1';
        if (isPopupMode) {
            enablePopupSurface();
        }

        wireUi();
        refreshStatus();
        resolveAuthToken('security-migration');
    });

    function wireUi() {
        document.querySelectorAll('[data-popup-close]').forEach((button) => {
            button.addEventListener('click', handlePopupClose);
        });

        const migrateBtn = document.getElementById('migrateBtn');
        if (migrateBtn) {
            migrateBtn.addEventListener('click', runMigration);
        }
    }

    async function runMigration() {
        if (migrationRunning) {
            return;
        }

        if (!resolveAuthToken('security-migration')) {
            return;
        }

        const currentUser = readCurrentUser();
        if (!currentUser) {
            handleMissingAuth('user-missing');
            return;
        }

        if (currentUser.role !== 'admin') {
            appendLog('Administrator access is required to run this migration.', 'error');
            setStatus('Admin access required', 'error');
            notifyOpener({ type: 'ADMIN_REQUIRED', source: 'security-migration' });
            if (!isPopupMode) {
                alert('Only admin accounts can run the security migration.');
            }
            return;
        }

        if (!window.bcrypt || typeof window.bcrypt.hashSync !== 'function') {
            appendLog('bcrypt.js is unavailable. Cannot hash legacy passwords.', 'error');
            setStatus('Missing bcrypt.js', 'error');
            return;
        }

        if (!window.CryptoJS || !window.CryptoJS.AES) {
            appendLog('CryptoJS is unavailable. Cannot encrypt legacy API keys.', 'error');
            setStatus('Missing CryptoJS', 'error');
            return;
        }

        migrationRunning = true;
        setStatus('Running migration...', 'warning');
        toggleMigrateButton(true);

        resetLog();
        showLogBox();
        appendLog('Starting security migration...');

        await delay(50);

        try {
            const userResult = migrateUsers();
            const apiKeyResult = migrateKeyCollection('API_KEYS', { fields: ['key'], allowStrings: true });
            const providerResult = migrateProviderKeys();

            const aggregatedApiStats = {
                total: apiKeyResult.total + providerResult.total,
                encrypted: apiKeyResult.encrypted + providerResult.encrypted,
                updated: apiKeyResult.updated + providerResult.updated
            };

            appendLog(`User accounts processed: ${userResult.total}, hashed: ${userResult.hashed}, updated: ${userResult.updated}.`, 'success');
            appendLog(`API keys processed: ${aggregatedApiStats.total}, encrypted: ${aggregatedApiStats.encrypted}, updated: ${aggregatedApiStats.updated}.`, 'success');

            refreshStatus();
            setStatus('Migration complete', 'success');

            notifyOpener({
                type: 'SECURITY_MIGRATION_COMPLETED',
                summary: {
                    users: userResult,
                    apiKeys: aggregatedApiStats
                }
            });

            appendLog('Security migration finished successfully.', 'success');
        } catch (error) {
            console.error('[SECURITY MIGRATION] Migration failed', error);
            appendLog(error?.message || 'Migration failed unexpectedly.', 'error');
            setStatus('Migration failed', 'error');
        } finally {
            migrationRunning = false;
            toggleMigrateButton(false);
        }
    }

    function migrateUsers() {
        const users = safeParse(localStorage.getItem('USERS'));
        if (!Array.isArray(users) || users.length === 0) {
            appendLog('No legacy users found in localStorage.');
            return { total: 0, hashed: 0, updated: 0 };
        }

        let hashed = 0;
        let updated = 0;
        let mutated = false;

        users.forEach((user, index) => {
            if (!user || typeof user !== 'object') {
                return;
            }

            if (isBcryptHash(user.password)) {
                hashed += 1;
                return;
            }

            if (typeof user.password === 'string' && user.password.trim()) {
                try {
                    user.password = bcrypt.hashSync(user.password, SALT_ROUNDS);
                    hashed += 1;
                    updated += 1;
                    mutated = true;
                    appendLog(`Hashed password for ${maskIdentifier(user.email || user.username || `user #${index + 1}`)}.`, 'success');
                } catch (error) {
                    appendLog(`Failed to hash password for ${maskIdentifier(user.email || `user #${index + 1}`)}.`, 'error');
                    console.warn('[SECURITY MIGRATION] bcrypt error', error);
                }
            }
        });

        if (mutated) {
            localStorage.setItem('USERS', JSON.stringify(users));
        }

        return { total: users.length, hashed, updated };
    }

    function migrateProviderKeys() {
        const apiProviders = migrateKeyCollection('API_PROVIDERS', { fields: ['apiKey', 'key'] });
        const adminProviders = migrateKeyCollection('PROVIDERS', { fields: ['apiKey', 'key'] });

        return {
            total: apiProviders.total + adminProviders.total,
            encrypted: apiProviders.encrypted + adminProviders.encrypted,
            updated: apiProviders.updated + adminProviders.updated
        };
    }

    function migrateKeyCollection(storageKey, options = {}) {
        const { fields = [], allowStrings = false } = options;
        const collection = safeParse(localStorage.getItem(storageKey));

        if (!Array.isArray(collection) || collection.length === 0) {
            return { total: 0, encrypted: 0, updated: 0 };
        }

        let mutated = false;
        let total = 0;
        let encrypted = 0;
        let updated = 0;

        const nextCollection = collection.map((entry, index) => {
            if (allowStrings && typeof entry === 'string') {
                const keyValue = entry.trim();
                if (!keyValue) {
                    return entry;
                }

                total += 1;
                if (isEncryptedKey(keyValue)) {
                    encrypted += 1;
                    return entry;
                }

                const encryptedValue = encryptApiKey(keyValue);
                encrypted += 1;
                updated += 1;
                mutated = true;
                appendLog(`Encrypted legacy API key #${index + 1} from ${storageKey}.`, 'success');
                return encryptedValue;
            }

            if (!entry || typeof entry !== 'object') {
                return entry;
            }

            const field = fields.find((candidate) => typeof entry[candidate] === 'string' && entry[candidate].trim());
            if (!field) {
                return entry;
            }

            const keyValue = entry[field];
            total += 1;

            if (isEncryptedKey(keyValue)) {
                encrypted += 1;
                return entry;
            }

            entry[field] = encryptApiKey(keyValue);
            encrypted += 1;
            updated += 1;
            mutated = true;

            const label = entry.name || entry.id || `${storageKey} #${index + 1}`;
            appendLog(`Encrypted API key for ${label} (${storageKey}).`, 'success');
            return entry;
        });

        if (mutated) {
            localStorage.setItem(storageKey, JSON.stringify(nextCollection));
        }

        return { total, encrypted, updated };
    }

    function refreshStatus() {
        const userStats = collectUserStats();
        const apiKeyStats = collectApiKeyStats();

        setText('userCount', formatNumber(userStats.total));
        setText('hashedCount', formatNumber(userStats.hashed));
        setText('apiKeyCount', formatNumber(apiKeyStats.total));
        setText('encryptedCount', formatNumber(apiKeyStats.encrypted));

        if (userStats.total === 0 && apiKeyStats.total === 0) {
            setStatus('No legacy data detected', 'success');
            return;
        }

        const everythingSecure = userStats.total === userStats.hashed && apiKeyStats.total === apiKeyStats.encrypted;
        if (everythingSecure) {
            setStatus('All records already secure', 'success');
        } else {
            setStatus('Action required', 'warning');
        }
    }

    function collectUserStats() {
        const users = safeParse(localStorage.getItem('USERS'));
        if (!Array.isArray(users) || users.length === 0) {
            return { total: 0, hashed: 0 };
        }

        let hashed = 0;
        users.forEach((user) => {
            if (isBcryptHash(user?.password)) {
                hashed += 1;
            }
        });

        return { total: users.length, hashed };
    }

    function collectApiKeyStats() {
        const userStats = computeKeyStats('API_KEYS', { fields: ['key'], allowStrings: true });
        const providerStats = computeKeyStats('API_PROVIDERS', { fields: ['apiKey', 'key'] });
        const adminStats = computeKeyStats('PROVIDERS', { fields: ['apiKey', 'key'] });

        return {
            total: userStats.total + providerStats.total + adminStats.total,
            encrypted: userStats.encrypted + providerStats.encrypted + adminStats.encrypted
        };
    }

    function computeKeyStats(storageKey, options = {}) {
        const collection = safeParse(localStorage.getItem(storageKey));
        if (!Array.isArray(collection) || collection.length === 0) {
            return { total: 0, encrypted: 0 };
        }

        let total = 0;
        let encrypted = 0;

        collection.forEach((entry) => {
            const value = resolveKeyValue(entry, options);
            if (!value) {
                return;
            }
            total += 1;
            if (isEncryptedKey(value)) {
                encrypted += 1;
            }
        });

        return { total, encrypted };
    }

    function resolveKeyValue(entry, options = {}) {
        const { fields = [], allowStrings = false } = options;
        if (allowStrings && typeof entry === 'string') {
            return entry;
        }
        if (entry && typeof entry === 'object') {
            for (const field of fields) {
                if (typeof entry[field] === 'string' && entry[field].trim()) {
                    return entry[field];
                }
            }
        }
        return null;
    }

    function setStatus(message, variant) {
        const statusEl = document.getElementById('migrationStatus');
        if (!statusEl) {
            return;
        }
        statusEl.textContent = message;
        statusEl.classList.remove('success', 'warning', 'error');
        if (variant && ['success', 'warning', 'error'].includes(variant)) {
            statusEl.classList.add(variant);
        }
    }

    function setText(elementId, value) {
        const el = document.getElementById(elementId);
        if (el) {
            el.textContent = value;
        }
    }

    function formatNumber(value) {
        if (typeof value !== 'number' || Number.isNaN(value)) {
            return '0';
        }
        return value.toLocaleString();
    }

    function appendLog(message, variant = 'info') {
        const logContent = document.getElementById('logContent');
        const logBox = document.getElementById('logBox');
        if (!logContent) {
            return;
        }

        const entry = document.createElement('div');
        entry.className = `log-entry ${variant}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        logContent.appendChild(entry);

        if (logBox) {
            logBox.style.display = 'block';
            logBox.scrollTop = logBox.scrollHeight;
        }
    }

    function resetLog() {
        const logContent = document.getElementById('logContent');
        if (logContent) {
            logContent.textContent = '';
        }
    }

    function showLogBox() {
        const logBox = document.getElementById('logBox');
        if (logBox) {
            logBox.style.display = 'block';
        }
    }

    function toggleMigrateButton(disabled) {
        const button = document.getElementById('migrateBtn');
        if (!button) {
            return;
        }

        if (disabled) {
            button.disabled = true;
            button.innerHTML = 'Migrating<span class="spinner" aria-hidden="true"></span>';
        } else {
            button.disabled = false;
            button.textContent = 'Start Security Migration';
        }
    }

    function enablePopupSurface() {
        document.body.classList.add('popup-mode');
        const panel = document.querySelector('[data-popup-surface]');
        if (panel) {
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-label', 'Security migration window');
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
        if (isPopupMode && window.opener && !window.opener.closed) {
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
    }

    function notifyOpener(payload) {
        if (!isPopupMode || !window.opener || window.opener.closed) {
            return;
        }
        try {
            window.opener.postMessage(payload, window.location.origin);
        } catch (error) {
            console.warn('[SECURITY MIGRATION] Failed to notify opener.', error);
        }
    }

    function resolveAuthToken(reason) {
        const token = getAuthToken();
        if (!token) {
            handleMissingAuth(reason || 'token-missing');
        }
        return token;
    }

    function getAuthToken() {
        try {
            return localStorage.getItem('token');
        } catch (error) {
            console.warn('[SECURITY MIGRATION] Unable to read auth token from storage.', error);
            return null;
        }
    }

    function handleMissingAuth(reason) {
        if (authGuardTriggered) {
            return;
        }
        authGuardTriggered = true;

        notifyOpener({ type: 'AUTH_REQUIRED', source: 'security-migration', reason });

        if (isPopupMode) {
            setTimeout(() => {
                try {
                    window.close();
                } catch (error) {
                    console.warn('[SECURITY MIGRATION] Unable to close popup after auth guard.', error);
                }
            }, 200);
            return;
        }

        alert(AUTH_ALERT_MESSAGE);
        const redirectParam = buildRedirectTarget();
        window.location.href = `signin.html?redirect=${encodeURIComponent(redirectParam)}`;
    }

    function buildRedirectTarget() {
        const path = window.location.pathname.replace(/^\/+/, '');
        const search = window.location.search || '';
        return search ? `${path}${search}` : path;
    }

    function readCurrentUser() {
        try {
            const raw = localStorage.getItem('user');
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            console.warn('[SECURITY MIGRATION] Failed to parse user profile.', error);
            return null;
        }
    }

    function isBcryptHash(value) {
        return typeof value === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
    }

    function isEncryptedKey(value) {
        return typeof value === 'string' && value.startsWith('U2FsdGVkX1');
    }

    function maskIdentifier(value) {
        if (!value || typeof value !== 'string') {
            return 'user';
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return 'user';
        }

        const atIndex = trimmed.indexOf('@');
        if (atIndex > 1) {
            const local = trimmed.slice(0, atIndex);
            const domain = trimmed.slice(atIndex + 1);
            return `${local.slice(0, 2)}***@${domain}`;
        }

        return `${trimmed.slice(0, 4)}***`;
    }

    function encryptApiKey(value) {
        try {
            return CryptoJS.AES.encrypt(value, ENCRYPTION_KEY).toString();
        } catch (error) {
            console.error('[SECURITY MIGRATION] Failed to encrypt API key.', error);
            return value;
        }
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function safeParse(raw) {
        if (!raw) {
            return null;
        }
        try {
            return JSON.parse(raw);
        } catch (error) {
            console.warn('[SECURITY MIGRATION] Failed to parse stored data.', error);
            return null;
        }
    }
})();
