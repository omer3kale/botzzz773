# Test Scenario: Reseller orders via API -> Provider has insufficient balance
# ----------------------------------------------------------------------------

$API_BASE_URL = "http://localhost:8888/.netlify/functions/v2"
$API_KEY = "sk_be2b83b5836ab8c56e413093f7e8b20c975fffa88478ea1ec6876d1b215751ae"

Write-Host "`n=== 1. Test Service: 9074 ===" -ForegroundColor Cyan

$testServiceId = "9074"
$testQuantity = 50

Write-Host "Service ID: $testServiceId" -ForegroundColor Yellow
Write-Host "Quantity: $testQuantity" -ForegroundColor Yellow
Write-Host "Link Type: YouTube" -ForegroundColor Yellow

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

Write-Host "`n=== 2. Siparis Olustur ===" -ForegroundColor Cyan
Write-Host "Bu test provider'da bakiye yetersizligi simule eder" -ForegroundColor Yellow

$bulkOrderCount = 1
$orderResults = @()

Write-Host "Toplam $bulkOrderCount siparis olusturulacak" -ForegroundColor Yellow
Write-Host "Service ID: $testServiceId, Quantity: $testQuantity" -ForegroundColor Gray

for ($i = 1; $i -le $bulkOrderCount; $i++) {
    Write-Host "`n--- Siparis #$i/$bulkOrderCount ---" -ForegroundColor Cyan
    
    $randomId = Get-Random -Minimum 100000 -Maximum 999999
    $testLink = "https://www.youtube.com/watch?v=dQw4w9WgXcQ_$randomId"
    
    $orderBody = "key=$API_KEY&action=add&service=$testServiceId&link=$testLink&quantity=$testQuantity"
    
    Write-Host "Link: $testLink" -ForegroundColor Gray
    
    try {
        $orderResponse = Invoke-RestMethod -Uri $API_BASE_URL -Method POST -Body $orderBody -ContentType "application/x-www-form-urlencoded"
        
        if ($orderResponse.error) {
            Write-Host "Hata: $($orderResponse.error)" -ForegroundColor Red
            $orderResults += [PSCustomObject]@{
                OrderNumber = $i
                Link = $testLink
                OrderId = "N/A"
                Status = "HATA"
                Error = $orderResponse.error
            }
        } else {
            $orderId = $orderResponse.order
            Write-Host "Siparis olusturuldu: Order #$orderId" -ForegroundColor Green
            
            # Kisa bekle ve durumu kontrol et
            Start-Sleep -Milliseconds 1000
            
            $statusBody = "key=$API_KEY&action=status&order=$orderId"
            $statusResponse = Invoke-RestMethod -Uri $API_BASE_URL -Method POST -Body $statusBody -ContentType "application/x-www-form-urlencoded"
            
            $statusColor = "Yellow"
            if ($statusResponse.status -eq "Completed") { $statusColor = "Green" }
            elseif ($statusResponse.status -eq "Processing") { $statusColor = "Cyan" }
            elseif ($statusResponse.status -eq "Failed") { $statusColor = "Red" }
            
            Write-Host "Status: $($statusResponse.status)" -ForegroundColor $statusColor
            
            $orderResults += [PSCustomObject]@{
                OrderNumber = $i
                Link = $testLink
                OrderId = $orderId
                Status = $statusResponse.status
                Charge = if ($statusResponse.charge) { "`$$($statusResponse.charge)" } else { "N/A" }
            }
        }
        
        Start-Sleep -Milliseconds 500
        
    } catch {
        Write-Host "Siparis hatasi: $($_.Exception.Message)" -ForegroundColor Red
        $orderResults += [PSCustomObject]@{
            OrderNumber = $i
            Link = $testLink
            OrderId = "N/A"
            Status = "HATA"
            Error = $_.Exception.Message
        }
    }
}

Write-Host "`n=== Toplu Siparis Sonuclari ===" -ForegroundColor Cyan
Write-Host "Toplam siparis: $bulkOrderCount" -ForegroundColor White
$orderResults | Format-Table -AutoSize

Write-Host "`n=== Onemli Notlar ===" -ForegroundColor Yellow
Write-Host "1. Toplu siparis tamamlandi" -ForegroundColor Green
Write-Host "2. Her siparis farkli link ile olusturuldu" -ForegroundColor Green
Write-Host "3. Admin panelde siparisleri kontrol edin" -ForegroundColor Yellow
Write-Host "4. Provider bakiye yoksa: Failed durumunda gorunmeli" -ForegroundColor Yellow
Write-Host "5. 3 dakika sonra alert email gelmeli" -ForegroundColor Yellow

Write-Host "`n=== Test Tamamlandi ===" -ForegroundColor Cyan
Write-Host "Admin paneli kontrol edin: http://localhost:8888/admin/orders.html" -ForegroundColor White
Write-Host "User dashboard: http://localhost:8888/dashboard.html" -ForegroundColor White
