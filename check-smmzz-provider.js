// Check smmzz provider's currency in database
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://uepnvfsdwibmknwjmxot.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVlcG52ZnNkd2libWtud2pteG90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTk5OTAwNTAsImV4cCI6MTcxNzc2ODA1MH0.Q7CbMRW2TmRkkPJP8J3T6yt5R9GqJ2kL4t7vX8aZ9sM';

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkProvider() {
  try {
    console.log('🔍 Checking smmzz provider...\n');

    const { data, error } = await supabase
      .from('providers')
      .select('id, name, currency, api_url')
      .eq('name', 'smmzz');

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    console.log('📊 smmzz Provider Info:');
    console.log(JSON.stringify(data, null, 2));

    if (data && data.length > 0) {
      const provider = data[0];
      console.log(`\n✅ Provider found:`);
      console.log(`   - ID: ${provider.id}`);
      console.log(`   - Name: ${provider.name}`);
      console.log(`   - Currency: ${provider.currency || 'NULL'}`);
      console.log(`   - API URL: ${provider.api_url}`);

      if (!provider.currency || provider.currency === 'USD') {
        console.log('\n⚠️  WARNING: Currency is NULL or USD, but provider sends INR prices!');
        console.log('   → This explains why currency conversion is NOT happening');
        console.log('\n💡 FIX: Update provider currency to INR');
      }
    } else {
      console.log('❌ smmzz provider not found');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }

  process.exit(0);
}

checkProvider();
