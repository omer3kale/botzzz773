// Provider Creation Diagnostic Tool
// Run this in browser console on admin settings page to test provider creation

async function testProviderCreation() {
    console.log('=== Provider Creation Diagnostic ===');
    
    const token = localStorage.getItem('token');
    if (!token) {
        console.error('❌ No admin token found. Please login first.');
        return;
    }
    
    console.log('✓ Admin token found');
    
    // Test 1: Check if we can fetch existing providers
    console.log('\n📋 Test 1: Fetching existing providers...');
    try {
        const getResponse = await fetch('/.netlify/functions/providers', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        const getData = await getResponse.json();
        console.log('GET Response:', getData);
        
        if (getData.success) {
            console.log(`✓ Found ${getData.providers?.length || 0} existing providers`);
            getData.providers?.forEach(p => {
                console.log(`  - ${p.name} (${p.status})`);
            });
        } else {
            console.error('❌ Failed to fetch providers:', getData.error);
        }
    } catch (error) {
        console.error('❌ Error fetching providers:', error);
    }
    
    // Test 2: Try to create a test provider
    console.log('\n✏️ Test 2: Creating test provider...');
    const testProvider = {
        action: 'create',
        name: `Test Provider ${Date.now()}`,
        apiUrl: 'https://api.testprovider.com/v2',
        apiKey: `test_key_${Date.now()}`,
        markup: 20,
        status: 'active'
    };
    
    console.log('Request payload:', testProvider);
    
    try {
        const createResponse = await fetch('/.netlify/functions/providers', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(testProvider)
        });
        
        const createData = await createResponse.json();
        console.log('POST Response status:', createResponse.status);
        console.log('POST Response data:', createData);
        
        if (createData.success) {
            console.log('✓ Provider created successfully!');
            console.log('  Provider ID:', createData.provider?.id);
            console.log('  Provider Name:', createData.provider?.name);
            
            // Clean up test provider
            console.log('\n🧹 Cleaning up test provider...');
            const deleteResponse = await fetch('/.netlify/functions/providers', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    providerId: createData.provider.id
                })
            });
            
            const deleteData = await deleteResponse.json();
            if (deleteData.success) {
                console.log('✓ Test provider cleaned up successfully');
            } else {
                console.warn('⚠️ Failed to clean up test provider:', deleteData.error);
            }
        } else {
            console.error('❌ Provider creation failed:', createData.error);
            if (createData.details) {
                console.error('   Details:', createData.details);
            }
            if (createData.message) {
                console.error('   Message:', createData.message);
            }
        }
    } catch (error) {
        console.error('❌ Error creating provider:', error);
    }
    
    console.log('\n=== Diagnostic Complete ===');
}

// Run the diagnostic
testProviderCreation();
