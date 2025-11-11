// Browser Console Order Test
// Copy and paste this into your browser console on https://botzzz773.pro/order.html
// This will show you exactly what's happening when you submit an order

(async function testOrder() {
    console.log('=== ORDER PAGE DIAGNOSTIC ===\n');
    
    // Check 1: Authentication
    const token = localStorage.getItem('token');
    console.log('1. Authentication Check:');
    console.log(`   Token exists: ${!!token}`);
    if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            console.log(`   User ID: ${payload.userId}`);
            console.log(`   Email: ${payload.email}`);
            console.log(`   Role: ${payload.role}`);
        } catch (e) {
            console.log('   ⚠️ Token exists but is invalid!');
        }
    } else {
        console.log('   ❌ NOT LOGGED IN - You must sign in first!');
        return;
    }
    
    // Check 2: Form Elements
    console.log('\n2. Form Elements Check:');
    const serviceSelect = document.getElementById('service');
    const linkInput = document.getElementById('link');
    const quantityInput = document.getElementById('quantity');
    const notesInput = document.getElementById('notes');
    
    console.log(`   Service dropdown: ${serviceSelect ? '✅ Found' : '❌ Missing'}`);
    console.log(`   Link input: ${linkInput ? '✅ Found' : '❌ Missing'}`);
    console.log(`   Quantity input: ${quantityInput ? '✅ Found' : '❌ Missing'}`);
    console.log(`   Notes input: ${notesInput ? '✅ Found' : '❌ Missing'}`);
    
    // Check 3: Current Values
    console.log('\n3. Current Form Values:');
    if (serviceSelect) {
        console.log(`   Selected service ID: "${serviceSelect.value}" ${serviceSelect.value ? '✅' : '❌ EMPTY'}`);
        console.log(`   Available services: ${serviceSelect.options.length - 1}`); // -1 for placeholder
    }
    if (linkInput) {
        console.log(`   Link: "${linkInput.value}" ${linkInput.value ? '✅' : '❌ EMPTY'}`);
    }
    if (quantityInput) {
        console.log(`   Quantity: "${quantityInput.value}" ${quantityInput.value ? '✅' : '❌ EMPTY'}`);
    }
    
    // Check 4: Would the order payload be valid?
    console.log('\n4. Order Payload Validation:');
    const serviceId = serviceSelect?.value;
    const link = linkInput?.value;
    const quantity = quantityInput?.value;
    
    const payload = {
        serviceId: String(serviceId || ''),
        link: link || '',
        quantity: parseInt(quantity) || 0,
        notes: notesInput?.value || ''
    };
    
    console.log('   Payload that would be sent:');
    console.log(JSON.stringify(payload, null, 2));
    
    // Validation checks
    const errors = [];
    if (!payload.serviceId) errors.push('   ❌ serviceId is empty');
    if (!payload.link) errors.push('   ❌ link is empty');
    if (payload.quantity <= 0) errors.push('   ❌ quantity is zero or invalid');
    
    if (errors.length > 0) {
        console.log('\n   ⚠️ VALIDATION ERRORS:');
        errors.forEach(err => console.log(err));
        console.log('\n   🔧 FIX: Fill in all required fields before submitting');
    } else {
        console.log('\n   ✅ All required fields are valid!');
        console.log('   You can now submit the order');
    }
    
    console.log('\n=== END DIAGNOSTIC ===');
})();
