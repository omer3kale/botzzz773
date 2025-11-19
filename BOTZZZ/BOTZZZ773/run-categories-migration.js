// Run Service Categories Migration
// This script creates the service_categories table in Supabase

const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runMigration() {
    console.log('🚀 Running service categories migration...\n');

    // Read migration SQL
    const sqlPath = path.join(__dirname, 'supabase', 'migrations', '20251119_create_service_categories.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Initialize Supabase client with service role
    const { createClient } = require('@supabase/supabase-js');
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        console.error('❌ Error: Missing Supabase credentials');
        console.error('Please ensure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in .env');
        process.exit(1);
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    try {
        // Execute the migration SQL
        const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

        if (error) {
            console.error('❌ Migration failed:', error);
            
            // Try alternative approach: split and execute statements
            console.log('\n⚙️  Trying alternative approach...');
            const statements = sql
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0 && !s.startsWith('--'));

            for (const statement of statements) {
                const { error: stmtError } = await supabase.rpc('exec_sql', { 
                    sql_query: statement + ';' 
                });
                if (stmtError) {
                    console.error('Statement error:', stmtError);
                }
            }
        } else {
            console.log('✅ Migration completed successfully!');
            console.log('✅ service_categories table created');
            console.log('✅ Default categories inserted');
        }

        // Verify the migration
        const { data: categories, error: checkError } = await supabase
            .from('service_categories')
            .select('*')
            .order('display_order');

        if (!checkError && categories) {
            console.log(`\n📊 ${categories.length} categories found:`);
            categories.forEach(cat => {
                console.log(`   - ${cat.name} (${cat.slug})`);
            });
        } else {
            console.log('\n⚠️  Could not verify migration. Please check manually in Supabase Dashboard.');
        }

    } catch (err) {
        console.error('❌ Error running migration:', err);
        console.log('\n⚠️  Manual migration required:');
        console.log('1. Go to Supabase Dashboard → SQL Editor');
        console.log('2. Copy and run: supabase/migrations/20251119_create_service_categories.sql');
    }
}

runMigration();
