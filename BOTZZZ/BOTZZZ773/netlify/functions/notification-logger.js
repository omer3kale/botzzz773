// Notification Logger Utility
// Functions to log different types of notifications to admin_notifications table

const { supabaseAdmin } = require('./utils/supabase');

/**
 * Log a low balance alert for a provider
 * @param {string} providerName - Name of the provider
 * @param {number} balance - Current provider balance
 * @param {number} threshold - Configured threshold (default 0.5)
 * @returns {Promise<Object>} - Inserted notification or error
 */
async function logLowBalanceNotification(providerName, balance, threshold = 0.5) {
    try {
        const { data, error } = await supabaseAdmin
            .from('admin_notifications')
            .insert({
                notification_type: 'low_balance',
                title: `Low Balance Alert - ${providerName}`,
                message: `${providerName} balance is $${balance.toFixed(2)} (threshold: $${threshold})`,
                data: {
                    provider_name: providerName,
                    current_balance: balance,
                    threshold: threshold
                }
            })
            .select();
        
        if (error) {
            console.error('[logLowBalanceNotification] Error:', error);
            return { success: false, error };
        }
        
        console.log('[logLowBalanceNotification] Logged:', data?.[0]?.id);
        return { success: true, data };
    } catch (error) {
        console.error('[logLowBalanceNotification] Exception:', error);
        return { success: false, error };
    }
}

/**
 * Log a failed order notification
 * @param {Object} order - Order object
 * @param {string} providerName - Provider name
 * @param {string} serviceName - Service name
 * @param {string} reason - Failure reason from provider_response
 * @returns {Promise<Object>} - Inserted notification or error
 */
async function logFailedOrderNotification(order, providerName, serviceName, reason) {
    try {
        const orderId = order.id || order.order_id || 'Unknown';
        const userName = order.user_name || order.user?.username || 'Unknown User';
        
        const { data, error } = await supabaseAdmin
            .from('admin_notifications')
            .insert({
                notification_type: 'failed_order',
                title: `Order Failed - ${serviceName}`,
                message: `Order #${orderId} from ${userName} failed. ${providerName}: ${reason}`,
                data: {
                    order_id: orderId,
                    user_name: userName,
                    provider_name: providerName,
                    service_name: serviceName,
                    failure_reason: reason,
                    charge: order.charge,
                    status: order.status
                }
            })
            .select();
        
        if (error) {
            console.error('[logFailedOrderNotification] Error:', error);
            return { success: false, error };
        }
        
        console.log('[logFailedOrderNotification] Logged:', data?.[0]?.id);
        return { success: true, data };
    } catch (error) {
        console.error('[logFailedOrderNotification] Exception:', error);
        return { success: false, error };
    }
}

/**
 * Log a payment received notification
 * @param {Object} payment - Payment object
 * @param {string} userName - User name
 * @returns {Promise<Object>} - Inserted notification or error
 */
async function logPaymentNotification(payment, userName) {
    try {
        const amount = payment.amount || payment.gross_amount || 0;
        const paymentId = payment.id || payment.payment_id || 'Unknown';
        const method = payment.payment_method || payment.method || 'Unknown';
        
        const { data, error } = await supabaseAdmin
            .from('admin_notifications')
            .insert({
                notification_type: 'payment',
                title: `Payment Received - ${userName}`,
                message: `Payment of $${parseFloat(amount).toFixed(2)} received from ${userName} via ${method}`,
                data: {
                    payment_id: paymentId,
                    user_name: userName,
                    amount: amount,
                    method: method,
                    status: payment.status
                }
            })
            .select();
        
        if (error) {
            console.error('[logPaymentNotification] Error:', error);
            return { success: false, error };
        }
        
        console.log('[logPaymentNotification] Logged:', data?.[0]?.id);
        return { success: true, data };
    } catch (error) {
        console.error('[logPaymentNotification] Exception:', error);
        return { success: false, error };
    }
}

/**
 * Log a new user registration notification
 * @param {Object} user - User object
 * @returns {Promise<Object>} - Inserted notification or error
 */
async function logNewUserNotification(user) {
    try {
        const userName = user.username || user.email || 'Unknown';
        const userEmail = user.email || 'No email';
        const userId = user.id || 'Unknown';
        
        const { data, error } = await supabaseAdmin
            .from('admin_notifications')
            .insert({
                notification_type: 'new_user',
                title: `New User Registration - ${userName}`,
                message: `New user ${userName} (${userEmail}) has registered`,
                data: {
                    user_id: userId,
                    username: userName,
                    email: userEmail,
                    created_at: user.created_at
                }
            })
            .select();
        
        if (error) {
            console.error('[logNewUserNotification] Error:', error);
            return { success: false, error };
        }
        
        console.log('[logNewUserNotification] Logged:', data?.[0]?.id);
        return { success: true, data };
    } catch (error) {
        console.error('[logNewUserNotification] Exception:', error);
        return { success: false, error };
    }
}

module.exports = {
    logLowBalanceNotification,
    logFailedOrderNotification,
    logPaymentNotification,
    logNewUserNotification
};
