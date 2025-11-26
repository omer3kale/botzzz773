// ==========================================
// Contact Page JavaScript
// ==========================================

let isPopupMode = false;

document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    isPopupMode = urlParams.get('popup') === '1';

    if (isPopupMode) {
        enablePopupSurface();
    }

    const contactForm = document.getElementById('contactForm');
    
    if (contactForm) {
        contactForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            // Get form data
            const formData = new FormData(contactForm);
            const data = {
                name: formData.get('name'),
                email: formData.get('email'),
                subject: formData.get('subject'),
                message: formData.get('message')
            };
            
            // Validate
            if (!data.name || data.name.trim().length < 2) {
                showMessage('Please enter your name', 'error');
                return;
            }
            
            if (!validateEmail(data.email)) {
                showMessage('Please enter a valid email address', 'error');
                return;
            }
            
            if (!data.subject) {
                showMessage('Please select a subject', 'error');
                return;
            }
            
            if (!data.message || data.message.trim().length < 10) {
                showMessage('Please enter a message (at least 10 characters)', 'error');
                return;
            }
            
            // Show loading
            const submitBtn = contactForm.querySelector('button[type="submit"]');
            showLoading(submitBtn);
            
            // Send to backend
            try {
                const response = await fetch('/.netlify/functions/contact', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();
                
                hideLoading(submitBtn);

                if (response.ok && result.success) {
                    // Show success message
                    showMessage('Message sent successfully! We\'ll get back to you within 2-4 hours.', 'success');
                    notifyOpener();
                    
                    // Reset form
                    contactForm.reset();
                    
                    // Scroll to top
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    throw new Error(result.error || 'Failed to send message');
                }
            } catch (error) {
                console.error('Contact form submission error:', error);
                hideLoading(submitBtn);
                showMessage(error.message || 'Failed to send message. Please try again.', 'error');
            }
        });
    }
    
    // Real-time email validation
    const emailInput = document.getElementById('email');
    if (emailInput) {
        emailInput.addEventListener('blur', function() {
            if (this.value && !validateEmail(this.value)) {
                this.style.borderColor = '#ef4444';
            } else if (this.value) {
                this.style.borderColor = '#10b981';
            }
        });
    }
    
    // Character counter for message
    const messageInput = document.getElementById('message');
    if (messageInput) {
        const charCounter = document.createElement('div');
        charCounter.style.cssText = 'text-align: right; font-size: 0.85rem; color: var(--text-gray); margin-top: 4px;';
        messageInput.parentNode.appendChild(charCounter);
        
        messageInput.addEventListener('input', function() {
            const length = this.value.length;
            charCounter.textContent = `${length} characters`;
            
            if (length >= 10) {
                charCounter.style.color = '#10b981';
            } else {
                charCounter.style.color = '#ef4444';
            }
        });
    }
});

console.log('📧 Contact page loaded!');

function enablePopupSurface() {
    document.body.classList.add('popup-mode');
    const panel = document.querySelector('[data-popup-surface]');
    if (panel) {
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-label', 'Contact BOTZZZ support window');
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

function notifyOpener() {
    if (!isPopupMode || !window.opener || window.opener.closed) {
        return;
    }
    try {
        window.opener.postMessage({ type: 'CONTACT_MESSAGE_SENT' }, window.location.origin);
    } catch (error) {
        console.warn('Failed to notify opener about contact submission.', error);
    }
}
