(function initRefundBroadcast() {
    const BANNER_SELECTOR = '[data-refund-banner]';
    const MESSAGE_SELECTOR = '[data-refund-message]';
    const DISMISS_BUTTON_SELECTOR = '[data-refund-dismiss]';
    const DISMISS_STORAGE_KEY = 'botzzz.dismissedRefundId';

    document.addEventListener('DOMContentLoaded', () => {
        const bannerNodes = document.querySelectorAll(BANNER_SELECTOR);
        if (!bannerNodes.length) {
            return;
        }

        bannerNodes.forEach(node => {
            const dismissBtn = node.querySelector(DISMISS_BUTTON_SELECTOR);
            if (dismissBtn) {
                dismissBtn.addEventListener('click', () => {
                    node.classList.add('hidden');
                    const snapshot = node.__refundSnapshot;
                    if (snapshot) {
                        persistDismissedId(snapshot);
                    }
                });
            }
        });

        const initial = window.RefundState?.getLatestRefundEvent();
        if (initial) {
            updateAllBanners(bannerNodes, initial);
        } else {
            hideAll(bannerNodes);
        }

        window.addEventListener('refund:updated', (event) => {
            if (!event?.detail) {
                return;
            }
            updateAllBanners(bannerNodes, event.detail);
        });
    });

    function updateAllBanners(nodes, snapshot) {
        if (!nodes || !nodes.length) {
            return;
        }
        if (shouldSuppress(snapshot)) {
            hideAll(nodes);
            return;
        }
        const message = buildRefundMessage(snapshot);
        nodes.forEach(node => {
            const messageNode = node.querySelector(MESSAGE_SELECTOR) || node;
            node.__refundSnapshot = snapshot;
            if (messageNode) {
                messageNode.textContent = message;
            }
            node.classList.remove('hidden');
        });
    }

    function hideAll(nodes) {
        nodes.forEach(node => node.classList.add('hidden'));
    }

    function buildRefundMessage(snapshot = {}) {
        const amount = formatCurrency(snapshot.amount, snapshot.currency);
        const label = snapshot.label || 'Recent refund';
        const relativeTime = formatRelativeTimestamp(snapshot.timestamp);
        return `${label} returned ${amount} to your balance ${relativeTime}.`;
    }

    function formatCurrency(amount, currency = 'USD') {
        const numeric = Number(amount);
        const safeCurrency = typeof currency === 'string' ? currency : 'USD';
        if (Number.isFinite(numeric)) {
            try {
                return new Intl.NumberFormat('en-US', {
                    style: 'currency',
                    currency: safeCurrency,
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }).format(numeric);
            } catch (error) {
                // Fallback to USD formatting if Intl fails
            }
            return `$${numeric.toFixed(2)}`;
        }
        return '$0.00';
    }

    function formatRelativeTimestamp(value) {
        const timestamp = typeof value === 'number' ? value : Date.parse(value);
        if (!Number.isFinite(timestamp)) {
            return 'just now';
        }
        const diff = Date.now() - timestamp;
        if (diff < 60 * 1000) {
            return 'just now';
        }
        if (diff < 60 * 60 * 1000) {
            const mins = Math.max(1, Math.floor(diff / (60 * 1000)));
            return `${mins}m ago`;
        }
        if (diff < 24 * 60 * 60 * 1000) {
            const hours = Math.max(1, Math.floor(diff / (60 * 60 * 1000)));
            return `${hours}h ago`;
        }
        const days = Math.max(1, Math.floor(diff / (24 * 60 * 60 * 1000)));
        return `${days}d ago`;
    }

    function persistDismissedId(snapshot) {
        const id = snapshot?.orderId || snapshot?.reference || `${snapshot?.timestamp || ''}`;
        if (!id) {
            return;
        }
        try {
            window.sessionStorage?.setItem(DISMISS_STORAGE_KEY, id);
        } catch (error) {
            console.warn('[RefundBanner] Failed to persist dismissal.', error);
        }
    }

    function shouldSuppress(snapshot) {
        if (!snapshot) {
            return true;
        }
        const storedId = (() => {
            try {
                return window.sessionStorage?.getItem(DISMISS_STORAGE_KEY) || '';
            } catch (error) {
                return '';
            }
        })();
        const currentId = snapshot.orderId || snapshot.reference || `${snapshot.timestamp || ''}`;
        return storedId && currentId && storedId === currentId;
    }
})();
