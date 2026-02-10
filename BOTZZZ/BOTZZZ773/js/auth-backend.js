// Authentication with Backend Integration
// Load this AFTER api-client.js

let authPopupMode = false;
let popupSurfaceEl = null;

// Public pages that must never force a sign-in redirect or show auth errors
function isPublicApiDocPage() {
    if (typeof window === 'undefined') {
        return false;
    }
    const path = window.location.pathname.replace(/^\/+/g, '').toLowerCase();
    // Allow public access to homepage, services, contact, tickets, and all API pages
    // These pages are accessible to external providers (GroupSocial, PerfectPanel, etc.)
    return path === 'index.html' || 
           path === '' || 
           path === 'services.html' || 
           path === 'api.html' || 
           path === 'api-docs.html' ||
           path === 'api-dashboard.html' ||
           path === 'contact.html' ||
           path === 'tickets.html' ||
           path.startsWith('api');
}

// Check if user is already logged in on page load
document.addEventListener('DOMContentLoaded', () => {
    // Don't await on auth pages to prevent blocking form attachment
    const isAuthPage = window.location.pathname.includes('signin') || 
                       window.location.pathname.includes('signup');
    if (isAuthPage) {
        // Run auth check in background for auth pages
        checkAuthStatus().catch(err => console.warn('[AUTH] Auth check failed:', err));
    } else {
        // Wait for auth check on other pages
        checkAuthStatus();
    }
});

// Check authentication status
async function checkAuthStatus() {
    const token = localStorage.getItem('token');
    const isAuthPage = window.location.pathname.includes('signin') || 
                       window.location.pathname.includes('signup');
    const isPublicApiDoc = isPublicApiDocPage();
    
    if (!token) {
        // Don't update navigation on signin/signup pages to preserve form
        if (!isAuthPage) {
            updateNavigation(false);
        }
        return false;
    }

    try {
        const data = await api.verifyToken(token);
        if (data.success && data.user) {
            localStorage.setItem('user', JSON.stringify(data.user));
            if (window.BalanceSync) {
                window.BalanceSync.setUser(data.user, { reason: 'auth-verify' });
            }
            updateNavigation(true, data.user);
            return true;
        } else {
            // Token invalid - clear storage but don't redirect on auth pages
            clearAuthStorage();
            if (!isAuthPage && !isPublicApiDoc) {
                window.location.href = 'signin.html';
            } else if (!isAuthPage) {
                updateNavigation(false);
            }
            return false;
        }
    } catch (error) {
        console.error('Auth verification failed:', error);
        // Clear storage but don't redirect on auth pages (user is already there)
        clearAuthStorage();
        if (!isAuthPage && !isPublicApiDoc) {
            window.location.href = 'signin.html';
        } else if (!isAuthPage) {
            updateNavigation(false);
        }
        return false;
    }
}

// Helper to clear auth storage without redirecting
function clearAuthStorage() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('rememberMe');
    if (window.BalanceSync) {
        window.BalanceSync.clearUser({ reason: 'auth-clear' });
    }
}

// Admin OTP modal state
const ADMIN_OTP_DEFAULT_EXPIRY = 600; // fallback to 10 minutes if backend omits value
const ADMIN_OTP_RESEND_DELAY = 45; // seconds before another code can be requested

const adminOtpState = {
    email: null,
    password: null,
    rememberMe: false,
    expiresAt: null,
    resendAvailableAt: null
};

let adminOtpCountdownInterval = null;

function ensureAdminOtpModalStructure() {
    if (typeof document === 'undefined') {
        return null;
    }

    let modal = document.getElementById('adminOtpModal');
    if (modal) {
        return modal;
    }

    if (!document.body) {
        return null;
    }

    const template = document.createElement('template');
    template.innerHTML = `
        <div class="otp-modal-backdrop" id="adminOtpModal" aria-hidden="true" style="display: none;">
            <div class="otp-modal" role="dialog" aria-labelledby="otpModalTitle" aria-modal="true">
                <button type="button" class="otp-modal-close" id="closeAdminOtpModal" aria-label="Close admin verification">&times;</button>
                <div class="otp-modal-header">
                    <h2 id="otpModalTitle">Admin Verification</h2>
                    <p>Enter the 6-digit code we sent to your admin email to unlock the panel.</p>
                </div>
                <form id="adminOtpForm" class="otp-form">
                    <div class="otp-input-group">
                        <label for="adminOtpInput" class="sr-only">Admin OTP Code</label>
                        <input type="text" id="adminOtpInput" name="adminOtpInput" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="000000" required>
                    </div>
                    <div class="otp-meta">
                        <span id="otpCountdown">Code expires in 10:00</span>
                        <button type="button" id="resendAdminOtp" class="otp-link" disabled>Resend code</button>
                    </div>
                    <div class="otp-feedback" id="adminOtpFeedback" role="alert"></div>
                    <button type="submit" class="btn-submit otp-submit">Verify &amp; Continue</button>
                </form>
            </div>
        </div>
    `.trim();

    modal = template.content.firstElementChild;
    document.body.appendChild(modal);
    return modal;
}

// Sign In Handler
async function handleSignIn(e) {
    e.preventDefault();
    
    const email = document.getElementById('email')?.value.trim();
    const password = document.getElementById('password')?.value;
    const rememberMe = document.getElementById('remember')?.checked;

    if (!email || !password) {
        showError('Please fill in all fields');
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try {
        const data = await api.login(email, password);

        if (data.requiresOtp) {
            adminOtpState.email = email;
            adminOtpState.password = password;
            adminOtpState.rememberMe = !!rememberMe;

            const expiresIn = data.expiresIn || ADMIN_OTP_DEFAULT_EXPIRY;
            openAdminOtpModal(data.message, expiresIn);
            return;
        }

        if (data.success && data.token && data.user) {
            finalizeLogin(data, rememberMe);
            return;
        }

        showError(data.error || 'Login failed');
    } catch (error) {
        console.error('Login error:', error);
        showError(error.message || 'Login failed. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

function openAdminOtpModal(message, expiresIn = ADMIN_OTP_DEFAULT_EXPIRY) {
    const modal = ensureAdminOtpModalStructure();
    if (!modal) {
        console.warn('Admin OTP modal not found in DOM, using prompt fallback.');
        // Fallback: use prompt to get OTP code
        promptForOtpCode(message);
        return;
    }

    const otpInput = document.getElementById('adminOtpInput');
    if (otpInput) {
        otpInput.value = '';
        setTimeout(() => otpInput.focus(), 100);
    }

    adminOtpState.expiresAt = Date.now() + (expiresIn * 1000);
    adminOtpState.resendAvailableAt = Date.now() + (ADMIN_OTP_RESEND_DELAY * 1000);

    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';

    setOtpFeedback(message || 'OTP sent to your admin email. Enter the code to continue.', 'success');
    updateAdminOtpCountdown();

    if (adminOtpCountdownInterval) {
        clearInterval(adminOtpCountdownInterval);
    }
    adminOtpCountdownInterval = setInterval(updateAdminOtpCountdown, 1000);
}

// Fallback OTP input using browser prompt
async function promptForOtpCode(message) {
    const otpCode = prompt(message + '\n\nEnter your 6-digit OTP code:');
    
    if (!otpCode) {
        alert('OTP verification cancelled.');
        return;
    }
    
    if (!/^[0-9]{6}$/.test(otpCode.trim())) {
        alert('Invalid code. Please enter exactly 6 digits.');
        promptForOtpCode(message); // Try again
        return;
    }
    
    try {
        // Verify OTP with backend
        const data = await api.login(
            adminOtpState.email, 
            adminOtpState.password, 
            otpCode.trim()
        );
        
        if (data.success && data.token && data.user) {
            // Success! Login and redirect
            finalizeLogin(data, adminOtpState.rememberMe);
        } else {
            alert(data.error || 'Invalid OTP code. Please try again.');
            promptForOtpCode(message); // Try again
        }
    } catch (error) {
        console.error('OTP verification error:', error);
        alert('Verification failed. Please try again.');
        promptForOtpCode(message); // Try again
    }
}

function closeAdminOtpModal({ clearCredentials = false } = {}) {
    const modal = document.getElementById('adminOtpModal');
    if (!modal) {
        return;
    }

    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';

    const otpInput = document.getElementById('adminOtpInput');
    if (otpInput) {
        otpInput.value = '';
    }

    const countdownEl = document.getElementById('otpCountdown');
    if (countdownEl) {
        countdownEl.textContent = '';
    }

    const resendBtn = document.getElementById('resendAdminOtp');
    if (resendBtn) {
        resendBtn.disabled = true;
        resendBtn.textContent = 'Resend code';
    }

    setOtpFeedback('', 'success');

    if (adminOtpCountdownInterval) {
        clearInterval(adminOtpCountdownInterval);
        adminOtpCountdownInterval = null;
    }

    adminOtpState.expiresAt = null;
    adminOtpState.resendAvailableAt = null;

    if (clearCredentials) {
        adminOtpState.email = '';
        adminOtpState.password = '';
        adminOtpState.rememberMe = false;
    }
}

function updateAdminOtpCountdown() {
    const countdownEl = document.getElementById('otpCountdown');
    if (countdownEl) {
        if (adminOtpState.expiresAt) {
            const remaining = adminOtpState.expiresAt - Date.now();
            if (remaining > 0) {
                const minutes = Math.floor(remaining / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);
                countdownEl.textContent = `Code expires in ${minutes}:${seconds.toString().padStart(2, '0')}`;
            } else {
                countdownEl.textContent = 'Code expired. Request a new one.';
            }
        } else {
            countdownEl.textContent = '';
        }
    }

    const resendBtn = document.getElementById('resendAdminOtp');
    if (resendBtn) {
        if (adminOtpState.resendAvailableAt && Date.now() >= adminOtpState.resendAvailableAt) {
            resendBtn.disabled = false;
            resendBtn.textContent = 'Resend code';
        } else if (adminOtpState.resendAvailableAt) {
            const waitSeconds = Math.max(0, Math.ceil((adminOtpState.resendAvailableAt - Date.now()) / 1000));
            resendBtn.disabled = true;
            resendBtn.textContent = `Resend in ${waitSeconds}s`;
        } else {
            resendBtn.disabled = true;
            resendBtn.textContent = 'Resend code';
        }
    }
}

function setOtpFeedback(message = '', type = 'success') {
    const feedbackEl = document.getElementById('adminOtpFeedback');
    if (!feedbackEl) {
        return;
    }

    feedbackEl.textContent = message || '';
    feedbackEl.classList.remove('error', 'success');

    if (message) {
        feedbackEl.classList.add(type === 'error' ? 'error' : 'success');
    }
}

function clearAdminOtpCredentials() {
    adminOtpState.email = null;
    adminOtpState.password = null;
    adminOtpState.rememberMe = false;
}

async function handleAdminOtpSubmit(e) {
    e.preventDefault();

    const otpInput = document.getElementById('adminOtpInput');
    const adminOtp = otpInput?.value?.trim();

    if (!adminOtp || !/^[0-9]{6}$/.test(adminOtp)) {
        setOtpFeedback('Please enter a valid 6-digit code.', 'error');
        otpInput?.focus();
        return;
    }

    if (!adminOtpState.email || !adminOtpState.password) {
        setOtpFeedback('Session expired. Please sign in again.', 'error');
        closeAdminOtpModal({ clearCredentials: true });
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying...';

    try {
        const data = await api.login(adminOtpState.email, adminOtpState.password, adminOtp);
        if (data.success && data.token && data.user) {
            const rememberSession = adminOtpState.rememberMe;
            setOtpFeedback('OTP verified. Redirecting...', 'success');
            closeAdminOtpModal({ clearCredentials: true });
            finalizeLogin(data, rememberSession);
        } else {
            setOtpFeedback(data.error || 'Invalid OTP code. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Admin OTP verification failed:', error);
        setOtpFeedback(error.message || 'OTP verification failed. Please try again.', 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

async function handleAdminOtpResend() {
    if (!adminOtpState.email || !adminOtpState.password) {
        setOtpFeedback('Session expired. Please sign in again.', 'error');
        closeAdminOtpModal({ clearCredentials: true });
        return;
    }

    const resendBtn = document.getElementById('resendAdminOtp');
    if (resendBtn?.disabled && adminOtpState.resendAvailableAt && Date.now() < adminOtpState.resendAvailableAt) {
        return;
    }

    if (resendBtn) {
        resendBtn.disabled = true;
        resendBtn.textContent = 'Sending...';
    }

    try {
        const data = await api.login(adminOtpState.email, adminOtpState.password, null, true);
        if (data.success && data.requiresOtp) {
            adminOtpState.expiresAt = Date.now() + ((data.expiresIn || ADMIN_OTP_DEFAULT_EXPIRY) * 1000);
            adminOtpState.resendAvailableAt = Date.now() + (ADMIN_OTP_RESEND_DELAY * 1000);
            setOtpFeedback(data.message || 'New OTP sent. Check your email.', 'success');
        } else {
            setOtpFeedback(data.error || 'Unable to resend OTP. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Failed to resend admin OTP:', error);
        setOtpFeedback(error.message || 'Unable to resend OTP. Please try again.', 'error');
    } finally {
        updateAdminOtpCountdown();
    }
}

function finalizeLogin(data, rememberMe, context = {}) {
    if (!data || !data.token || !data.user) {
        showError('Login failed. Please try again.');
        return;
    }

    console.log('[AUTH] Saving token to localStorage...');
    console.log('[AUTH] Token length:', data.token?.length);
    console.log('[AUTH] User:', data.user?.email, data.user?.role);
    
    try {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // Verify the token was saved
        const savedToken = localStorage.getItem('token');
        const savedUser = localStorage.getItem('user');
        console.log('[AUTH] Token saved successfully:', !!savedToken);
        console.log('[AUTH] User saved successfully:', !!savedUser);
        
        if (!savedToken) {
            console.error('[AUTH] CRITICAL: Token was not saved to localStorage!');
            showError('Failed to save login. Please check your browser settings.');
            return;
        }
    } catch (error) {
        console.error('[AUTH] Failed to save to localStorage:', error);
        showError('Failed to save login. Please check your browser settings allow localStorage.');
        return;
    }
    
    if (window.BalanceSync) {
        window.BalanceSync.setUser(data.user, { reason: 'auth-login' });
    }

    if (rememberMe) {
        localStorage.setItem('rememberMe', 'true');
    } else {
        localStorage.removeItem('rememberMe');
    }

    const source = context.source || 'login';
    const successMessage = context.successMessage || (source === 'signup' ? 'Account created successfully! Redirecting...' : 'Login successful! Redirecting...');
    showSuccess(successMessage);

    if (authPopupMode) {
        const payload = { user: data.user, token: data.token };
        const eventType = source === 'signup' ? 'USER_SIGNED_UP' : 'USER_LOGGED_IN';
        notifyOpener(eventType, payload);
        setTimeout(() => handlePopupClose(), 700);
        return;
    }

    setTimeout(() => {
        const isAdmin = data.user.role === 'admin';
        const destination = isAdmin ? 'admin/index.html' : '/';
        console.log('[AUTH] Redirecting to:', destination);
        console.log('[AUTH] Final token check before redirect:', !!localStorage.getItem('token'));
        window.location.href = destination;
    }, 1000);
}

// Sign Up Handler
async function handleSignUp(e) {
    e.preventDefault();
    
    const fullname = document.getElementById('fullname')?.value.trim();
    const email = document.getElementById('email')?.value.trim();
    const username = document.getElementById('username')?.value.trim();
    const password = document.getElementById('password')?.value;
    const confirmPassword = document.getElementById('confirmPassword')?.value;

    // Validation
    if (!fullname || !email || !username || !password || !confirmPassword) {
        showError('Please fill in all fields');
        return;
    }

    if (password !== confirmPassword) {
        showError('Passwords do not match');
        return;
    }

    if (password.length < 8) {
        showError('Password must be at least 8 characters long');
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account...';

    try {
        // Split fullname into first and last name
        const nameParts = fullname.split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');

        const data = await api.signup(email, password, username, firstName, lastName);
        
        if (data.success && data.token && data.user) {
            finalizeLogin(data, false, { source: 'signup' });
            return;
        }

        showError(data.error || 'Signup failed');
    } catch (error) {
        console.error('Signup error:', error);
        showError(error.message || 'Signup failed. Please try again.');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
}

// Logout Handler
async function handleLogout() {
    try {
        await api.logout();
    } catch (error) {
        console.error('Logout error:', error);
    }
    
    // Clear local storage
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('rememberMe');
    if (window.BalanceSync) {
        window.BalanceSync.clearUser({ reason: 'auth-logout' });
    }
    
    // Redirect to signin
    window.location.href = 'signin.html';
}

// Update Navigation based on auth state
function updateNavigation(isLoggedIn, user = null) {
    // For signin/signup pages with auth buttons
    const authButtons = document.querySelector('.auth-buttons');
    const userMenu = document.querySelector('.user-menu');
    
    if (authButtons) {
        if (isLoggedIn && user) {
            // Hide auth buttons, show user menu
            authButtons.style.display = 'none';
            
            if (userMenu) {
                userMenu.style.display = 'flex';
                const usernameEl = userMenu.querySelector('.username');
                const balanceEl = userMenu.querySelector('.balance');
                
                if (usernameEl) usernameEl.textContent = user.username || user.email;
                if (balanceEl) {
                    // Use global formatter if available, otherwise inline 5-decimal logic
                    if (typeof window.BOTZZZ_formatBalanceDisplay === 'function') {
                        balanceEl.textContent = window.BOTZZZ_formatBalanceDisplay(parseFloat(user.balance || 0));
                    } else {
                        const balance = parseFloat(user.balance || 0);
                        const formatted = balance.toFixed(5)
                            .replace(/(\.\d*?[1-9])0+$/, '$1')
                            .replace(/\.0+$/, '');
                        balanceEl.textContent = `$${formatted}`;
                    }
                }
            }
        } else {
            // Show auth buttons, hide user menu
            authButtons.style.display = 'flex';
            if (userMenu) userMenu.style.display = 'none';
        }
    }
    
    // For main navigation (index, services, etc.)
    const authNavItem = document.getElementById('authNavItem');
    
    if (authNavItem) {
        if (isLoggedIn && user) {
            // Replace Sign In button with user account dropdown
            authNavItem.innerHTML = `
                <div class="user-account-nav">
                    <a href="dashboard.html" class="nav-link" style="display: flex; align-items: center; gap: 8px;">
                        <i class="fas fa-user-circle"></i>
                        <span>${escapeHtml(user.username || user.username || user.email)}</span>
                    </a>
                    <div class="user-dropdown">
                        <a href="dashboard.html"><i class="fas fa-home"></i> Dashboard</a>
                        <a href="addfunds.html"><i class="fas fa-wallet"></i> Add Funds</a>
                        <a href="tickets.html"><i class="fas fa-ticket-alt"></i> Tickets</a>
                        <a href="#" onclick="handleLogout(); return false;"><i class="fas fa-sign-out-alt"></i> Logout</a>
                    </div>
                </div>
            `;
        } else {
            // Show Sign Up + Sign In buttons
            authNavItem.innerHTML = `
                <a href="signup.html" class="nav-link btn-outline">Sign Up</a>
                <a href="signin.html" class="nav-link btn-primary">Sign In</a>
            `;
        }

        authNavItem.removeAttribute('hidden');
        authNavItem.style.visibility = 'visible';
    }

    if (document.documentElement) {
        document.documentElement.classList.remove('auth-pending');
        document.documentElement.classList.add('auth-nav-ready');
    }
}

// Only subscribe to BalanceSync on non-auth pages to prevent interference
if (window.BalanceSync) {
    const isAuthPage = window.location.pathname.includes('signin') || 
                      window.location.pathname.includes('signup');
    
    if (!isAuthPage) {
        window.BalanceSync.subscribe(({ user, balance }) => {
            if (!user) {
                return;
            }
            const hydrated = { ...user };
            if (Number.isFinite(balance)) {
                hydrated.balance = balance;
            }
            updateNavigation(true, hydrated);
        });
    }
}

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Show error message
function showError(message) {
    removeMessages();
    const form = document.querySelector('form');
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message error';
    errorDiv.textContent = message;
    form.insertBefore(errorDiv, form.firstChild);
    
    setTimeout(removeMessages, 5000);
}

// Show success message
function showSuccess(message) {
    removeMessages();
    const form = document.querySelector('form');
    const successDiv = document.createElement('div');
    successDiv.className = 'message success';
    successDiv.textContent = message;
    form.insertBefore(successDiv, form.firstChild);
}

// Remove messages
function removeMessages() {
    const messages = document.querySelectorAll('.message');
    messages.forEach(msg => msg.remove());
}

// Toggle password visibility
function togglePassword() {
    const passwordInput = document.getElementById('password');
    const toggleIcon = document.querySelector('.toggle-password');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        if (toggleIcon) toggleIcon.textContent = '👁️';
    } else {
        passwordInput.type = 'password';
        if (toggleIcon) toggleIcon.textContent = '👁️‍🗨️';
    }
}

// Toggle confirm password visibility
function toggleConfirmPassword() {
    const passwordInput = document.getElementById('confirmPassword');
    const toggleIcon = document.querySelector('.toggle-confirm-password');
    
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        if (toggleIcon) toggleIcon.textContent = '👁️';
    } else {
        passwordInput.type = 'password';
        if (toggleIcon) toggleIcon.textContent = '👁️‍🗨️';
    }
}

function initializeAuthPopupSurface() {
    if (typeof window === 'undefined') {
        return;
    }

    try {
        const params = new URLSearchParams(window.location.search);
        authPopupMode = params.get('popup') === '1';
    } catch (error) {
        authPopupMode = false;
    }

    if (authPopupMode) {
        enablePopupSurface();
    }
}

function enablePopupSurface() {
    document.body.classList.add('popup-mode');
    popupSurfaceEl = document.querySelector('[data-popup-surface]');

    if (popupSurfaceEl) {
        popupSurfaceEl.setAttribute('role', 'dialog');
        popupSurfaceEl.setAttribute('aria-modal', 'true');
        popupSurfaceEl.setAttribute('aria-label', 'Authentication window');
        popupSurfaceEl.setAttribute('tabindex', '-1');
        requestAnimationFrame(() => popupSurfaceEl?.focus());
    }

    const closeButton = document.querySelector('[data-popup-close]');
    if (closeButton) {
        closeButton.addEventListener('click', handlePopupClose);
    }

    window.addEventListener('keydown', handlePopupKeydown);
}

function handlePopupKeydown(event) {
    if (event.key === 'Escape') {
        handlePopupClose();
    }
}

function handlePopupClose() {
    if (window.opener && !window.opener.closed) {
        try {
            window.opener.focus();
        } catch (error) {
            console.warn('[AUTH] Unable to focus opener window:', error);
        }
        window.close();
    }

    document.body.classList.remove('popup-mode');
    if (popupSurfaceEl) {
        popupSurfaceEl.removeAttribute('role');
        popupSurfaceEl.removeAttribute('aria-modal');
        popupSurfaceEl.removeAttribute('tabindex');
        popupSurfaceEl = null;
    }

    const closeButton = document.querySelector('[data-popup-close]');
    if (closeButton) {
        closeButton.removeEventListener('click', handlePopupClose);
    }

    window.removeEventListener('keydown', handlePopupKeydown);
    authPopupMode = false;
}

function notifyOpener(type, detail = {}) {
    if (!authPopupMode || !type) {
        return;
    }

    const openerWindow = window.opener;
    if (!openerWindow || openerWindow.closed) {
        return;
    }

    const payload = { type, ...detail };

    try {
        openerWindow.postMessage(payload, window.location.origin);
    } catch (error) {
        console.warn('[AUTH] Failed to notify opener window:', error);
    }
}

// Attach event listeners
document.addEventListener('DOMContentLoaded', () => {
    console.log('[AUTH] DOMContentLoaded - setting up form listeners');
    
    // Verify api client is loaded
    if (typeof api === 'undefined') {
        console.error('[AUTH] CRITICAL: api-client.js not loaded! Forms will not work.');
        return;
    }
    
    initializeAuthPopupSurface();
    ensureAdminOtpModalStructure();
    const signinForm = document.getElementById('signinForm');
    const signupForm = document.getElementById('signupForm');
    
    if (signinForm) {
        signinForm.addEventListener('submit', handleSignIn);
        signinForm.dataset.handlerAttached = 'true';
        console.log('[AUTH] Sign-in form listener attached successfully');
    } else {
        console.log('[AUTH] No signinForm found on this page');
    }

    if (signupForm) {
        signupForm.addEventListener('submit', handleSignUp);
        signupForm.dataset.handlerAttached = 'true';
        console.log('[AUTH] Sign-up form listener attached successfully');
    } else {
        console.log('[AUTH] No signupForm found on this page');
    }

    const adminOtpForm = document.getElementById('adminOtpForm');
    if (adminOtpForm) {
        adminOtpForm.addEventListener('submit', handleAdminOtpSubmit);
    }

    const closeAdminOtpModalBtn = document.getElementById('closeAdminOtpModal');
    if (closeAdminOtpModalBtn) {
        closeAdminOtpModalBtn.addEventListener('click', () => closeAdminOtpModal({ clearCredentials: true }));
    }

    const otpModalBackdrop = document.getElementById('adminOtpModal');
    if (otpModalBackdrop) {
        otpModalBackdrop.addEventListener('click', (event) => {
            if (event.target === otpModalBackdrop) {
                closeAdminOtpModal({ clearCredentials: true });
            }
        });
    }

    const resendOtpBtn = document.getElementById('resendAdminOtp');
    if (resendOtpBtn) {
        resendOtpBtn.addEventListener('click', handleAdminOtpResend);
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && document.body.classList.contains('modal-open')) {
            closeAdminOtpModal({ clearCredentials: true });
        }
    });
    
    // Logout buttons
    document.querySelectorAll('.logout-btn, [onclick*="logout"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            handleLogout();
        });
    });
});

if (typeof window !== 'undefined') {
    window.BOTZZZAuth = window.BOTZZZAuth || {};
    window.BOTZZZAuth.completeSession = function completeSession(data, options = {}) {
        const { rememberMe = false, ...context } = options;
        finalizeLogin(data, rememberMe, context);
    };
    window.BOTZZZAuth.isPopupMode = () => authPopupMode;
    window.BOTZZZAuth.closePopup = handlePopupClose;
}

// Get current user
function getCurrentUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
}

// Check if logged in
function isLoggedIn() {
    return !!localStorage.getItem('token');
}
