/**
 * ==========================================
 * BOTZZZ773 Supabase Client v2.0.0
 * ==========================================
 * 
 * Professional SMM Panel Database Client
 * Copyright (c) 2025 BOTZZZ773. All rights reserved.
 * 
 * Initializes Supabase client for browser-side operations
 * including real-time subscriptions and database queries.
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
        
        // Supabase credentials (anon key is safe for browser - RLS protects data)
        SUPABASE_URL: 'https://qmnbwpmnidguccsiwoow.supabase.co',
        SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFtbmJ3cG1uaWRndWNjc2l3b293Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwNDk0MjgsImV4cCI6MjA3NzYyNTQyOH0.wVj6pxggBwhpdih0G0RmV2YQfA2n4s4N31_m73l1mc4',
        
        // Timing
        INIT_CHECK_INTERVAL_MS: 100,
        INIT_TIMEOUT_MS: 10000,
        
        // Debug mode
        DEBUG: true
    });

    // ==========================================
    // STATE
    // ==========================================
    
    let state = {
        client: null,
        isInitialized: false,
        initPromise: null
    };

    // ==========================================
    // LOGGING
    // ==========================================
    
    function log(level, message, data = null) {
        if (!CONFIG.DEBUG && level === 'debug') return;
        
        const prefix = `[${CONFIG.PRODUCT} Supabase]`;
        const logFn = {
            'debug': console.log,
            'info': console.info,
            'warn': console.warn,
            'error': console.error
        }[level] || console.log;
        
        if (data) {
            logFn(`${prefix} ${message}`, data);
        } else {
            logFn(`${prefix} ${message}`);
        }
    }

    // ==========================================
    // INITIALIZATION
    // ==========================================
    
    /**
     * Initialize Supabase client
     * @returns {Promise<Object>} The Supabase client instance
     */
    async function initialize() {
        if (state.client && state.isInitialized) {
            return state.client;
        }
        
        if (state.initPromise) {
            return state.initPromise;
        }
        
        state.initPromise = new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkSupabase = () => {
                // Check if Supabase CDN is loaded
                if (typeof global.supabase !== 'undefined' && 
                    typeof global.supabase.createClient === 'function') {
                    
                    try {
                        state.client = global.supabase.createClient(
                            CONFIG.SUPABASE_URL,
                            CONFIG.SUPABASE_ANON_KEY,
                            {
                                realtime: {
                                    params: {
                                        eventsPerSecond: 10
                                    }
                                },
                                auth: {
                                    persistSession: true,
                                    autoRefreshToken: true
                                }
                            }
                        );
                        
                        state.isInitialized = true;
                        log('info', `Client initialized v${CONFIG.VERSION}`);
                        
                        // Make available globally
                        global.BOTZZZ773_SUPABASE = state.client;
                        
                        // Emit ready event
                        if (typeof global.dispatchEvent === 'function') {
                            global.dispatchEvent(new CustomEvent('supabase:ready', { 
                                detail: { client: state.client }
                            }));
                        }
                        
                        resolve(state.client);
                        
                    } catch (error) {
                        log('error', 'Failed to create client', error);
                        reject(error);
                    }
                } else {
                    // Check timeout
                    if (Date.now() - startTime > CONFIG.INIT_TIMEOUT_MS) {
                        log('error', 'Initialization timeout - Supabase CDN not loaded');
                        reject(new Error('Supabase initialization timeout'));
                        return;
                    }
                    
                    // Retry
                    setTimeout(checkSupabase, CONFIG.INIT_CHECK_INTERVAL_MS);
                }
            };
            
            checkSupabase();
        });
        
        return state.initPromise;
    }

    // ==========================================
    // PUBLIC API
    // ==========================================
    
    /**
     * Get the Supabase client (async - waits for init)
     * @returns {Promise<Object>} The Supabase client
     */
    async function getClient() {
        if (state.client && state.isInitialized) {
            return state.client;
        }
        return initialize();
    }
    
    /**
     * Get the Supabase client (sync - may return null)
     * @returns {Object|null} The Supabase client or null
     */
    function getClientSync() {
        return state.client;
    }
    
    /**
     * Check if client is ready
     * @returns {boolean}
     */
    function isReady() {
        return state.isInitialized && state.client !== null;
    }
    
    /**
     * Get configuration info
     * @returns {Object}
     */
    function getConfig() {
        return {
            url: CONFIG.SUPABASE_URL,
            isInitialized: state.isInitialized,
            version: CONFIG.VERSION,
            product: CONFIG.PRODUCT
        };
    }

    // ==========================================
    // EXPORT
    // ==========================================
    
    global.BOTZZZ773_SupabaseClient = Object.freeze({
        init: initialize,
        getClient,
        getClientSync,
        isReady,
        getConfig,
        version: CONFIG.VERSION,
        product: CONFIG.PRODUCT
    });
    
    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }
    
    log('info', `Module loaded v${CONFIG.VERSION}`);

})(typeof window !== 'undefined' ? window : this);
