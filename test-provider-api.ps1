$provider_api_url = 'https://apismmprovider.com/api/v2'
$api_key = '79cca25723b74c6d2242b6a1563b7504'

# Test with order 92636
$body = 'key=' + $api_key + '&action=status&order=92636'

Write-Host "Testing Provider API Status Endpoint" -ForegroundColor Cyan
Write-Host "URL: $provider_api_url" -ForegroundColor Yellow
Write-Host "Order ID: 92636" -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri $provider_api_url -Method POST -Body $body -ContentType 'application/x-www-form-urlencoded'
    Write-Host "`nProvider Response:" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 10) -ForegroundColor White
} catch {
    Write-Host "`nError: " $_.Exception.Message -ForegroundColor Red
    Write-Host "Exception Details:" -ForegroundColor Red
    Write-Host $_ -ForegroundColor Red
}
