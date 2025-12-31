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
                provider_id,
                provider_order_id, 
                status, 
                charge, 
                quantity, 
                start_count, 
                remains,
                service:services (
                    provider_id,
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
            // Use order's provider_id snapshot FIRST (if available)
            let providerId = null;
            let api_url = null;
            let api_key = null;
            
            if (order.provider_id && order.service?.provider) {
                // If order has provider_id snapshot, use service.provider if it matches
                // Otherwise skip (provider info not in join)
                if (order.provider_id === order.service.provider.id) {
                    providerId = order.service.provider.id;
                    api_url = order.service.provider.api_url;
                    api_key = order.service.provider.api_key;
                }
                // If order.provider_id doesn't match service.provider, we can't get API credentials
                // This is a data consistency issue - log it and skip
                else {
                    log(`WARNING: Order ${order.id} provider_id mismatch: ${order.provider_id} vs service provider ${order.service.provider.id}`, 'warn');
                    return;
                }
            } else if (order.service?.provider) {
                // Fallback: use service.provider for backward compatibility
                providerId = order.service.provider.id;
                api_url = order.service.provider.api_url;
                api_key = order.service.provider.api_key;
            }
            
            // Skip if we can't determine provider info
            if (!providerId || !api_url || !api_key) return;
            
            if (!ordersByProvider[providerId]) {
                ordersByProvider[providerId] = {
                    api_url: api_url,
                    api_key: api_key,
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
        // Skip if a refund payment already exists (avoid double refunds)
        try {
            const { data: existingRefund } = await supabase
                .from('payments')
                .select('id')
                .eq('order_id', localOrder.id)
                .eq('method', 'refund')
                .maybeSingle();
            if (!existingRefund) {
                await processRefund(localOrder.user_id, localOrder.charge, localOrder.id, 'CANCELED');
            }
        } catch (_) {
            // On any error, proceed defensively without double-refund
        }
        // Keep original charge in DB; API responses will map charge=0 for compatibility
        // (orders.js handles Perfect Panel compatibility in response mapping)
    } 
    // Scenario 2: Partial (Partial Refund)
    // Process refund if: status is partial AND (first time becoming partial OR remains changed)
    else if (newStatus === 'partial') {
        const quantity = parseInt(localOrder.quantity);
        const totalCharge = parseFloat(localOrder.charge);
        const oldRemains = parseInt(localOrder.remains) || 0;
        
        if (quantity > 0 && remains > 0) {
            // Check if this is first time partial (oldStatus !== 'partial')
            // OR if remains value changed (indicates new partial progress)
            const isFirstPartial = oldStatus !== 'partial';
            const remainsChanged = remains !== oldRemains;
            
            if (isFirstPartial || remainsChanged) {
                const unitPrice = totalCharge / quantity;
                
                // For first partial: refund all remaining items
                // For subsequent: refund only the delta (new remains)
                let refundQuantity = remains;
                if (!isFirstPartial && remainsChanged) {
                    refundQuantity = Math.abs(remains - oldRemains);
                }
                
                const refundAmount = unitPrice * refundQuantity;
                
                if (refundAmount > 0) {
                    await processRefund(localOrder.user_id, refundAmount, localOrder.id, 'PARTIAL');
                    // Keep DB charge as original for accurate history; API layer maps partial charge for reseller
                }
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
        // Idempotency: Skip if a refund record already exists for this order
        const { data: existingRefund } = await supabase
            .from('payments')
            .select('id')
            .eq('order_id', orderId)
            .eq('method', 'refund')
            .limit(1);
        if (Array.isArray(existingRefund) && existingRefund.length > 0) {
            return;
        }

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

        // 3. Record refund payment (negative amount)
        const txId = `refund_${String(orderId).replace(/[^a-z0-9]/gi, '').slice(0,12)}_${Date.now().toString(36)}`;
        await supabase
            .from('payments')
            .insert({
                transaction_id: txId,
                order_id: orderId,
                user_id: userId,
                amount: -Math.abs(Number(refundValue.toFixed(2))),
                method: 'refund',
                status: 'refunded',
                memo: `Refund for order ${orderId} (${type})`,
                gateway_response: { source: 'cron', reason: type, order_id: orderId }
            });

        // 4. Mark order with refund_applied_at
        await supabase
            .from('orders')
            .update({ refund_applied_at: new Date().toISOString() })
            .eq('id', orderId);

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