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

// Admin Signin Toggle Function
function toggleAdminSignin() {
    const adminOtpGroup = document.getElementById('adminOtpGroup');
    const adminToggle = document.getElementById('adminSigninToggle');
    
    if (adminOtpGroup.style.display === 'none') {
        adminOtpGroup.style.display = 'block';
        adminToggle.textContent = 'Regular Sign In';
        adminToggle.classList.add('active');
    } else {
        adminOtpGroup.style.display = 'none';
        adminToggle.textContent = 'Admin Sign In';
        adminToggle.classList.remove('active');
        document.getElementById('adminOtp').value = '';
    }
}

// Request Admin OTP
async function requestAdminOTP(email, password) {
    try {
        const data = await api.login(email, password, null, true); // requestOtp = true
        return data;
    } catch (error) {
        throw error;
    }
}

// Sign In Handler
async function handleSignIn(e) {
    e.preventDefault();
    
    const email = document.getElementById('email')?.value.trim();
    const password = document.getElementById('password')?.value;
    const rememberMe = document.getElementById('remember')?.checked;
    const adminOtp = document.getElementById('adminOtp')?.value?.trim();
    const isAdminSignin = document.getElementById('adminOtpGroup')?.style.display !== 'none';
    const hasOtpCode = adminOtp && adminOtp.length === 6;

    if (!email || !password) {
        showError('Please fill in all fields');
        return;
    }
    
    if (isAdminSignin && hasOtpCode && !/^[0-9]{6}$/.test(adminOtp)) {
        showError('Please enter a valid 6-digit OTP code');
        return;
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try {
        // Admin signin flow: request OTP first if no OTP provided
        if (isAdminSignin && !hasOtpCode) {
            submitBtn.textContent = 'Requesting OTP...';
            
            const otpData = await requestAdminOTP(email, password);
            
            if (otpData.success && otpData.requiresOtp) {
                showSuccess(otpData.message || 'OTP sent to admin email');
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                
                // Focus on OTP input
                const otpInput = document.getElementById('adminOtp');
                if (otpInput) {
                    otpInput.focus();
                }
                return;
            } else {
                showError(otpData.error || 'Failed to request OTP');
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                return;
            }
        }
        
        // Normal signin or admin signin with OTP
        submitBtn.textContent = isAdminSignin ? 'Verifying OTP...' : 'Signing in...';
        
        const data = await api.login(email, password, hasOtpCode ? adminOtp : null);
        
        if (data.success && data.token && data.user) {
            // Store token and user data
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            
            if (rememberMe) {
                localStorage.setItem('rememberMe', 'true');
            }

            // Validate admin access when admin signin is used
            if (isAdminSignin && data.user.role !== 'admin') {
                showError('Invalid admin credentials or OTP code');
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
                return;
            }
            
            showSuccess('Login successful! Redirecting...');
            
            // Redirect based on role
            setTimeout(() => {
                if (data.user.role === 'admin') {
                    window.location.href = 'admin/index.html';
                } else {
                    window.location.href = 'dashboard.html';
                }
            }, 1000);
        } else {
            showError(data.error || 'Login failed');
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    } catch (error) {
        console.error('Login error:', error);
        showError(error.message || 'Login failed. Please try again.');
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
    }
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
