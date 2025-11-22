// Authentication with Backend Integration
// Load this AFTER api-client.js

// Check if user is already logged in on page load
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuthStatus();
});

// Check authentication status
async function checkAuthStatus() {
    const token = localStorage.getItem('token');
    
    if (!token) {
        updateNavigation(false);
        return false;
    }

    try {
        const data = await api.verifyToken(token);
        if (data.success && data.user) {
            localStorage.setItem('user', JSON.stringify(data.user));
            updateNavigation(true, data.user);
            return true;
        } else {
            // Token invalid, clear and logout
            handleLogout();
            return false;
        }
    } catch (error) {
        console.error('Auth verification failed:', error);
        handleLogout();
        return false;
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
        <div class="otp-modal-backdrop" id="adminOtpModal" aria-hidden="true">
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
        console.warn('Admin OTP modal not found in DOM.');
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
    document.body.classList.add('modal-open');

    setOtpFeedback(message || 'OTP sent to your admin email. Enter the code to continue.', 'success');
    updateAdminOtpCountdown();

    if (adminOtpCountdownInterval) {
        clearInterval(adminOtpCountdownInterval);
    }
    adminOtpCountdownInterval = setInterval(updateAdminOtpCountdown, 1000);
}

function closeAdminOtpModal({ clearCredentials = false } = {}) {
    const modal = document.getElementById('adminOtpModal');
    if (!modal) {
        return;
    }

    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');

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
        clearAdminOtpCredentials();
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

function finalizeLogin(data, rememberMe) {
    if (!data || !data.token || !data.user) {
        showError('Login failed. Please try again.');
        return;
    }

    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));

    if (rememberMe) {
        localStorage.setItem('rememberMe', 'true');
    } else {
        localStorage.removeItem('rememberMe');
    }

    showSuccess('Login successful! Redirecting...');

    setTimeout(() => {
        if (data.user.role === 'admin') {
            window.location.href = 'admin/index.html';
        } else {
            window.location.href = 'dashboard.html';
        }
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
            // Store token and user data
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));

            showSuccess('Account created successfully! Redirecting...');
            
            // Redirect to dashboard
            setTimeout(() => {
                window.location.href = 'dashboard.html';
            }, 1500);
        } else {
            showError(data.error || 'Signup failed');
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    } catch (error) {
        console.error('Signup error:', error);
        showError(error.message || 'Signup failed. Please try again.');
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
                if (balanceEl) balanceEl.textContent = `$${parseFloat(user.balance || 0).toFixed(2)}`;
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
                        <span>${escapeHtml(user.fullname || user.email)}</span>
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
            // Show Sign In button
            authNavItem.innerHTML = `
                <a href="signin.html" class="nav-link btn-primary">Sign In</a>
            `;
        }
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

// Attach event listeners
document.addEventListener('DOMContentLoaded', () => {
    ensureAdminOtpModalStructure();
    const signinForm = document.getElementById('signinForm');
    const signupForm = document.getElementById('signupForm');
    
    if (signinForm) {
        signinForm.addEventListener('submit', handleSignIn);
        console.log('Sign-in form listener attached');
    }

    if (signupForm) {
        signupForm.addEventListener('submit', handleSignUp);
        console.log('Sign-up form listener attached');
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

// Get current user
function getCurrentUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
}

// Check if logged in
function isLoggedIn() {
    return !!localStorage.getItem('token');
}
