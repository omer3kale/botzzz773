// Test Notification Logging
// Run this with: node test-notification.js

const { supabaseAdmin } = require('./netlify/functions/utils/supabase');

async function testNotifications() {
    console.log('Testing notification logging...\n');
    
    // Test 1: Log a failed order notification
    console.log('1. Testing logFailedOrderNotification...');
    const testOrder = {
        id: 'test-order-123',
        user_name: 'Test User',
        provider_name: 'TestProvider',
        service_name: 'Test Service',
        failure_reason: 'Provider error: Service unavailable',
        charge: 5.00,
        status: 'failed'
    };
    
    try {
        const { data, error } = await supabaseAdmin
            .from('admin_notifications')
            .insert({
                notification_type: 'failed_order',
                title: `Order Failed - ${testOrder.service_name}`,
                message: `Order #${testOrder.id} from ${testOrder.user_name} failed. ${testOrder.provider_name}: ${testOrder.failure_reason}`,
                data: {
                    order_id: testOrder.id,
                    user_name: testOrder.user_name,
                    provider_name: testOrder.provider_name,
                    service_name: testOrder.service_name,
                    failure_reason: testOrder.failure_reason,
                    charge: testOrder.charge,
                    status: testOrder.status
                }
            })
            .select();
        
        if (error) {
            console.error('❌ Error:', error.message);
        } else {
            console.log('✅ Success! Notification ID:', data?.[0]?.id);
        }
    } catch (err) {
        console.error('❌ Exception:', err.message);
    }
    
    // Test 2: Check all notifications
    console.log('\n2. Fetching all notifications from admin_notifications table...');
    try {
        const { data, error } = await supabaseAdmin
            .from('admin_notifications')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);
        
        if (error) {
            console.error('❌ Error:', error.message);
        } else {
            console.log(`✅ Found ${data?.length || 0} notifications:`);
            data?.forEach((notif, i) => {
                console.log(`   ${i + 1}. [${notif.notification_type}] ${notif.title}`);
            });
        }
    } catch (err) {
        console.error('❌ Exception:', err.message);
    }
}

testNotifications();
