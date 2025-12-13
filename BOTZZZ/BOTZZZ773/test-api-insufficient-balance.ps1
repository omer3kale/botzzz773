# Test Scenario: Reseller orders via API -> Provider has insufficient balance
# ----------------------------------------------------------------------------

$API_BASE_URL = "http://localhost:8888/.netlify/functions/v2"
$API_KEY = "sk_be2b83b5836ab8c56e413093f7e8b20c975fffa88478ea1ec6876d1b215751ae"

Write-Host "`n=== 1. Test Service: 9161 ===" -ForegroundColor Cyan

$testServiceId = "9161"
$testQuantity = 50

Write-Host "Service ID: $testServiceId" -ForegroundColor Yellow
Write-Host "Quantity: $testQuantity" -ForegroundColor Yellow

Write-Host "`n=== 2. Bakiye Kontrol ===" -ForegroundColor Cyan
$balanceBody = "key=$API_KEY&action=balance"
try {
    $balanceResponse = Invoke-RestMethod -Uri $API_BASE_URL -Method POST -Body $balanceBody -ContentType "application/x-www-form-urlencoded"
    
    if ($balanceResponse.error) {
        Write-Host "Bakiye hatasi: $($balanceResponse.error)" -ForegroundColor Red
        Write-Host "API Key dogru mu? Dashboard'dan yeni key olusturun." -ForegroundColor Yellow
        exit 1
    }
    
    Write-Host "Bakiyeniz: `$$($balanceResponse.balance)" -ForegroundColor Green
} catch {
    Write-Host "Bakiye kontrol hatasi: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n=== 2. Test Siparisi Olustur ===" -ForegroundColor Cyan
Write-Host "Bu test provider'da bakiye yetersizligi simule eder" -ForegroundColor Yellow

$testLink = "https://t.me/doskazpozorayakutii/1205"

$orderBody = "key=$API_KEY&action=add&service=$testServiceId&link=$testLink&quantity=$testQuantity"

Write-Host "Service ID: $testServiceId" -ForegroundColor Gray
Write-Host "Link: $testLink" -ForegroundColor Gray
Write-Host "Quantity: $testQuantity" -ForegroundColor Gray

try {
    $orderResponse = Invoke-RestMethod -Uri $API_BASE_URL -Method POST -Body $orderBody -ContentType "application/x-www-form-urlencoded"
    
    if ($orderResponse.error) {
        Write-Host "Siparis hatasi: $($orderResponse.error)" -ForegroundColor Red
        
        if ($orderResponse.error -like "*Not enough balance*") {
            Write-Host "Sizin bakiyeniz yetersiz. Once balance yukleyin." -ForegroundColor Yellow
        } elseif ($orderResponse.error -like "*duplicate*") {
            Write-Host "Bu link icin zaten aktif siparis var." -ForegroundColor Yellow
        }
    } else {
        $orderId = $orderResponse.order
        Write-Host "Siparis olusturuldu: Order #$orderId" -ForegroundColor Green
        
        Write-Host "`n=== 4. Siparis Durumu Kontrol ===" -ForegroundColor Cyan
        Start-Sleep -Seconds 2
        
        $statusBody = "key=$API_KEY&action=status&order=$orderId"
        $statusResponse = Invoke-RestMethod -Uri $API_BASE_URL -Method POST -Body $statusBody -ContentType "application/x-www-form-urlencoded"
        
        $statusColor = "Yellow"
        if ($statusResponse.status -eq "Completed") { $statusColor = "Green" }
        elseif ($statusResponse.status -eq "Processing") { $statusColor = "Cyan" }
        
        Write-Host "Status: $($statusResponse.status)" -ForegroundColor $statusColor
        
        if ($statusResponse.charge) {
            Write-Host "Charge: `$$($statusResponse.charge)" -ForegroundColor Gray
        }
        
        Write-Host "`n=== Test Sonuclari ===" -ForegroundColor Cyan
        Write-Host "1. Reseller API ile siparis verdi" -ForegroundColor Green
        Write-Host "2. Sizin API'niz siparisi aldi" -ForegroundColor Green
        Write-Host "3. Provider'a iletildi (veya iletim sirasinda hata)" -ForegroundColor Yellow
        Write-Host "4. Admin panelde siparisi kontrol edin (Order #$orderId)" -ForegroundColor Yellow
        Write-Host "   - Provider bakiye yoksa: Admin'de Failed, User'da Pending gorunmeli" -ForegroundColor Yellow
    }
} catch {
    Write-Host "Siparis hatasi: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== Test Tamamlandi ===" -ForegroundColor Cyan
Write-Host "Admin paneli kontrol edin: http://localhost:8888/admin/orders.html" -ForegroundColor White
Write-Host "User dashboard: http://localhost:8888/dashboard.html" -ForegroundColor White
