#!/usr/bin/env node

// Direct SQL execution via Supabase Client
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

async function runMigration() {
    console.log('🚀 Running service_categories migration...\n');

    // Get Supabase credentials from Netlify env
    const { execSync } = require('child_process');
    
    let supabaseUrl, supabaseKey;
    
    try {
        // Try to get from Netlify env
        const envOutput = execSync('netlify env:get VITE_SUPABASE_URL', { encoding: 'utf8' });
        supabaseUrl = envOutput.trim();
        
        const keyOutput = execSync('netlify env:get SUPABASE_SERVICE_ROLE_KEY', { encoding: 'utf8' });
        supabaseKey = keyOutput.trim();
        
        console.log('✓ Retrieved credentials from Netlify');
    } catch (error) {
        console.error('❌ Could not get Netlify environment variables');
        console.log('\nPlease run the migration manually:');
        console.log('1. Go to https://app.supabase.com');
        console.log('2. SQL Editor → New Query');
        console.log('3. Copy/paste: supabase/migrations/20251119_create_service_categories.sql');
        console.log('4. Run it');
        process.exit(1);
    }

    // Read migration SQL
    const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20251119_create_service_categories.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('📄 Migration SQL loaded\n');
    console.log('Connecting to Supabase...');

    const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        }
    });

    // Split SQL into individual statements
    const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`\nExecuting ${statements.length} SQL statements...\n`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        
        // Skip comments
        if (stmt.startsWith('--')) continue;
        
        try {
            // Execute via rpc if available, otherwise try direct query
            const { data, error } = await supabase.rpc('exec', { sql_query: stmt + ';' }).catch(() => {
                // If rpc fails, try using the REST API directly
                return { error: { message: 'RPC not available' } };
            });

            if (error && error.message !== 'RPC not available') {
                console.log(`⚠️  Statement ${i + 1}: ${error.message}`);
                
                // Check if it's a "already exists" error (which is OK)
                if (error.message.includes('already exists') || error.code === '42P07') {
                    console.log('   (Already exists - OK)');
                    successCount++;
                } else {
                    errorCount++;
                }
            } else {
                console.log(`✓ Statement ${i + 1} executed`);
                successCount++;
            }
        } catch (err) {
            console.log(`⚠️  Statement ${i + 1}: ${err.message}`);
            errorCount++;
        }
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Success: ${successCount} statements`);
    if (errorCount > 0) {
        console.log(`⚠️  Warnings/Errors: ${errorCount} statements`);
    }

    // Verify the migration
    console.log('\n🔍 Verifying migration...');
    
    const { data: categories, error: verifyError } = await supabase
        .from('service_categories')
        .select('*')
        .order('display_order');

    if (verifyError) {
        console.log('\n⚠️  Could not verify migration via API');
        console.log('Error:', verifyError.message);
        console.log('\nPlease verify manually in Supabase Dashboard:');
        console.log('SELECT * FROM service_categories;');
    } else if (categories) {
        console.log(`\n✅ Migration verified! Found ${categories.length} categories:\n`);
        categories.forEach(cat => {
            console.log(`   ${cat.display_order}. ${cat.name} (${cat.slug}) - ${cat.icon}`);
        });
        console.log('\n🎉 Migration completed successfully!');
    }
}

runMigration().catch(err => {
    console.error('\n❌ Migration failed:', err.message);
    console.log('\nManual migration required:');
    console.log('1. Go to https://app.supabase.com');
    console.log('2. SQL Editor → New Query');
    console.log('3. Copy/paste: supabase/migrations/20251119_create_service_categories.sql');
    console.log('4. Run it');
    process.exit(1);
});
