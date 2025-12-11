const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// --- CONFIGURATION ---
// These values are read from GitHub Secrets (Environment Variables)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // Must be SERVICE_ROLE_KEY

// Safety Check
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('ERROR: Supabase credentials are missing. Please check GitHub Secrets.');
    process.exit(1);
}

// Initialize Supabase Client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- HELPER: LOGGING ---
function log(msg, type = 'info') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type.toUpperCase()}] ${msg}`);
}

// --- MAIN FUNCTION ---
async function checkOrders() {
    log('Cron Job Started...');

    try {
        // 1. Fetch orders that are in active states (processing, pending, etc.)
        // We join with services -> providers to get API credentials for each order
        const { data: orders, error } = await supabase
            .from('orders')
            .select(`
                id, 
                user_id, 
                provider_order_id, 
                status, 
                charge, 
                quantity, 
                start_count, 
                remains,
                service:services (
                    provider:providers (
                        id,
                        api_url,
                        api_key
                    )
                )
            `)
            .in('status', ['processing', 'pending', 'inprogress', 'refilling']) // States to check
            .not('provider_order_id', 'is', null); // Only orders sent to a provider

        if (error) throw error;

        if (!orders || orders.length === 0) {
            log('No active orders to check.');
            return;
        }

        log(`Found ${orders.length} active orders. Grouping by provider...`);

        // 2. Group orders by Provider ID to send batch requests (Optimization)
        const ordersByProvider = {};
        
        orders.forEach(order => {
            // Skip if service or provider info is missing
            if (!order.service || !order.service.provider) return;
            
            const providerId = order.service.provider.id;
            
            if (!ordersByProvider[providerId]) {
                ordersByProvider[providerId] = {
                    api_url: order.service.provider.api_url,
                    api_key: order.service.provider.api_key,
                    orders: []
                };
            }
            ordersByProvider[providerId].orders.push(order);
        });

        // 3. Process each provider batch
        for (const providerId in ordersByProvider) {
            await processProviderBatch(ordersByProvider[providerId]);
        }

        log('Cron Job Completed Successfully.');

    } catch (err) {
        log(`CRITICAL ERROR: ${err.message}`, 'error');
        process.exit(1); // Exit with error code for GitHub Actions
    }
}

// --- PROCESS BATCH ---
async function processProviderBatch(providerData) {
    const { api_url, api_key, orders } = providerData;
    
    // Prepare comma-separated list of order IDs for the API
    const orderIds = orders.map(o => o.provider_order_id).join(',');

    try {
        // Send Multi-Status Request to Provider
        const params = new URLSearchParams();
        params.append('key', api_key);
        params.append('action', 'status');
        params.append('orders', orderIds);

        const response = await axios.post(api_url, params, { timeout: 30000 }); // 30s timeout
        const remoteStatuses = response.data; // Expected: { "123": { status: "Completed", ... } }

        // Iterate through local orders and update them based on API response
        for (const localOrder of orders) {
            const remoteOrder = remoteStatuses[localOrder.provider_order_id];

            // If provider returned data for this order
            if (remoteOrder && !remoteOrder.error) {
                await updateOrderLogic(localOrder, remoteOrder);
            }
        }

    } catch (err) {
        log(`Provider API Error (${api_url}): ${err.message}`, 'error');
    }
}

// --- UPDATE & REFUND LOGIC ---
async function updateOrderLogic(localOrder, remoteOrder) {
    const newStatus = mapStatus(remoteOrder.status);
    const oldStatus = localOrder.status;
    
    // Normalize data
    const start_count = parseInt(remoteOrder.start_count) || localOrder.start_count || 0;
    const remains = parseInt(remoteOrder.remains) || 0;
    
    // If nothing changed, skip DB update
    if (newStatus === oldStatus && remains === (localOrder.remains || 0)) return;

    log(`Updating Order #${localOrder.id}: ${oldStatus} -> ${newStatus} | Remains: ${remains}`);

    // Prepare update object
    let updateData = {
        status: newStatus,
        start_count: start_count,
        remains: remains,
        last_status_sync: new Date().toISOString()
    };

    // --- REFUND SCENARIOS ---
    
    // Scenario 1: Canceled (Full Refund)
    if (newStatus === 'canceled' && oldStatus !== 'canceled') {
        await processRefund(localOrder.user_id, localOrder.charge, localOrder.id, 'CANCELED');
        updateData.charge = 0; // Set cost to 0 as it was refunded
    } 
    // Scenario 2: Partial (Partial Refund)
    else if (newStatus === 'partial' && oldStatus !== 'partial') {
        const quantity = parseInt(localOrder.quantity);
        const totalCharge = parseFloat(localOrder.charge);
        
        if (quantity > 0 && remains > 0) {
            const unitPrice = totalCharge / quantity;
            const refundAmount = unitPrice * remains;
            
            if (refundAmount > 0) {
                await processRefund(localOrder.user_id, refundAmount, localOrder.id, 'PARTIAL');
                // Decrease the order charge by the refunded amount
                updateData.charge = totalCharge - refundAmount;
            }
        }
    }

    // Update Order in DB
    const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', localOrder.id);

    if (error) log(`DB Update Error Order #${localOrder.id}: ${error.message}`, 'error');
}

// --- REFUND TRANSACTION ---
async function processRefund(userId, amount, orderId, type) {
    try {
        // 1. Get current user balance
        const { data: user, error: uErr } = await supabase
            .from('users')
            .select('balance')
            .eq('id', userId)
            .single();

        if (uErr || !user) throw new Error('User not found for refund');

        const refundValue = parseFloat(amount);
        const newBalance = parseFloat(user.balance) + refundValue;

        // 2. Update user balance
        const { error: updateErr } = await supabase
            .from('users')
            .update({ balance: newBalance })
            .eq('id', userId);

        if (updateErr) throw updateErr;

        log(`REFUND SUCCESS [${type}]: User ${userId} received +$${refundValue.toFixed(2)}. Order: ${orderId}`, 'success');

        // Optional: Add to transaction/audit logs here if you have a table for it

    } catch (err) {
        log(`REFUND FAILED [${type}] Order ${orderId}: ${err.message}`, 'error');
    }
}

// --- STATUS NORMALIZER ---
function mapStatus(providerStatus) {
    if (!providerStatus) return 'processing';
    
    const s = providerStatus.toLowerCase();
    
    if (s.includes('completed')) return 'completed';
    if (s.includes('cancel')) return 'canceled';
    if (s.includes('partial')) return 'partial';
    if (s.includes('fail')) return 'canceled'; // Treat failed as canceled
    if (s.includes('refund')) return 'canceled';
    if (s.includes('pending')) return 'pending';
    if (s.includes('progress') || s.includes('processing')) return 'processing';
    
    return 'processing'; // Default fallback
}

// --- EXECUTE ---
checkOrders();