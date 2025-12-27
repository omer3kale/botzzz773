/**
 * Comprehensive Analytics Tracking
 * Tracks button clicks, form submissions, and scroll depth for GA4 and Facebook Pixel
 */

// ==========================================
// Button Click Tracking
// ==========================================
document.addEventListener('DOMContentLoaded', function() {
    // Track all button clicks with important classes/IDs
    const trackableButtons = document.querySelectorAll(
        'a[href*="order"], a[href*="signin"], a[href*="signup"], a[href*="addfunds"], ' +
        'button.btn-primary, button.btn-secondary, button.btn-success, button.btn-danger, ' +
        '[onclick*="order"], [onclick*="checkout"], [onclick*="login"], [onclick*="register"]'
    );

    trackableButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            const buttonText = this.textContent.trim() || this.getAttribute('aria-label') || 'Button';
            const buttonId = this.id || 'unnamed';
            const href = this.getAttribute('href') || '';
            
            // Google Analytics
            if (typeof gtag !== 'undefined') {
                gtag('event', 'button_click', {
                    'button_text': buttonText,
                    'button_id': buttonId,
                    'destination': href,
                    'page_path': window.location.pathname
                });
            }

            // Facebook Pixel
            if (typeof fbq !== 'undefined') {
                fbq('track', 'ViewContent', {
                    content_name: `Click: ${buttonText}`,
                    content_type: 'button',
                    page_path: window.location.pathname
                });
            }

            console.log('[ANALYTICS] Button clicked:', buttonText);
        });
    });

    // ==========================================
    // Form Submission Tracking
    // ==========================================
    const trackableForms = document.querySelectorAll(
        'form[id*="order"], form[id*="signin"], form[id*="signup"], form[id*="contact"], ' +
        'form[id*="login"], form[id*="register"], form[id*="payment"], form'
    );

    trackableForms.forEach(form => {
        form.addEventListener('submit', function(e) {
            const formId = this.id || 'unnamed-form';
            const formAction = this.action || window.location.pathname;
            
            // Google Analytics
            if (typeof gtag !== 'undefined') {
                gtag('event', 'form_submit', {
                    'form_id': formId,
                    'form_destination': formAction,
                    'page_path': window.location.pathname
                });
            }

            // Facebook Pixel
            if (typeof fbq !== 'undefined') {
                fbq('track', 'Lead', {
                    content_name: `Form: ${formId}`,
                    content_type: 'form',
                    page_path: window.location.pathname
                });
            }

            console.log('[ANALYTICS] Form submitted:', formId);
        });
    });

    // ==========================================
    // Scroll Depth Tracking
    // ==========================================
    let scrollTracked = {
        '25': false,
        '50': false,
        '75': false,
        '100': false
    };

    let lastScrollTrackTime = 0;
    const SCROLL_THROTTLE_MS = 500; // Throttle to avoid excessive events

    window.addEventListener('scroll', function() {
        const now = Date.now();
        if (now - lastScrollTrackTime < SCROLL_THROTTLE_MS) {
            return;
        }

        const windowHeight = window.innerHeight;
        const documentHeight = document.documentElement.scrollHeight;
        const scrolled = (window.scrollY + windowHeight) / documentHeight;
        const scrollPercent = Math.round(scrolled * 100);

        if (scrollPercent >= 25 && !scrollTracked['25']) {
            scrollTracked['25'] = true;
            trackScrollDepth(25);
        }
        if (scrollPercent >= 50 && !scrollTracked['50']) {
            scrollTracked['50'] = true;
            trackScrollDepth(50);
        }
        if (scrollPercent >= 75 && !scrollTracked['75']) {
            scrollTracked['75'] = true;
            trackScrollDepth(75);
        }
        if (scrollPercent >= 95 && !scrollTracked['100']) {
            scrollTracked['100'] = true;
            trackScrollDepth(100);
        }

        lastScrollTrackTime = now;
    }, { passive: true });

    function trackScrollDepth(percent) {
        // Google Analytics
        if (typeof gtag !== 'undefined') {
            gtag('event', 'scroll_depth', {
                'scroll_percent': percent,
                'page_title': document.title,
                'page_path': window.location.pathname
            });
        }

        // Facebook Pixel
        if (typeof fbq !== 'undefined') {
            fbq('track', 'ViewContent', {
                content_name: `Scroll: ${percent}%`,
                content_type: 'scroll',
                page_path: window.location.pathname
            });
        }

        console.log('[ANALYTICS] Page scrolled to:', percent + '%');
    }

    // ==========================================
    // Purchase/Order Tracking (Optional)
    // ==========================================
    // Call this function when order is placed successfully
    window.trackPurchase = function(orderId, amount, currency = 'USD') {
        if (typeof gtag !== 'undefined') {
            gtag('event', 'purchase', {
                'transaction_id': orderId,
                'value': amount,
                'currency': currency
            });
        }

        if (typeof fbq !== 'undefined') {
            fbq('track', 'Purchase', {
                value: amount,
                currency: currency,
                content_name: 'Order',
                content_type: 'product'
            });
        }

        console.log('[ANALYTICS] Purchase tracked:', orderId, amount, currency);
    };

    // ==========================================
    // Link Click Tracking
    // ==========================================
    document.addEventListener('click', function(e) {
        const link = e.target.closest('a[href]');
        if (!link) return;

        const href = link.getAttribute('href');
        const text = link.textContent.trim() || 'Link';

        // Skip hash links and javascripts
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            if (typeof gtag !== 'undefined') {
                gtag('event', 'link_click', {
                    'link_text': text,
                    'link_url': href,
                    'page_path': window.location.pathname
                });
            }
        }
    }, true);

    console.log('[ANALYTICS] Tracking initialized - Button clicks, Forms, Scroll depth enabled');
});
