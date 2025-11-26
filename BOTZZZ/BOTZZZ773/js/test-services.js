'use strict';

(function() {
    const AUTH_ALERT_MESSAGE = 'Please sign in to run the services diagnostic. You will be redirected to the sign-in page.';
    const SERVICE_ENDPOINT = '/.netlify/functions/services';

    let isPopupMode = false;
    let authGuardTriggered = false;
    let resultsContainer = null;
    let runningDiagnostic = null;
    const buttonRegistry = new Map();

    document.addEventListener('DOMContentLoaded', () => {
        const params = new URLSearchParams(window.location.search);
        isPopupMode = params.get('popup') === '1';
        if (isPopupMode) {
            enablePopupSurface();
        }

        resultsContainer = document.getElementById('results');
        wireButtons();

        const token = resolveAuthToken('initial-load');
        if (!token) {
            disableDiagnostics('Authentication required to run diagnostics.');
            return;
        }

        setTimeout(() => runDiagnostic('fetch'), 500);
    });

    function wireButtons() {
        document.querySelectorAll('[data-diagnostic]').forEach((button) => {
            const action = button.dataset.diagnostic;
            if (!action) {
                return;
            }
            button.type = 'button';
            buttonRegistry.set(action, button);
            button.addEventListener('click', () => handleDiagnosticTrigger(action));
        });
    }

    function handleDiagnosticTrigger(action) {
        if (action === 'clear') {
            clearResults();
            return;
        }
        runDiagnostic(action);
    }

    async function runDiagnostic(action) {
        if (runningDiagnostic || !resultsContainer) {
            return;
        }

        const token = resolveAuthToken(`${action}-diagnostic`);
        if (!token) {
            disableDiagnostics('Authentication required to run diagnostics.');
            return;
        }

        runningDiagnostic = action;
        setButtonBusy(action, true);
        clearResults();

        const label = action === 'xhr' ? 'XMLHttpRequest' : 'Fetch API';
        logMessage(`🚀 Testing ${label}...`, 'info');

        const startTime = performance.now();

        try {
            const payload = action === 'xhr'
                ? await executeXhr(token)
                : await executeFetch(token);

            const duration = Math.round(performance.now() - startTime);
            const services = Array.isArray(payload.payload?.services) ? payload.payload.services : [];

            logMessage(`✅ Response received in ${duration}ms`, 'success');
            logMessage(`Status: ${payload.statusCode} ${payload.statusText}`, 'info');
            if (payload.headers) {
                logMessage(`Headers: ${JSON.stringify(payload.headers, null, 2)}`, 'info');
            }
            logMessage(`Services count: ${services.length}`, services.length ? 'info' : 'error');

            if (services.length > 0) {
                logMessage(`✅ First service: ${services[0].name || 'Unnamed service'}`, 'success');
                appendSample(services[0]);
            } else {
                logMessage('❌ No services returned!', 'error');
            }

            notifyOpener({
                type: 'SERVICES_DIAGNOSTIC_COMPLETED',
                transport: action,
                success: services.length > 0,
                durationMs: duration,
                serviceCount: services.length
            });
        } catch (error) {
            logMessage(`❌ ${error?.message || 'Diagnostic failed.'}`, 'error');
            notifyOpener({
                type: 'SERVICES_DIAGNOSTIC_FAILED',
                transport: action,
                message: error?.message || 'Diagnostic failed.'
            });
        } finally {
            setButtonBusy(action, false);
            runningDiagnostic = null;
        }
    }

    async function executeFetch(token) {
        const headers = buildHeaders(token);
        const response = await fetch(SERVICE_ENDPOINT, {
            method: 'GET',
            headers
        });

        const payload = await safeJson(response);
        return {
            statusCode: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            payload
        };
    }

    function executeXhr(token) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', SERVICE_ENDPOINT);
            xhr.setRequestHeader('Content-Type', 'application/json');
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }

            xhr.onload = () => {
                try {
                    const payload = JSON.parse(xhr.responseText || '{}');
                    resolve({
                        statusCode: xhr.status,
                        statusText: xhr.statusText,
                        headers: parseHeaderString(xhr.getAllResponseHeaders()),
                        payload
                    });
                } catch (error) {
                    reject(error);
                }
            };

            xhr.onerror = () => reject(new Error('XMLHttpRequest failed.'));
            xhr.ontimeout = () => reject(new Error('XMLHttpRequest timed out.'));

            xhr.send();
        });
    }

    function buildHeaders(token) {
        const headers = {
            'Content-Type': 'application/json'
        };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        return headers;
    }

    async function safeJson(response) {
        try {
            return await response.json();
        } catch (error) {
            return {};
        }
    }

    function parseHeaderString(rawHeaders) {
        if (!rawHeaders) {
            return null;
        }
        return rawHeaders.trim().split(/\r?\n/).reduce((acc, line) => {
            const separatorIndex = line.indexOf(':');
            if (separatorIndex === -1) {
                return acc;
            }
            const key = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();
            if (key) {
                acc[key] = value;
            }
            return acc;
        }, {});
    }

    function clearResults() {
        if (resultsContainer) {
            resultsContainer.textContent = '';
        }
    }

    function logMessage(message, variant = 'info') {
        if (!resultsContainer) {
            return;
        }
        const entry = document.createElement('p');
        entry.className = variant;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        resultsContainer.appendChild(entry);
        resultsContainer.scrollTop = resultsContainer.scrollHeight;
    }

    function appendSample(sample) {
        if (!resultsContainer || !sample) {
            return;
        }
        const pre = document.createElement('pre');
        pre.textContent = JSON.stringify(sample, null, 2);
        resultsContainer.appendChild(pre);
    }

    function setButtonBusy(action, busy) {
        const button = buttonRegistry.get(action);
        if (!button) {
            return;
        }
        if (busy) {
            button.disabled = true;
            button.dataset.originalLabel = button.dataset.originalLabel || button.textContent;
            button.textContent = 'Running...';
        } else {
            button.disabled = false;
            if (button.dataset.originalLabel) {
                button.textContent = button.dataset.originalLabel;
            }
        }
    }

    function disableDiagnostics(message) {
        buttonRegistry.forEach((button) => {
            if (button.dataset.diagnostic !== 'clear') {
                button.disabled = true;
            }
        });
        if (message) {
            logMessage(message, 'error');
        }
    }

    function enablePopupSurface() {
        document.body.classList.add('popup-mode');
        const panel = document.querySelector('[data-popup-surface]');
        if (panel) {
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-label', 'Services diagnostic window');
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
            console.warn('[TEST SERVICES] Failed to notify opener.', error);
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
            console.warn('[TEST SERVICES] Unable to read auth token.', error);
            return null;
        }
    }

    function handleMissingAuth(reason) {
        if (authGuardTriggered) {
            return;
        }
        authGuardTriggered = true;

        disableDiagnostics('Authentication required.');
        notifyOpener({ type: 'AUTH_REQUIRED', source: 'test-services', reason });

        if (isPopupMode) {
            setTimeout(() => {
                try {
                    window.close();
                } catch (error) {
                    console.warn('[TEST SERVICES] Unable to close popup after auth guard.', error);
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
