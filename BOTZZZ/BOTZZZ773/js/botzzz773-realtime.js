/**
 * ==========================================
 * BOTZZZ773 Real-Time WebSocket Client v2.0.0
 * ==========================================
 * 
 * Professional SMM Panel Real-Time Engine
 * Copyright (c) 2025 BOTZZZ773. All rights reserved.
 * 
 * Provides instant WebSocket updates for:
 * - Orders (status changes, new orders, failed orders)
 * - Payments (completed, pending, failed)
 * - Tickets (new, replies, closed)
 * - User balance changes
 * 
 * Uses Supabase Realtime for PostgreSQL change data capture
 * ==========================================
 */

(function(global) {
    'use strict';

    // ==========================================
    // CONFIGURATION
    // ==========================================
    
    const CONFIG = Object.freeze({
        VERSION: '2.0.0',
        PRODUCT: 'BOTZZZ773',
        
        // Timing
        INIT_RETRY_INTERVAL_MS: 300,
        INIT_MAX_RETRIES: 30,
        HEARTBEAT_INTERVAL_MS: 30000,
        RECONNECT_DELAY_MS: 3000,
        MAX_RECONNECT_ATTEMPTS: 10,
        
        // Channel prefixes
        CHANNEL_PREFIX: 'botzzz773',
        
        // Debug mode (set to false in production)
        DEBUG: true
    });

    // ==========================================
    // STATE
    // ==========================================
    
    let state = {
        client: null,
        subscriptions: new Map(),
        eventListeners: new Map(),
        pendingSubscriptions: [],
        heartbeatTimer: null,
        isConnected: false,
        isInitializing: false,
        initRetries: 0,
        reconnectAttempts: 0
    };

    // ==========================================
    // LOGGING
    // ==========================================
    
    function log(level, message, data = null) {
        if (!CONFIG.DEBUG && level === 'debug') return;
        
        const prefix = `[${CONFIG.PRODUCT} Realtime]`;
        const timestamp = new Date().toISOString().substr(11, 12);
        
        const logFn = {
            'debug': console.log,
            'info': console.info,
            'warn': console.warn,
            'error': console.error
        }[level] || console.log;
        
        if (data) {
            logFn(`${prefix} [${timestamp}] ${message}`, data);
        } else {
            logFn(`${prefix} [${timestamp}] ${message}`);
        }
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================
    
    /**
     * Initialize the BOTZZZ773 real-time connection
     * @returns {boolean} true if connected or connecting
     */
    function init() {
        if (state.client) {
            log('debug', 'Already initialized');
            return true;
        }
        
        if (state.isInitializing) {
            log('debug', 'Initialization in progress...');
            return true;
        }

        log('info', `Initializing v${CONFIG.VERSION}`);
        state.isInitializing = true;

        // Try immediate connection
        if (tryConnect()) {
            return true;
        }

        // Schedule retry
        scheduleInitRetry();
        return true;
    }
    
    /**
     * Attempt to connect to Supabase client
     * @returns {boolean} true if connected
     */
    function tryConnect() {
        // Method 1: BOTZZZ773_SupabaseClient module
        if (typeof global.BOTZZZ773_SupabaseClient !== 'undefined' && 
            global.BOTZZZ773_SupabaseClient.isReady()) {
            state.client = global.BOTZZZ773_SupabaseClient.getClientSync();
            onConnected('BOTZZZ773_SupabaseClient');
            return true;
        }
        
        // Method 2: BOTZZZ773_SUPABASE global
        if (global.BOTZZZ773_SUPABASE) {
            state.client = global.BOTZZZ773_SUPABASE;
            onConnected('BOTZZZ773_SUPABASE global');
            return true;
        }

        // Method 3: Direct supabase client
        if (global.supabase && typeof global.supabase.channel === 'function') {
            state.client = global.supabase;
            onConnected('window.supabase');
            return true;
        }

        return false;
    }
    
    /**
     * Handle successful connection
     * @param {string} source - Connection source for logging
     */
    function onConnected(source) {
        log('info', `Connected via ${source}`);
        state.isConnected = true;
        state.isInitializing = false;
        state.initRetries = 0;
        
        startHeartbeat();
        processPendingSubscriptions();
        emit('connected', { version: CONFIG.VERSION, source });
    }
    
    /**
     * Schedule initialization retry
     */
    function scheduleInitRetry() {
        if (state.initRetries >= CONFIG.INIT_MAX_RETRIES) {
            log('warn', `Failed to connect after ${CONFIG.INIT_MAX_RETRIES} attempts`);
            state.isInitializing = false;
            emit('error', { type: 'init_timeout', attempts: state.initRetries });
            return;
        }
        
        state.initRetries++;
        log('debug', `Retry ${state.initRetries}/${CONFIG.INIT_MAX_RETRIES}`);
        
        setTimeout(() => {
            if (!state.client && tryConnect()) {
                return;
            }
            if (!state.client) {
                scheduleInitRetry();
            }
        }, CONFIG.INIT_RETRY_INTERVAL_MS);
    }
    
    // Listen for supabase:ready event
    if (typeof global.addEventListener === 'function') {
        global.addEventListener('supabase:ready', function(event) {
            if (event.detail?.client && !state.client) {
                log('info', 'Received supabase:ready event');
                state.client = event.detail.client;
                onConnected('supabase:ready event');
            }
        });
    }

    // ==========================================
    // SUBSCRIPTIONS
    // ==========================================
    
    /**
     * Subscribe to order updates
     * @param {Function} callback - Called on order changes
     * @param {Object} options - Filter options
     * @returns {Object|null} Subscription channel
     */
    function subscribeToOrders(callback, options = {}) {
        return createSubscription('orders', 'orders', callback, options);
    }
    
    /**
     * Subscribe to payment updates
     * @param {Function} callback - Called on payment changes
     * @param {Object} options - Filter options
     * @returns {Object|null} Subscription channel
     */
    function subscribeToPayments(callback, options = {}) {
        return createSubscription('payments', 'payments', callback, options);
    }
    
    /**
     * Subscribe to ticket updates
     * @param {Function} callback - Called on ticket changes
     * @param {Object} options - Filter options
     * @returns {Object|null} Subscription channel
     */
    function subscribeToTickets(callback, options = {}) {
        return createSubscription('tickets', 'tickets', callback, options);
    }
    
    /**
     * Subscribe to user balance updates
     * @param {string} userId - User ID to watch
     * @param {Function} callback - Called on balance changes
     * @returns {Object|null} Subscription channel
     */
    function subscribeToBalance(userId, callback) {
        if (!userId) return null;
        return createSubscription('balance', 'users', callback, { 
            userId, 
            filter: `id=eq.${userId}`,
            event: 'UPDATE'
        });
    }
    
    /**
     * Create a subscription to a table
     * @param {string} type - Subscription type
     * @param {string} table - Database table name
     * @param {Function} callback - Change handler
     * @param {Object} options - Subscription options
     * @returns {Object|null} Subscription channel
     */
    function createSubscription(type, table, callback, options = {}) {
        // Queue if not connected yet
        if (!state.client) {
            log('debug', `Queueing ${type} subscription`);
            state.pendingSubscriptions.push({ type, table, callback, options });
            return null;
        }
        
        const channelName = `${CONFIG.CHANNEL_PREFIX}-${type}-${options.userId || 'all'}`;
        
        // Remove existing subscription
        if (state.subscriptions.has(channelName)) {
            state.subscriptions.get(channelName).unsubscribe();
            state.subscriptions.delete(channelName);
        }
        
        // Create channel config
        const channelConfig = {
            event: options.event || '*',
            schema: 'public',
            table: table
        };
        
        if (options.filter) {
            channelConfig.filter = options.filter;
        }
        
        // Create subscription
        const channel = state.client
            .channel(channelName)
            .on('postgres_changes', channelConfig, (payload) => {
                handlePayload(type, table, payload, callback);
            })
            .subscribe((status) => {
                log('debug', `${type} subscription: ${status}`);
                if (status === 'SUBSCRIBED') {
                    state.isConnected = true;
                    emit(`${type}:subscribed`, { channelName });
                }
            });
        
        state.subscriptions.set(channelName, channel);
        log('info', `Subscribed to ${type}`);
        return channel;
    }
    
    /**
     * Handle incoming payload from Supabase
     * @param {string} type - Subscription type
     * @param {string} table - Table name
     * @param {Object} payload - Supabase payload
     * @param {Function} callback - User callback
     */
    function handlePayload(type, table, payload, callback) {
        const data = {
            type: payload.eventType,
            record: payload.new || payload.old,
            oldRecord: payload.old,
            table: table,
            timestamp: new Date().toISOString()
        };
        
        log('debug', `${type} ${payload.eventType}`, data.record?.id);
        
        // Emit generic change event
        emit(`${type}:change`, data);
        
        // Emit specific status events
        const status = data.record?.status?.toLowerCase();
        if (status) {
            if (status === 'failed' || status === 'error') {
                emit(`${type}:failed`, data);
            } else if (status === 'completed') {
                emit(`${type}:completed`, data);
            } else if (status === 'refunded' || status === 'partial') {
                emit(`${type}:refunded`, data);
            }
        }
        
        // Special handling for balance changes
        if (type === 'balance' && payload.new?.balance !== payload.old?.balance) {
            emit('balance:updated', {
                userId: payload.new?.id,
                balance: payload.new?.balance,
                previousBalance: payload.old?.balance,
                timestamp: data.timestamp
            });
        }
        
        // Call user callback
        if (typeof callback === 'function') {
            try {
                callback(data);
            } catch (err) {
                log('error', 'Callback error', err);
            }
        }
    }
    
    /**
     * Process queued subscriptions after connection
     */
    function processPendingSubscriptions() {
        if (state.pendingSubscriptions.length === 0) return;
        
        log('info', `Processing ${state.pendingSubscriptions.length} queued subscriptions`);
        
        const pending = [...state.pendingSubscriptions];
        state.pendingSubscriptions = [];
        
        pending.forEach(sub => {
            createSubscription(sub.type, sub.table, sub.callback, sub.options);
        });
    }

    // ==========================================
    // EVENT SYSTEM
    // ==========================================
    
    /**
     * Add event listener
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     */
    function on(event, callback) {
        if (!state.eventListeners.has(event)) {
            state.eventListeners.set(event, []);
        }
        state.eventListeners.get(event).push(callback);
    }
    
    /**
     * Remove event listener
     * @param {string} event - Event name
     * @param {Function} callback - Event handler to remove
     */
    function off(event, callback) {
        if (!state.eventListeners.has(event)) return;
        
        const listeners = state.eventListeners.get(event);
        const index = listeners.indexOf(callback);
        if (index > -1) {
            listeners.splice(index, 1);
        }
    }
    
    /**
     * Emit event to all listeners
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    function emit(event, data) {
        if (!state.eventListeners.has(event)) return;
        
        state.eventListeners.get(event).forEach(callback => {
            try {
                callback(data);
            } catch (err) {
                log('error', `Event handler error for ${event}`, err);
            }
        });
    }

    // ==========================================
    // UTILITIES
    // ==========================================
    
    /**
     * Unsubscribe from a specific channel
     * @param {string} channelName - Channel to unsubscribe from
     */
    function unsubscribe(channelName) {
        if (state.subscriptions.has(channelName)) {
            state.subscriptions.get(channelName).unsubscribe();
            state.subscriptions.delete(channelName);
            log('debug', `Unsubscribed from ${channelName}`);
        }
    }
    
    /**
     * Unsubscribe from all channels
     */
    function unsubscribeAll() {
        state.subscriptions.forEach((channel, name) => {
            channel.unsubscribe();
            log('debug', `Unsubscribed from ${name}`);
        });
        state.subscriptions.clear();
    }
    
    /**
     * Start heartbeat to monitor connection
     */
    function startHeartbeat() {
        stopHeartbeat();
        state.heartbeatTimer = setInterval(() => {
            if (state.isConnected) {
                log('debug', 'Heartbeat OK');
            }
        }, CONFIG.HEARTBEAT_INTERVAL_MS);
    }
    
    /**
     * Stop heartbeat
     */
    function stopHeartbeat() {
        if (state.heartbeatTimer) {
            clearInterval(state.heartbeatTimer);
            state.heartbeatTimer = null;
        }
    }
    
    /**
     * Get connection status
     * @returns {Object} Status object
     */
    function getStatus() {
        return {
            connected: state.isConnected,
            initializing: state.isInitializing,
            subscriptionCount: state.subscriptions.size,
            subscriptions: Array.from(state.subscriptions.keys()),
            pendingCount: state.pendingSubscriptions.length,
            version: CONFIG.VERSION,
            product: CONFIG.PRODUCT
        };
    }
    
    /**
     * Force refresh all subscriptions
     */
    function refresh() {
        log('info', 'Refreshing all subscriptions');
        const currentSubs = new Map(state.subscriptions);
        unsubscribeAll();
        
        // Re-subscribe after brief delay
        setTimeout(() => {
            currentSubs.forEach((channel, name) => {
                emit('refresh', { channelName: name });
            });
        }, 100);
    }
    
    /**
     * Destroy the realtime client
     */
    function destroy() {
        unsubscribeAll();
        stopHeartbeat();
        state.eventListeners.clear();
        state.pendingSubscriptions = [];
        state.client = null;
        state.isConnected = false;
        state.isInitializing = false;
        log('info', 'Destroyed');
    }

    // ==========================================
    // PUBLIC API
    // ==========================================
    
    global.BOTZZZ773Realtime = Object.freeze({
        // Core
        init,
        destroy,
        
        // Subscriptions
        subscribeToOrders,
        subscribeToPayments,
        subscribeToTickets,
        subscribeToBalance,
        unsubscribe,
        unsubscribeAll,
        
        // Events
        on,
        off,
        
        // Utilities
        getStatus,
        refresh,
        
        // Metadata
        version: CONFIG.VERSION,
        product: CONFIG.PRODUCT
    });

    log('info', `Module loaded v${CONFIG.VERSION}`);

})(typeof window !== 'undefined' ? window : this);
