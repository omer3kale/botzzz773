# Test Scenario: Service 9161 (royalsmmworld.com) with provider_service_id=1073
# Provider insufficient balance test
# -----------------------------------------------

$API_BASE_URL = "http://localhost:8888/.netlify/functions/v2"
$API_KEY = "sk_be2b83b5836ab8c56e413093f7e8b20c975fffa88478ea1ec6876d1b215751ae"

Write-Host "`n=== Service 9161 Test (royalsmmworld.com) ===" -ForegroundColor Cyan
Write-Host "Provider Service ID: 1073" -ForegroundColor Yellow

$testServiceId = "9161"
$testQuantity = 50

Write-Host "Service ID: $testServiceId" -ForegroundColor Yellow
Write-Host "Quantity: $testQuantity" -ForegroundColor Yellow

Write-Host "`n=== Bakiye Kontrol ===" -ForegroundColor Cyan
$balanceBody = "key=$API_KEY&action=balance"
try {
    $balanceResponse = Invoke-RestMethod -Uri $API_BASE_URL -Method POST -Body $balanceBody -ContentType "application/x-www-form-urlencoded"
    
    if ($balanceResponse.error) {
        Write-Host "Bakiye hatasi: $($balanceResponse.error)" -ForegroundColor Red
        exit 1
    }
    
    Write-Host "Bakiyeniz: `$$($balanceResponse.balance)" -ForegroundColor Green
} catch {
    Write-Host "Bakiye kontrol hatasi: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== Siparis Olustur (Service 9161) ===" -ForegroundColor Cyan
Write-Host "Provider: royalsmmworld.com (provider_service_id=1073)" -ForegroundColor Yellow

$testLink = "https://t.me/doskazpozorayakutii/1205"

$orderBody = "key=$API_KEY&action=add&service=$testServiceId&link=$testLink&quantity=$testQuantity"

Write-Host "Request: service=$testServiceId, link=$testLink, quantity=$testQuantity" -ForegroundColor Gray

try {
    $orderResponse = Invoke-RestMethod -Uri $API_BASE_URL -Method POST -Body $orderBody -ContentType "application/x-www-form-urlencoded"
    
    if ($orderResponse.error) {
        Write-Host "Siparis hatasi: $($orderResponse.error)" -ForegroundColor Red
        exit 1
    }
    
    $orderId = $orderResponse.order
    Write-Host "Siparis Basarili!" -ForegroundColor Green
    Write-Host "Order ID: $orderId" -ForegroundColor Green
    Write-Host "`n=== Check Admin Console ===" -ForegroundColor Cyan
    Write-Host "Order #$orderId should show FAILED status with provider_error if provider rejected." -ForegroundColor Yellow
    Write-Host "Customer will see PENDING status." -ForegroundColor Yellow
    
} catch {
    Write-Host "Siparis olusturma hatasi: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`nTest completed. Check Netlify logs for [V2 PROVIDER] forwarding details." -ForegroundColor Cyan
