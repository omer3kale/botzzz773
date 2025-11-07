# Update Netlify Site Configuration to use correct base directory
# This script uses the Netlify API to set the base directory to BOTZZZ/BOTZZZ773

# You'll need your Netlify Personal Access Token
# Get it from: https://app.netlify.com/user/applications#personal-access-tokens

Write-Host "=== Netlify Configuration Updater ===" -ForegroundColor Cyan
Write-Host ""

# Prompt for Netlify token
$token = Read-Host "Enter your Netlify Personal Access Token"

if ([string]::IsNullOrWhiteSpace($token)) {
    Write-Host "Error: Token is required" -ForegroundColor Red
    exit 1
}

# Site ID (from your deployment URL)
$siteId = "darling-profiterole-752433"

Write-Host "Updating site configuration for: $siteId" -ForegroundColor Yellow
Write-Host "Setting base directory to: BOTZZZ/BOTZZZ773" -ForegroundColor Yellow
Write-Host ""

# Prepare the API request
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

$body = @{
    "build_settings" = @{
        "base" = "BOTZZZ/BOTZZZ773"
        "dir" = "."
        "functions_dir" = "netlify/functions"
        "cmd" = "echo 'No build required'"
    }
} | ConvertTo-Json

$uri = "https://api.netlify.com/api/v1/sites/$siteId"

try {
    Write-Host "Sending update request to Netlify API..." -ForegroundColor Yellow
    
    $response = Invoke-RestMethod -Uri $uri -Method Patch -Headers $headers -Body $body
    
    Write-Host ""
    Write-Host "✅ Configuration updated successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Current settings:" -ForegroundColor Cyan
    Write-Host "  Base directory: $($response.build_settings.base)" -ForegroundColor White
    Write-Host "  Publish directory: $($response.build_settings.dir)" -ForegroundColor White
    Write-Host "  Functions directory: $($response.build_settings.functions_dir)" -ForegroundColor White
    Write-Host ""
    Write-Host "Now trigger a new deploy:" -ForegroundColor Yellow
    Write-Host "  1. Go to: https://app.netlify.com/sites/$siteId/deploys" -ForegroundColor White
    Write-Host "  2. Click 'Trigger deploy' → 'Deploy site'" -ForegroundColor White
    Write-Host ""
    Write-Host "Or push to GitHub to trigger auto-deploy (if connected)" -ForegroundColor Yellow
    
} catch {
    Write-Host ""
    Write-Host "❌ Error updating configuration:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  1. Verify your token is valid" -ForegroundColor White
    Write-Host "  2. Check token has write permissions" -ForegroundColor White
    Write-Host "  3. Verify site ID is correct: $siteId" -ForegroundColor White
    exit 1
}
