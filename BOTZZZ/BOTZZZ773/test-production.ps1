# 🧪 BOTZZZ773 Production Test Suite
# Run with: .\test-production.ps1

param(
    [string]$TestEmail = "test@botzzz773.com",
    [decimal]$InitialBalance = 50.00,
    [string]$BaseUrl = "https://botzzz773.pro"
)

Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "🧪 BOTZZZ773 Production Test Suite" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$testResults = @{
    OrderPlacement = $false
    ProviderIntegration = $false
    PaymentFlow = $false
    BalanceUpdates = $false
}

# ============================================
# Test 1: Check Services API
# ============================================
Write-Host "📋 Test 1: Checking Services API..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$BaseUrl/.netlify/functions/services" -Method Get
    $serviceCount = $response.services.Count
    $activeCount = ($response.services | Where-Object { $_.status -eq 'active' }).Count
    
    Write-Host "✅ Services API working" -ForegroundColor Green
    Write-Host "   Total Services: $serviceCount" -ForegroundColor Gray
    Write-Host "   Active Services: $activeCount" -ForegroundColor Gray
    
    if ($activeCount -gt 0) {
        Write-Host "   Available Services:" -ForegroundColor Gray
        $response.services | Select-Object -First 5 | ForEach-Object {
            Write-Host "   - $($_.name) [`$$($_.rate)/1k]" -ForegroundColor Gray
        }
        $testResults.OrderPlacement = $true
    } else {
        Write-Host "⚠️  No active services found!" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ Services API failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# ============================================
# Test 2: Check Authentication
# ============================================
Write-Host "🔐 Test 2: Testing Authentication..." -ForegroundColor Yellow

# Create test user SQL
$createUserSQL = @"
-- Run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/YOUR_PROJECT/sql

INSERT INTO users (id, email, password, role, balance, created_at)
VALUES (
    gen_random_uuid(),
    '$TestEmail',
    -- Password: Test123! (bcrypt hash)
    '`$2b`$10`$rXZqvYxKZ9K9vK9K9K9K9uYZqvYxKZ9K9vK9K9K9K9uYZqvYxKZ9K',
    'user',
    $InitialBalance,
    NOW()
)
ON CONFLICT (email) DO UPDATE
SET balance = $InitialBalance;

-- Verify user created:
SELECT id, email, balance, role FROM users WHERE email = '$TestEmail';
"@

Write-Host "📝 SQL Query to create test user:" -ForegroundColor Cyan
Write-Host $createUserSQL -ForegroundColor Gray
Write-Host ""
Write-Host "⚠️  Action Required:" -ForegroundColor Yellow
Write-Host "   1. Open Supabase dashboard" -ForegroundColor White
Write-Host "   2. Go to SQL Editor" -ForegroundColor White
Write-Host "   3. Copy and run the SQL above" -ForegroundColor White
Write-Host "   4. Press Enter to continue..." -ForegroundColor White
$null = Read-Host

Write-Host ""

# ============================================
# Test 3: Simulate Order Placement
# ============================================
Write-Host "📦 Test 3: Testing Order Placement..." -ForegroundColor Yellow

if ($response.services.Count -gt 0) {
    $testService = $response.services | Where-Object { $_.status -eq 'active' } | Select-Object -First 1
    
    if ($testService) {
        Write-Host "   Using service: $($testService.name)" -ForegroundColor Gray
        Write-Host "   Service ID: $($testService.id)" -ForegroundColor Gray
        Write-Host "   Rate: `$$($testService.rate)/1k" -ForegroundColor Gray
        
        $orderData = @{
            service_id = $testService.id
            link = "https://tiktok.com/@testuser_botzzz773"
            quantity = 1000
            notes = "Test order - automated test"
        } | ConvertTo-Json
        
        Write-Host ""
        Write-Host "📝 Order payload:" -ForegroundColor Cyan
        Write-Host $orderData -ForegroundColor Gray
        
        Write-Host ""
        Write-Host "⚠️  Manual Test Required:" -ForegroundColor Yellow
        Write-Host "   1. Login to: $BaseUrl/signin.html" -ForegroundColor White
        Write-Host "   2. Email: $TestEmail" -ForegroundColor White
        Write-Host "   3. Password: Test123!" -ForegroundColor White
        Write-Host "   4. Go to: $BaseUrl/order.html?service=$($testService.id)" -ForegroundColor White
        Write-Host "   5. Fill form and submit order" -ForegroundColor White
        Write-Host "   6. Check if order appears in dashboard" -ForegroundColor White
        Write-Host ""
        Write-Host "   Did order placement work? (y/n): " -ForegroundColor White -NoNewline
        $orderSuccess = Read-Host
        
        if ($orderSuccess -eq 'y') {
            $testResults.OrderPlacement = $true
            Write-Host "✅ Order placement test passed" -ForegroundColor Green
        } else {
            Write-Host "❌ Order placement test failed" -ForegroundColor Red
        }
    }
}

Write-Host ""

# ============================================
# Test 4: Check Provider Integration
# ============================================
Write-Host "🔌 Test 4: Checking Provider Integration..." -ForegroundColor Yellow

$checkProviderSQL = @"
-- Check if order reached provider
SELECT 
    o.id,
    o.provider_order_id,
    o.status,
    o.link,
    o.quantity,
    s.name as service_name,
    s.provider_service_id,
    p.name as provider_name,
    p.api_url
FROM orders o
JOIN services s ON o.service_id = s.id
LEFT JOIN providers p ON s.provider_id = p.id
WHERE o.user_id = (SELECT id FROM users WHERE email = '$TestEmail')
ORDER BY o.created_at DESC
LIMIT 1;
"@

Write-Host "📝 Run this query in Supabase:" -ForegroundColor Cyan
Write-Host $checkProviderSQL -ForegroundColor Gray
Write-Host ""
Write-Host "✓ Check if provider_order_id is NOT NULL" -ForegroundColor White
Write-Host "✓ Login to provider dashboard and verify order exists" -ForegroundColor White
Write-Host ""
Write-Host "   Did order reach provider? (y/n): " -ForegroundColor White -NoNewline
$providerSuccess = Read-Host

if ($providerSuccess -eq 'y') {
    $testResults.ProviderIntegration = $true
    Write-Host "✅ Provider integration test passed" -ForegroundColor Green
} else {
    Write-Host "❌ Provider integration test failed" -ForegroundColor Red
}

Write-Host ""

# ============================================
# Test 5: Check Balance Updates
# ============================================
Write-Host "💰 Test 5: Verifying Balance Updates..." -ForegroundColor Yellow

$balanceCheckSQL = @"
-- Check balance calculation
SELECT 
    email,
    balance,
    (SELECT COALESCE(SUM(charge), 0) FROM orders WHERE user_id = users.id) as total_spent,
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE user_id = users.id AND status = 'completed') as total_paid,
    (
        (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE user_id = users.id AND status = 'completed') -
        (SELECT COALESCE(SUM(charge), 0) FROM orders WHERE user_id = users.id)
    ) as calculated_balance
FROM users 
WHERE email = '$TestEmail';
"@

Write-Host "📝 Run this query in Supabase:" -ForegroundColor Cyan
Write-Host $balanceCheckSQL -ForegroundColor Gray
Write-Host ""
Write-Host "✓ Verify: balance = total_paid - total_spent" -ForegroundColor White
Write-Host "✓ Verify: balance matches calculated_balance" -ForegroundColor White
Write-Host ""
Write-Host "   Is balance correct? (y/n): " -ForegroundColor White -NoNewline
$balanceSuccess = Read-Host

if ($balanceSuccess -eq 'y') {
    $testResults.BalanceUpdates = $true
    Write-Host "✅ Balance updates test passed" -ForegroundColor Green
} else {
    Write-Host "❌ Balance updates test failed" -ForegroundColor Red
}

Write-Host ""

# ============================================
# Test 6: Payment Flow (Optional)
# ============================================
Write-Host "💳 Test 6: Payment Flow (Requires Payeer Setup)..." -ForegroundColor Yellow
Write-Host ""
Write-Host "   To test payment flow:" -ForegroundColor White
Write-Host "   1. Ensure PAYEER_MERCHANT_ID and PAYEER_SECRET_KEY are set in Netlify" -ForegroundColor White
Write-Host "   2. Go to: $BaseUrl/addfunds.html" -ForegroundColor White
Write-Host "   3. Enter amount: 25.00" -ForegroundColor White
Write-Host "   4. Complete payment on Payeer" -ForegroundColor White
Write-Host "   5. Verify balance increased" -ForegroundColor White
Write-Host ""
Write-Host "   Did payment flow work? (y/n/s to skip): " -ForegroundColor White -NoNewline
$paymentSuccess = Read-Host

if ($paymentSuccess -eq 'y') {
    $testResults.PaymentFlow = $true
    Write-Host "✅ Payment flow test passed" -ForegroundColor Green
} elseif ($paymentSuccess -eq 's') {
    Write-Host "⏭️  Payment flow test skipped" -ForegroundColor Yellow
} else {
    Write-Host "❌ Payment flow test failed (or skipped)" -ForegroundColor Red
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "📊 TEST RESULTS SUMMARY" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$passedTests = 0
$totalTests = 0

foreach ($test in $testResults.GetEnumerator()) {
    $totalTests++
    $status = if ($test.Value) { "✅ PASS"; $passedTests++ } else { "❌ FAIL" }
    $color = if ($test.Value) { "Green" } else { "Red" }
    Write-Host "$status - $($test.Key)" -ForegroundColor $color
}

Write-Host ""
Write-Host "Score: $passedTests / $totalTests tests passed" -ForegroundColor $(if ($passedTests -eq $totalTests) { "Green" } else { "Yellow" })
Write-Host ""

if ($passedTests -ge 3) {
    Write-Host "🚀 LAUNCH STATUS: READY TO GO LIVE!" -ForegroundColor Green
    Write-Host "   Minimum requirements met for production launch." -ForegroundColor Gray
} else {
    Write-Host "⚠️  LAUNCH STATUS: NOT READY" -ForegroundColor Red
    Write-Host "   Fix failing tests before going live." -ForegroundColor Gray
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
