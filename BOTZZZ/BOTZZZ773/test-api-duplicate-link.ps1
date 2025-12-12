# Test Scenario: Duplicate Link Protection
# Same service + same link should fail on second request
# -----------------------------------------------

$API_BASE_URL = "http://localhost:8888/.netlify/functions/v2"
$API_KEY = "sk_be2b83b5836ab8c56e413093f7e8b20c975fffa88478ea1ec6876d1b215751ae"

Write-Host "`n=== Duplicate Link Protection Test ===" -ForegroundColor Cyan

$testServiceId = "9224"
$testLink = "https://instagram.com/duplicate_test_$(Get-Random -Minimum 1000 -Maximum 1999)"
$testQuantity = 10

Write-Host "Service: $testServiceId" -ForegroundColor Yellow
Write-Host "Link: $testLink" -ForegroundColor Yellow
Write-Host "Quantity: $testQuantity" -ForegroundColor Yellow

# First Order - Should Succeed
Write-Host "`n=== FIRST REQUEST (Should Succeed) ===" -ForegroundColor Green
$orderBody = "key=$API_KEY&action=add&service=$testServiceId&link=$testLink&quantity=$testQuantity"

try {
    $orderResponse1 = Invoke-RestMethod -Uri $API_BASE_URL -Method POST -Body $orderBody -ContentType "application/x-www-form-urlencoded"
    
    if ($orderResponse1.error) {
        Write-Host "❌ First order failed: $($orderResponse1.error)" -ForegroundColor Red
        exit 1
    }
    
    $orderId1 = $orderResponse1.order
    Write-Host "✅ First Order Created: #$orderId1" -ForegroundColor Green
    
} catch {
    Write-Host "❌ First request error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# Second Order - Should Fail (Duplicate Link)
Write-Host "`n=== SECOND REQUEST (Should Fail - Duplicate Link) ===" -ForegroundColor Yellow
Write-Host "Same service + same link = duplicate protection triggered" -ForegroundColor Gray

Start-Sleep -Seconds 1

try {
    $orderResponse2 = Invoke-RestMethod -Uri $API_BASE_URL -Method POST -Body $orderBody -ContentType "application/x-www-form-urlencoded"
    
    if ($orderResponse2.error) {
        if ($orderResponse2.error -like "*Link duplicate*") {
            Write-Host "✅ CORRECT: Second order rejected with 'Link duplicate' error" -ForegroundColor Green
            Write-Host "Error message: $($orderResponse2.error)" -ForegroundColor Green
        } else {
            Write-Host "⚠ Second order rejected but with different error: $($orderResponse2.error)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ FAILED: Second order should have been rejected but was accepted!" -ForegroundColor Red
        Write-Host "Order ID: $($orderResponse2.order)" -ForegroundColor Red
    }
    
} catch {
    Write-Host "❌ Second request error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== Test Complete ===" -ForegroundColor Cyan
Write-Host "Expected: First order accepted, second order rejected with 'Link duplicate' error" -ForegroundColor Gray
