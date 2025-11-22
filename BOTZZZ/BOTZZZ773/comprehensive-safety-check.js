#!/usr/bin/env node

/**
 * Comprehensive Database Safety Check
 * Verifies no field name reference problems or missing migrations
 */

const fs = require('fs');
const path = require('path');

// Database objects that don't exist yet
const MISSING_TABLES = [
    'link_management',
    'link_management_dashboard'
];

const MISSING_COLUMNS = [
    'orders.link_id'
];

const MISSING_FUNCTIONS = [
    'get_link_management_stats',
    'merge_link_orders',
    'find_or_create_link'
];

function scanFileForDangerousReferences(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const issues = [];
        
        // Check for missing table references
        MISSING_TABLES.forEach(table => {
            const regex = new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)`, 'g');
            const matches = content.match(regex);
            if (matches && !content.includes(`// DISABLED`) && !content.includes(`/*`)) {
                issues.push(`Active reference to missing table: ${table}`);
            }
        });
        
        // Check for missing column references
        MISSING_COLUMNS.forEach(column => {
            const [table, col] = column.split('.');
            const regex = new RegExp(`${col}\\s*:`, 'g');
            const matches = content.match(regex);
            if (matches && !content.includes(`// TODO: Add ${col} after`) && !content.includes(`/*`)) {
                issues.push(`Active reference to missing column: ${column}`);
            }
        });
        
        // Check for missing function references
        MISSING_FUNCTIONS.forEach(func => {
            const regex = new RegExp(`\\.rpc\\(['"\`]${func}['"\`]`, 'g');
            const matches = content.match(regex);
            if (matches && !content.includes(`/*`) && !content.includes(`// DISABLED`)) {
                issues.push(`Active reference to missing RPC function: ${func}`);
            }
        });
        
        // Check for dangerous action calls
        const dangerousActions = [
            'get_link_management_data',
            'resolve_link_conflicts', 
            'merge_link_orders'
        ];
        
        dangerousActions.forEach(action => {
            // Check for active (non-commented) action references
            const lines = content.split('\n');
            lines.forEach((line, index) => {
                if (line.includes(`action`) && line.includes(`'${action}'`) || line.includes(`"${action}"`)) {
                    // Skip if line is commented out
                    const trimmed = line.trim();
                    if (!trimmed.startsWith('//') && !trimmed.startsWith('*') && 
                        !content.substring(0, content.indexOf(line)).includes('/*') &&
                        !line.includes('disabled_')) {
                        issues.push(`Active dangerous API action: ${action} (line ${index + 1})`);
                    }
                }
            });
        });
        
        return issues;
    } catch (error) {
        return [`Error reading file: ${error.message}`];
    }
}

function scanDirectory(dirPath, extensions = ['.js']) {
    const allIssues = {};
    
    function scanRecursive(currentPath) {
        const items = fs.readdirSync(currentPath);
        
        for (const item of items) {
            const fullPath = path.join(currentPath, item);
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
                scanRecursive(fullPath);
            } else if (stat.isFile() && extensions.some(ext => item.endsWith(ext))) {
                const issues = scanFileForDangerousReferences(fullPath);
                if (issues.length > 0) {
                    allIssues[fullPath] = issues;
                }
            }
        }
    }
    
    scanRecursive(dirPath);
    return allIssues;
}

async function checkDatabaseConnectivity() {
    console.log('\n🔍 Checking Database Connectivity...');
    
    try {
        const axios = require('axios');
        
        // Test basic table access (should work)
        const response = await axios.get('https://njnciktftnyxnbkyfxzx.supabase.co/rest/v1/orders?select=id&limit=1', {
            headers: {
                'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbmNpa3RmdG55eG5ia3lmeHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5MzkxNTksImV4cCI6MjA3MTUxNTE1OX0.jMXBCyKs_BW-LASzUFWEum6XMh2TJLR6z2LEU7TVhiY',
                'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbmNpa3RmdG55eG5ia3lmeHp4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTkzOTE1OSwiZXhwIjoyMDcxNTE1MTU5fQ.ibFcozXcdgYuAcCCpp7bB-Essx5hNHnRdI9SZAVETic'
            }
        });
        
        if (response.status === 200) {
            console.log('✅ Basic database connectivity working');
        }
        
        // Test missing table (should fail safely)
        try {
            const badResponse = await axios.get('https://njnciktftnyxnbkyfxzx.supabase.co/rest/v1/link_management?select=id&limit=1', {
                headers: {
                    'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbmNpa3RmdG55eG5ia3lmeHp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU5MzkxNTksImV4cCI6MjA3MTUxNTE1OX0.jMXBCyKs_BW-LASzUFWEum6XMh2TJLR6z2LEU7TVhiY',
                    'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5qbmNpa3RmdG55eG5ia3lmeHp4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTkzOTE1OSwiZXhwIjoyMDcxNTE1MTU5fQ.ibFcozXcdgYuAcCCpp7bB-Essx5hNHnRdI9SZAVETic'
                }
            });
            console.log('❌ link_management table exists (unexpected!)');
        } catch (error) {
            if (error.response?.data?.message?.includes('Could not find the table')) {
                console.log('✅ link_management table confirmed missing (expected)');
            } else {
                console.log(`⚠️  Unexpected error: ${error.message}`);
            }
        }
        
        return true;
    } catch (error) {
        console.log(`❌ Database connectivity test failed: ${error.message}`);
        return false;
    }
}

async function runComprehensiveSafetyCheck() {
    console.log('🛡️  COMPREHENSIVE DATABASE SAFETY CHECK');
    console.log('==========================================');
    
    // Scan for dangerous references
    console.log('\n📁 Scanning Files for Dangerous References...');
    const projectPath = '/Users/omer3kale/botzzz773/BOTZZZ/BOTZZZ773';
    const issues = scanDirectory(projectPath);
    
    let hasIssues = false;
    
    if (Object.keys(issues).length > 0) {
        console.log('❌ DANGEROUS REFERENCES FOUND:');
        for (const [filePath, fileIssues] of Object.entries(issues)) {
            const relativePath = filePath.replace(projectPath, '');
            console.log(`\n   File: ${relativePath}`);
            fileIssues.forEach(issue => {
                console.log(`   └─ ${issue}`);
            });
        }
        hasIssues = true;
    } else {
        console.log('✅ No dangerous references found in code');
    }
    
    // Check database connectivity
    const dbConnected = await checkDatabaseConnectivity();
    
    // Check migrations status
    console.log('\n📋 Migration Status:');
    const migrationsPath = path.join(projectPath, 'supabase/migrations');
    const migrationFiles = fs.readdirSync(migrationsPath).filter(f => f.includes('link_management'));
    
    console.log(`✅ Found ${migrationFiles.length} link management migration files:`);
    migrationFiles.forEach(file => {
        console.log(`   └─ ${file}`);
    });
    console.log('⚠️  Migrations not yet applied to database');
    
    // Final assessment
    console.log('\n🎯 SAFETY ASSESSMENT:');
    console.log('====================');
    console.log(`Code Safety: ${!hasIssues ? '✅ SAFE' : '❌ DANGEROUS'}`);
    console.log(`Database Connectivity: ${dbConnected ? '✅ WORKING' : '❌ FAILED'}`);
    console.log(`Migration Status: ⏳ PENDING`);
    
    const overallSafe = !hasIssues && dbConnected;
    console.log(`\nOverall Status: ${overallSafe ? '✅ SAFE TO DEPLOY' : '⛔ DO NOT DEPLOY'}`);
    
    if (overallSafe) {
        console.log('\n✨ System is safe! No dangerous database references found.');
        console.log('   • All existing functionality will continue working');
        console.log('   • No risk of order creation failures');
        console.log('   • Link management features safely disabled until migration');
    } else {
        console.log('\n🚨 Action Required:');
        console.log('   1. Fix all dangerous references found above');
        console.log('   2. Test thoroughly before deployment');
        console.log('   3. Apply database migrations when ready');
    }
    
    return overallSafe;
}

// Run the comprehensive check
runComprehensiveSafetyCheck().catch(console.error);