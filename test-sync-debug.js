// Test sync-service-catalog with smmzz provider
// Run with: node test-sync-debug.js

const axios = require('axios');

async function testSyncDebug() {
  try {
    console.log('🔍 Testing sync-service-catalog function for smmzz provider...\n');

    // Call the netlify dev function
    const response = await axios.post('http://localhost:8888/.netlify/functions/sync-service-catalog', {
      providerName: 'smmzz'
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    console.log('✅ Response received:\n');
    console.log(JSON.stringify(response.data, null, 2));

    // Look for currency conversion logs
    if (response.data.log) {
      console.log('\n📋 Relevant Logs:\n');
      const lines = response.data.log.split('\n');
      const relevant = lines.filter(line => 
        line.includes('Currency') || 
        line.includes('Auto-converted') || 
        line.includes('currency') ||
        line.includes('INR') ||
        line.includes('smmzz')
      );
      relevant.forEach(line => console.log(line));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
  }
}

testSyncDebug();
