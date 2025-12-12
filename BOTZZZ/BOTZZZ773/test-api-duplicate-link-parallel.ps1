# Test Scenario: Parallel Duplicate Link Protection (Race Condition Test)
# Send 10 requests simultaneously to same service + link
# -----------------------------------------------

$API_BASE_URL = "http://localhost:8888/.netlify/functions/v2"
$API_KEY = "sk_be2b83b5836ab8c56e413093f7e8b20c975fffa88478ea1ec6876d1b215751ae"

Write-Host "`n=== Parallel Duplicate Link Protection Test (10 Concurrent Requests) ===" -ForegroundColor Cyan

$testServiceId = "9224"
$testLink = "https://instagram.com/duplicate_test_$(Get-Random -Minimum 1000 -Maximum 1999)"
$testQuantity = 10

Write-Host "Service: $testServiceId" -ForegroundColor Yellow
Write-Host "Link: $testLink" -ForegroundColor Yellow
Write-Host "Quantity: $testQuantity" -ForegroundColor Yellow
Write-Host "Sending 10 SIMULTANEOUS requests..." -ForegroundColor Cyan

$orderBody = "key=$API_KEY&action=add&service=$testServiceId&link=$testLink&quantity=$testQuantity"

# Create 10 parallel jobs
$jobs = @()
for ($i = 1; $i -le 10; $i++) {
    $job = Start-Job -ScriptBlock {
        param($uri, $body)
        try {
            $response = Invoke-RestMethod -Uri $uri -Method POST -Body $body -ContentType "application/x-www-form-urlencoded" -TimeoutSec 30
            return @{
                success = !$response.error
                order = $response.order
                error = $response.error
                index = $using:i
            }
        } catch {
            return @{
                success = $false
                error = $_.Exception.Message
                index = $using:i
            }
        }
    } -ArgumentList $API_BASE_URL, $orderBody
    
    $jobs += $job
}

Write-Host "`nWaiting for all 10 requests to complete..." -ForegroundColor Yellow
$startTime = Get-Date

# Wait for all jobs to complete
$results = @()
foreach ($job in $jobs) {
    $result = Receive-Job -Job $job -Wait
    $results += $result
    Remove-Job -Job $job
}

$endTime = Get-Date
$duration = ($endTime - $startTime).TotalSeconds

Write-Host "`n=== Results (Completed in $([Math]::Round($duration, 2))s) ===" -ForegroundColor Cyan

$successCount = ($results | Where-Object { $_.success }).Count
$errorCount = ($results | Where-Object { !$_.success }).Count

Write-Host "`n✅ Successfully Created: $successCount orders" -ForegroundColor Green
Write-Host "❌ Rejected/Failed: $errorCount requests" -ForegroundColor Red

Write-Host "`n=== Details ===" -ForegroundColor Cyan
foreach ($result in ($results | Sort-Object { $_.order -as [int] } -Descending)) {
    if ($result.success) {
        Write-Host "Order #$($result.order) - SUCCESS" -ForegroundColor Green
    } else {
        Write-Host "Request - ERROR: $($result.error)" -ForegroundColor Yellow
    }
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
if ($successCount -eq 1 -and $errorCount -eq 9) {
    Write-Host "✅ CORRECT: Only 1 order created, 9 rejected (race condition protected)" -ForegroundColor Green
} elseif ($successCount -gt 1) {
    Write-Host "⚠️  WARNING: $successCount orders created (race condition may not be fully protecting)" -ForegroundColor Red
} else {
    Write-Host "❌ Unexpected result" -ForegroundColor Red
}

# Show all order IDs
$createdOrders = $results | Where-Object { $_.success } | Select-Object -ExpandProperty order
if ($createdOrders.Count -gt 0) {
    Write-Host "`nCreated Order IDs: $($createdOrders -join ', ')" -ForegroundColor Cyan
}
