'use strict';

(function() {
    const REDIRECT_DELAY_MS = 5000;
    const COUNTDOWN_INTERVAL_MS = 1000;
    const AUTH_ALERT_MESSAGE = 'Please sign in to continue your payment flow. You will be redirected to the sign-in page.';

    let isPopupMode = false;
    let authGuardTriggered = false;
    let redirectTarget = 'dashboard.html';
    let redirectTimerId = null;
    let countdownIntervalId = null;

    document.addEventListener('DOMContentLoaded', () => {
        const status = (document.body.dataset.paymentStatus || 'success').toLowerCase();
        redirectTarget = document.body.dataset.redirectTarget || (status === 'success' ? 'dashboard.html' : 'addfunds.html');

        const urlParams = new URLSearchParams(window.location.search);
        isPopupMode = urlParams.get('popup') === '1';
        if (isPopupMode) {
            enablePopupSurface();
        }

        if (!resolveAuthToken(`${status}-status`)) {
            return;
        }

        wireCloseButtons();
        announceStatus(status);
        startCountdown();
    });

    function wireCloseButtons() {
        document.querySelectorAll('[data-close-window]').forEach((button) => {
            button.addEventListener('click', handlePopupClose);
        });
    }

    function announceStatus(status) {
        const payload = {
            type: status === 'success' ? 'PAYMENT_SUCCESS' : 'PAYMENT_FAILED',
            source: 'payment-status',
            status
        };
        notifyOpener(payload);
    }

    function startCountdown() {
        const countdownEl = document.querySelector('[data-countdown]');
        let remainingMs = REDIRECT_DELAY_MS;

        const updateDisplay = () => {
            if (!countdownEl) {
                return;
            }
            const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
            countdownEl.textContent = String(seconds);
        };

        updateDisplay();

        countdownIntervalId = setInterval(() => {
            remainingMs -= COUNTDOWN_INTERVAL_MS;
            if (remainingMs <= 0) {
                clearInterval(countdownIntervalId);
                countdownIntervalId = null;
            }
            updateDisplay();
        }, COUNTDOWN_INTERVAL_MS);

        redirectTimerId = setTimeout(() => {
            finalizeNavigation(redirectTarget);
        }, REDIRECT_DELAY_MS);
    }

    function handlePopupClose() {
        finalizeNavigation(redirectTarget);
    }

    function finalizeNavigation(target) {
        cancelPendingRedirect();

        if (isPopupMode && window.opener && !window.opener.closed) {
            window.opener.focus();
            window.close();
            return;
        }

        try {
            const destination = new URL(target, window.location.origin).toString();
            window.location.href = destination;
        } catch (error) {
            console.warn('[PAYMENT STATUS] Failed to build redirect URL, falling back to raw target.', error);
            window.location.href = target;
        }
    }

    function cancelPendingRedirect() {
        if (redirectTimerId) {
            clearTimeout(redirectTimerId);
            redirectTimerId = null;
        }
        if (countdownIntervalId) {
            clearInterval(countdownIntervalId);
            countdownIntervalId = null;
        }
    }

    function enablePopupSurface() {
        document.body.classList.add('popup-mode');
        const panel = document.querySelector('[data-popup-surface]');
        if (panel) {
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-label', 'Payment status window');
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

    function notifyOpener(payload) {
        if (!isPopupMode || !window.opener || window.opener.closed) {
            return;
        }

        try {
            window.opener.postMessage(payload, window.location.origin);
        } catch (error) {
            console.warn('[PAYMENT STATUS] Failed to notify opener.', error);
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
            console.warn('[PAYMENT STATUS] Unable to read auth token from storage.', error);
            return null;
        }
    }

    function handleMissingAuth(reason) {
        if (authGuardTriggered) {
            return;
        }
        authGuardTriggered = true;

        const payload = { type: 'AUTH_REQUIRED', source: 'payment-status', reason };
        notifyOpener(payload);

        if (isPopupMode) {
            setTimeout(() => {
                try {
                    window.close();
                } catch (error) {
                    console.warn('[PAYMENT STATUS] Unable to close popup after auth guard.', error);
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
})();
