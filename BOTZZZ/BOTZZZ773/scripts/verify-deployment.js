// Verify deployment of order numbering system
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyDeployment() {
  console.log('🔍 Verifying Production Deployment\n');
  
  // 1. Check if sequence exists and get current value
  console.log('1️⃣ Checking order_number_seq...');
  const { data: seqData, error: seqError } = await supabase
    .rpc('generate_order_number');
  
  if (seqError) {
    console.error('❌ Sequence check failed:', seqError.message);
  } else {
    console.log('✅ Sequence working! Next order number will be:', seqData);
  }
  
  // 2. Check recent orders
  console.log('\n2️⃣ Checking recent orders...');
  const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('id, order_number, created_at, service:services(id, name, provider_service_id)')
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (ordersError) {
    console.error('❌ Orders query failed:', ordersError.message);
  } else {
    console.log('✅ Recent orders:');
    orders.forEach(order => {
      console.log(`   Order: ${order.order_number} | Service: ${order.service?.name || 'N/A'} | Provider ID: ${order.service?.provider_service_id || 'N/A'} | Created: ${order.created_at}`);
    });
  }
  
  // 3. Test function endpoint
  console.log('\n3️⃣ Testing orders function endpoint...');
  try {
    const response = await fetch('https://botzzz773.pro/.netlify/functions/orders', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      console.log('✅ Orders endpoint responding:', response.status);
    } else {
      console.log('⚠️ Orders endpoint status:', response.status);
    }
  } catch (error) {
    console.error('❌ Function endpoint error:', error.message);
  }
  
  console.log('\n✨ Deployment verification complete!\n');
  console.log('Next steps:');
  console.log('1. Visit https://botzzz773.pro/admin/orders.html');
  console.log('2. Check that order numbers show as #7000XXX format');
  console.log('3. Create a new test order to verify sequential numbering');
  console.log('4. Test the status sync button to ensure no 500 errors\n');
}

verifyDeployment().catch(console.error);
