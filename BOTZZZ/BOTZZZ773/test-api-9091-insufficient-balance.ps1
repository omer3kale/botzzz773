# Test Scenario: Service 9267 - Test provider_id and provider_name capture
# -----------------------------------------------

$API_BASE_URL = "http://localhost:8888/.netlify/functions/v2"
$API_KEY = "sk_be2b83b5836ab8c56e413093f7e8b20c975fffa88478ea1ec6876d1b215751ae"

Write-Host "`n=== Service 198 Test ===" -ForegroundColor Cyan
Write-Host "Service 198 (Instagram Followers) - has provider_id" -ForegroundColor Yellow

$testServiceId = "9261"
$testQuantity = 100

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

Write-Host "`n=== Siparis Olustur (Service 198) ===" -ForegroundColor Cyan
Write-Host "Testing provider_id and provider_name in new order" -ForegroundColor Yellow

$testLink = "https://www.instagram.com/dhazaraltuntas/"

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
    Write-Host "`n=== Kontrol Et ===" -ForegroundColor Cyan
    Write-Host "1. v2.js console'unda [V2] Service full data log'unu kontrol et" -ForegroundColor Yellow
    Write-Host "2. Admin panel'i yenile ve order #$orderId'yi ara" -ForegroundColor Yellow
    Write-Host "3. Provider name'in beyaz kutu içinde gösterildiğini kontrol et" -ForegroundColor Yellow
    
} catch {
    Write-Host "Siparis olusturma hatasi: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`nTest completed. Check v2.js console logs and admin panel for provider_name display." -ForegroundColor Cyan
