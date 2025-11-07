# 🔧 Quick Setup Script for Production Testing
# Run with: .\setup-test-env.ps1

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🔧 BOTZZZ773 Test Environment Setup" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

# ============================================
# Step 1: Check Supabase Connection
# ============================================
Write-Host "📡 Step 1: Checking Supabase Connection..." -ForegroundColor Yellow

if (Test-Path .env) {
    Write-Host "✅ .env file found" -ForegroundColor Green
    
    $envContent = Get-Content .env -Raw
    $hasSupabaseUrl = $envContent -match "SUPABASE_URL="
    $hasSupabaseKey = $envContent -match "SUPABASE_ANON_KEY="
    
    if ($hasSupabaseUrl -and $hasSupabaseKey) {
        Write-Host "✅ Supabase credentials present" -ForegroundColor Green
    } else {
        Write-Host "⚠️  Supabase credentials incomplete" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠️  .env file not found" -ForegroundColor Yellow
}

Write-Host ""

# ============================================
# Step 2: Generate Test User SQL
# ============================================
Write-Host "👤 Step 2: Creating Test User SQL..." -ForegroundColor Yellow

$testUserSQL = @"
-- ============================================
-- Create Test User for Production Testing
-- Run this in Supabase SQL Editor
-- ============================================

-- Create test user with initial balance
INSERT INTO users (id, email, password, role, balance, created_at)
VALUES (
    gen_random_uuid(),
    'test@botzzz773.com',
    -- Password: Test123! 
    -- (you'll need to hash this properly or set via signup)
    '\$2b\$10\$abcdefghijklmnopqrstuvwxyz123456789ABCDEFGHIJKLM',
    'user',
    50.00,
    NOW()
)
ON CONFLICT (email) 
DO UPDATE SET 
    balance = 50.00,
    updated_at = NOW();

-- Verify user created
SELECT id, email, balance, role, created_at 
FROM users 
WHERE email = 'test@botzzz773.com';
"@

$sqlFile = "test-user-setup.sql"
$testUserSQL | Out-File -FilePath $sqlFile -Encoding UTF8
Write-Host "✅ SQL file created: $sqlFile" -ForegroundColor Green
Write-Host ""

# ============================================
# Step 3: Check Services
# ============================================
Write-Host "📋 Step 3: Checking Available Services..." -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri "https://botzzz773.pro/.netlify/functions/services" -Method Get
    $activeServices = $response.services | Where-Object { $_.status -eq 'active' }
    
    if ($activeServices.Count -gt 0) {
        Write-Host "✅ Found $($activeServices.Count) active services" -ForegroundColor Green
        Write-Host ""
        Write-Host "Available services for testing:" -ForegroundColor Cyan
        
        $activeServices | Select-Object -First 5 | ForEach-Object {
            Write-Host "  • $($_.name)" -ForegroundColor White
            Write-Host "    ID: $($_.id)" -ForegroundColor Gray
            Write-Host "    Rate: `$$($_.rate)/1k" -ForegroundColor Gray
            Write-Host ""
        }
    } else {
        Write-Host "⚠️  No active services found!" -ForegroundColor Red
        Write-Host "   Action: Activate services in Admin → Services" -ForegroundColor Yellow
    }
} catch {
    Write-Host "❌ Failed to fetch services: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# ============================================
# Step 4: Check Providers
# ============================================
Write-Host "🔌 Step 4: Generating Provider Check SQL..." -ForegroundColor Yellow

$providerCheckSQL = @"
-- Check configured providers
SELECT 
    id,
    name,
    api_url,
    status,
    created_at
FROM providers
WHERE status = 'active'
ORDER BY created_at DESC;

-- Check provider service count
SELECT 
    p.name as provider_name,
    COUNT(s.id) as total_services,
    SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) as active_services
FROM providers p
LEFT JOIN services s ON s.provider_id = p.id
GROUP BY p.id, p.name;
"@

$providerSqlFile = "check-providers.sql"
$providerCheckSQL | Out-File -FilePath $providerSqlFile -Encoding UTF8
Write-Host "✅ SQL file created: $providerSqlFile" -ForegroundColor Green
Write-Host ""

# ============================================
# Step 5: Test URLs
# ============================================
Write-Host "🌐 Step 5: Test URLs Ready..." -ForegroundColor Yellow
Write-Host ""

$testUrls = @{
    "Public Homepage" = "https://botzzz773.pro"
    "Services Page" = "https://botzzz773.pro/services.html"
    "Order Page" = "https://botzzz773.pro/order.html"
    "Sign In" = "https://botzzz773.pro/signin.html"
    "Sign Up" = "https://botzzz773.pro/signup.html"
    "Dashboard" = "https://botzzz773.pro/dashboard.html"
    "Add Funds" = "https://botzzz773.pro/addfunds.html"
    "Admin Panel" = "https://botzzz773.pro/admin"
}

Write-Host "Test URLs:" -ForegroundColor Cyan
foreach ($url in $testUrls.GetEnumerator()) {
    Write-Host "  • $($url.Key): " -ForegroundColor White -NoNewline
    Write-Host "$($url.Value)" -ForegroundColor Gray
}

Write-Host ""

# ============================================
# Summary
# ============================================
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "✅ SETUP COMPLETE" -ForegroundColor Green
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

Write-Host "📝 Next Steps:" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Open Supabase SQL Editor:" -ForegroundColor White
Write-Host "   https://supabase.com/dashboard/project/YOUR_PROJECT/sql" -ForegroundColor Gray
Write-Host ""
Write-Host "2. Run the SQL file to create test user:" -ForegroundColor White
Write-Host "   ./$sqlFile" -ForegroundColor Gray
Write-Host ""
Write-Host "3. Run the production test suite:" -ForegroundColor White
Write-Host "   .\test-production.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "4. Or manually sign up test user at:" -ForegroundColor White
Write-Host "   https://botzzz773.pro/signup.html" -ForegroundColor Gray
Write-Host "   Email: test@botzzz773.com" -ForegroundColor Gray
Write-Host "   Password: Test123!" -ForegroundColor Gray
Write-Host ""

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
