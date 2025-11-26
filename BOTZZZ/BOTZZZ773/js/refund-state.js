(function initRefundState(global) {
    const STORAGE_KEY = 'botzzz.latestRefundEvent';
    const REFUND_EVENT = 'refund:updated';
    const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

    if (global.RefundState) {
        return;
    }

    function sanitizeText(input, { max = 120 } = {}) {
        if (input === undefined || input === null) {
            return '';
        }
        const text = String(input).trim();
        if (!text) {
            return '';
        }
        return text.slice(0, max);
    }

    function sanitizeCurrency(value) {
        const text = sanitizeText(value, { max: 8 }).toUpperCase();
        return text || 'USD';
    }

    function coerceTimestamp(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value) {
            const parsed = Date.parse(value);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.getTime();
        }
        return Date.now();
    }

    function normalizeEventPayload(payload = {}) {
        const rawAmount = Number(payload.amount ?? payload.refundAmount);
        if (!Number.isFinite(rawAmount)) {
            return null;
        }
        const absoluteAmount = Math.abs(rawAmount);
        if (absoluteAmount === 0) {
            return null;
        }

        const normalized = {
            amount: Number(absoluteAmount.toFixed(4)),
            currency: sanitizeCurrency(payload.currency || payload.refundCurrency),
            label: sanitizeText(payload.label || payload.orderLabel || 'Order refund'),
            reference: sanitizeText(payload.reference || payload.transactionId || payload.providerOrderId, { max: 64 }),
            orderId: sanitizeText(payload.orderId || payload.id || payload.refundId, { max: 64 }),
            message: sanitizeText(payload.message || '' , { max: 240 }),
            source: sanitizeText(payload.source || 'system', { max: 40 }) || 'system',
            timestamp: coerceTimestamp(payload.timestamp || payload.updatedAt || payload.createdAt),
            recordedAt: Date.now()
        };

        return normalized;
    }

    function readFromStorage() {
        try {
            const raw = global.localStorage?.getItem(STORAGE_KEY);
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') {
                return null;
            }
            return parsed;
        } catch (error) {
            console.warn('[RefundState] Failed to read storage key.', error);
            return null;
        }
    }

    function writeToStorage(data) {
        try {
            global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (error) {
            console.warn('[RefundState] Failed to persist refund snapshot.', error);
        }
    }

    function recordLatestRefundEvent(payload) {
        const normalized = normalizeEventPayload(payload);
        if (!normalized) {
            return false;
        }
        writeToStorage(normalized);
        dispatchRefundEvent(normalized);
        return true;
    }

    function dispatchRefundEvent(detail) {
        if (typeof global.dispatchEvent !== 'function') {
            return;
        }
        try {
            const cloned = detail ? { ...detail } : null;
            global.dispatchEvent(new CustomEvent(REFUND_EVENT, { detail: cloned }));
        } catch (error) {
            console.warn('[RefundState] Failed to dispatch refund event.', error);
        }
    }

    function isExpired(entry, ttlMs = DEFAULT_TTL_MS) {
        if (!entry || typeof entry !== 'object') {
            return true;
        }
        const recordedAt = Number(entry.recordedAt);
        if (!Number.isFinite(recordedAt)) {
            return true;
        }
        return (Date.now() - recordedAt) > ttlMs;
    }

    function getLatestRefundEvent(options = {}) {
        const ttlMs = Number(options.maxAgeMs) > 0 ? Number(options.maxAgeMs) : DEFAULT_TTL_MS;
        const entry = readFromStorage();
        if (!entry || isExpired(entry, ttlMs)) {
            return null;
        }
        return { ...entry };
    }

    function clearRefundEvent() {
        try {
            global.localStorage?.removeItem(STORAGE_KEY);
        } catch (error) {
            console.warn('[RefundState] Failed to clear refund snapshot.', error);
        }
    }

    function handleStorageSync(event) {
        if (event.key !== STORAGE_KEY) {
            return;
        }
        const snapshot = readFromStorage();
        if (snapshot) {
            dispatchRefundEvent(snapshot);
        }
    }

    const api = Object.freeze({
        recordLatestRefundEvent,
        getLatestRefundEvent,
        clearRefundEvent,
        STORAGE_KEY,
        REFUND_EVENT,
        DEFAULT_TTL_MS
    });

    global.RefundState = api;

    if (typeof global.addEventListener === 'function') {
        global.addEventListener('storage', handleStorageSync);
        const announce = () => {
            const snapshot = getLatestRefundEvent();
            if (snapshot) {
                dispatchRefundEvent(snapshot);
            }
        };
        if (typeof queueMicrotask === 'function') {
            queueMicrotask(announce);
        } else {
            setTimeout(announce, 0);
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
