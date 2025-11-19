// Run Service Categories Migration using Supabase SQL directly
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

async function runMigration() {
    console.log('🚀 Running service categories migration...\n');

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ Error: Missing Supabase credentials in .env file');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

    try {
        // Read the migration SQL
        const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20251119_create_service_categories.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('📝 Executing migration SQL...\n');

        // Execute via the Supabase PostgREST API using raw SQL
        // Note: This requires the pg_net extension or direct database access
        const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec`, {
            method: 'POST',
            headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ query: sql })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        console.log('✅ Migration executed!\n');

        // Verify by checking if categories exist
        const { data: categories, error } = await supabase
            .from('service_categories')
            .select('name, slug, icon, display_order')
            .order('display_order');

        if (error) {
            console.error('⚠️  Could not verify migration:', error.message);
            console.log('\n💡 Please verify manually in Supabase Dashboard → Table Editor → service_categories');
        } else {
            console.log(`✅ Verification: ${categories.length} categories found:\n`);
            categories.forEach(cat => {
                console.log(`   ${cat.display_order}. ${cat.name} (${cat.slug}) - ${cat.icon}`);
            });
            console.log('\n🎉 Migration completed successfully!');
        }

    } catch (err) {
        console.error('\n❌ Migration error:', err.message);
        console.log('\n📋 Manual migration steps:');
        console.log('1. Open Supabase Dashboard → SQL Editor');
        console.log('2. Create new query');
        console.log('3. Copy contents from: supabase/migrations/20251119_create_service_categories.sql');
        console.log('4. Run the query');
    }
}

runMigration();
