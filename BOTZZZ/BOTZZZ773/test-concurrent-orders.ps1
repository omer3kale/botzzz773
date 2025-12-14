# Test: Concurrent Order Creation - Retry Logic Verification
# Creates multiple orders simultaneously to test duplicate order_number handling

$API_BASE_URL = "http://localhost:8888/.netlify/functions/v2"
$API_KEY = "sk_be2b83b5836ab8c56e413093f7e8b20c975fffa88478ea1ec6876d1b215751ae"
$SERVICE_ID = "9074"
$QUANTITY = 50
$CONCURRENT_REQUESTS = 50

Write-Host "`n=== Concurrent Order Creation Test ===" -ForegroundColor Cyan
Write-Host "Creating $CONCURRENT_REQUESTS orders simultaneously..." -ForegroundColor Yellow
Write-Host "This tests the retry logic for duplicate order_number handling`n" -ForegroundColor Gray

$jobs = @()
$startTime = Get-Date

# Launch multiple orders at the same time
for ($i = 1; $i -le $CONCURRENT_REQUESTS; $i++) {
    $randomId = Get-Random -Minimum 10000 -Maximum 99999
    $testLink = "https://instagram.com/concurrent_test_$randomId"
    
    $scriptBlock = {
        param($url, $key, $service, $link, $qty, $index)
        
        $body = "key=$key&action=add&service=$service&link=$link&quantity=$qty"
        
        try {
            $response = Invoke-RestMethod -Uri $url -Method POST -Body $body -ContentType "application/x-www-form-urlencoded" -ErrorAction Stop
            
            if ($response.order) {
                return @{
                    Success = $true
                    OrderNumber = $response.order
                    Index = $index
                    Link = $link
                }
            } else {
                return @{
                    Success = $false
                    Error = $response.error
                    Index = $index
                }
            }
        } catch {
            return @{
                Success = $false
                Error = $_.Exception.Message
                Index = $index
            }
        }
    }
    
    $job = Start-Job -ScriptBlock $scriptBlock -ArgumentList $API_BASE_URL, $API_KEY, $SERVICE_ID, $testLink, $QUANTITY, $i
    $jobs += $job
}

Write-Host "Waiting for all requests to complete..." -ForegroundColor Yellow

# Wait for all jobs to complete
$results = $jobs | Wait-Job | Receive-Job
$jobs | Remove-Job

$endTime = Get-Date
$duration = ($endTime - $startTime).TotalSeconds

Write-Host "`n=== Results ===" -ForegroundColor Cyan
Write-Host "Duration: $([math]::Round($duration, 2)) seconds" -ForegroundColor Gray
Write-Host "Total Requests: $CONCURRENT_REQUESTS" -ForegroundColor Gray

$successful = ($results | Where-Object { $_.Success -eq $true }).Count
$failed = ($results | Where-Object { $_.Success -eq $false }).Count

Write-Host "`nSuccessful: $successful" -ForegroundColor Green
Write-Host "Failed: $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "Green" })

if ($successful -gt 0) {
    Write-Host "`n=== Created Order Numbers ===" -ForegroundColor Cyan
    $orderNumbers = $results | Where-Object { $_.Success -eq $true } | ForEach-Object { $_.OrderNumber } | Sort-Object
    
    $orderNumbers | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
    
    # Check for duplicates
    $duplicates = $orderNumbers | Group-Object | Where-Object { $_.Count -gt 1 }
    
    if ($duplicates) {
        Write-Host "`n⚠️  DUPLICATES FOUND!" -ForegroundColor Red
        $duplicates | ForEach-Object {
            Write-Host "  Order #$($_.Name) appeared $($_.Count) times" -ForegroundColor Red
        }
        Write-Host "`n❌ Retry logic may not be working correctly" -ForegroundColor Red
    } else {
        Write-Host "`n✓ No duplicates detected!" -ForegroundColor Green
        Write-Host "✓ All order numbers are unique" -ForegroundColor Green
        Write-Host "✓ Retry logic working correctly" -ForegroundColor Green
    }
}

if ($failed -gt 0) {
    Write-Host "`n=== Failed Requests ===" -ForegroundColor Red
    $failedResults = $results | Where-Object { $_.Success -eq $false }
    foreach ($result in $failedResults) {
        Write-Host "  Request #$($result.Index): $($result.Error)" -ForegroundColor Red
    }
}

Write-Host "`n=== Test Complete ===" -ForegroundColor Cyan
