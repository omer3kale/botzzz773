# V2 API Discount Test Script
Write-Host "=== V2 API Discount Rate Test ===" -ForegroundColor Cyan
Write-Host ""

# Test with a sample API key (you'll need to replace with a real one that has discount_rate set)
$apiKey = Read-Host "Enter API Key to test"
if (-not $apiKey) {
    Write-Host "No API key provided. Exiting." -ForegroundColor Yellow
    exit
}

# Get services first
Write-Host "
1. Fetching services list..." -ForegroundColor Yellow
$servicesUrl = "http://localhost:8888/v2?action=services&key=$apiKey"
try {
    $services = Invoke-RestMethod -Uri $servicesUrl -Method Post -ContentType "application/x-www-form-urlencoded"
    $firstService = $services | Select-Object -First 1
    Write-Host "   Found $($services.Count) services" -ForegroundColor Green
    Write-Host "   Testing with service: $($firstService.service) - Rate: $($firstService.rate)" -ForegroundColor Cyan
} catch {
    Write-Host "   Failed to fetch services: $_" -ForegroundColor Red
    exit
}

# Check balance
Write-Host "
2. Checking balance..." -ForegroundColor Yellow
$balanceUrl = "http://localhost:8888/v2"
$balanceBody = "action=balance&key=$apiKey"
try {
    $balance = Invoke-RestMethod -Uri $balanceUrl -Method Post -Body $balanceBody -ContentType "application/x-www-form-urlencoded"
    Write-Host "   Balance: $($balance.balance) $($balance.currency)" -ForegroundColor Green
} catch {
    Write-Host "   Failed to check balance: $_" -ForegroundColor Red
}

# Calculate expected charge (you need to manually calculate based on discount)
$quantity = 1000
$expectedCharge = ($firstService.rate / 1000) * $quantity
Write-Host "
3. Expected charge WITHOUT discount:" -ForegroundColor Yellow
Write-Host "   Service rate: $($firstService.rate) per 1000" -ForegroundColor Cyan
Write-Host "   Quantity: $quantity" -ForegroundColor Cyan
Write-Host "   Expected: `$$expectedCharge" -ForegroundColor Cyan

Write-Host "
4. Creating test order..." -ForegroundColor Yellow
$orderUrl = "http://localhost:8888/v2"
$orderBody = "action=add&key=$apiKey&service=$($firstService.service)&link=https://example.com/test-discount-$(Get-Random)&quantity=$quantity"
Write-Host "   Body: $orderBody" -ForegroundColor Gray

try {
    $order = Invoke-RestMethod -Uri $orderUrl -Method Post -Body $orderBody -ContentType "application/x-www-form-urlencoded"
    Write-Host "
=== ORDER CREATED ===" -ForegroundColor Green
    Write-Host "Order: $($order | ConvertTo-Json -Depth 3)" -ForegroundColor White
    
    if ($order.order) {
        Write-Host "
Order ID: $($order.order)" -ForegroundColor Green
        Write-Host "Check Netlify Dev logs to see actual charge amount and discount application!" -ForegroundColor Yellow
    }
} catch {
    Write-Host "
=== ORDER FAILED ===" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host "
=== Test Complete ===" -ForegroundColor Cyan
Write-Host "Check the Netlify Dev terminal for discount logs:" -ForegroundColor Yellow
Write-Host "  - Look for '[V2 ADD] Discount applied:' message" -ForegroundColor Gray
Write-Host "  - Look for '[V2 ADD] Charge calculation:' message" -ForegroundColor Gray
