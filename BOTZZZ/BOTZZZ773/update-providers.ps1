$path = 'C:\Users\meydo\Desktop\repo\botzzz773\BOTZZZ\BOTZZZ773\js\admin-settings.js'

# Read file
$content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

# Find and replace the entire template
$oldTemplate = 'providersGrid.innerHTML = settingsProvidersCache.map(provider => `
        <div class="provider-card">
            <div class="provider-header">
                <div class="provider-info">
                    <h3>${escapeHtml(provider.name)}</h3>
                    <span class="status-badge ${provider.status === ''active'' ? ''completed'' : ''pending''}">${provider.status}</span>
                </div>
                <div class="provider-actions">
                    <button class="btn-icon" onclick="editProvider(''${provider.id}'')" title="Edit">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="btn-icon" onclick="deleteProvider(''${provider.id}'')" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="provider-details">
                <div class="provider-detail-item">
                    <span class="detail-label">API URL:</span>
                    <span class="detail-value">${escapeHtml(provider.api_url)}</span>
                </div>
                <div class="provider-detail-item">
                    <span class="detail-label">API Key:</span>
                    <span class="detail-value">••••••${provider.api_key ? provider.api_key.slice(-4) : ''••••''}</span>
                </div>
                <div class="provider-detail-item">
                    <span class="detail-label">Markup:</span>
                    <span class="detail-value">${provider.markup}%</span>
                </div>
            </div>
            <div class="provider-footer">
                <button class="btn-secondary btn-sm" onclick="syncProvider(''${provider.id}'')">
                    <i class="fas fa-sync"></i> Sync Provider
                </button>
                <button class="btn-secondary btn-sm" onclick="testProvider(''${provider.id}'')">
                    <i class="fas fa-check-circle"></i> Test Connection
                </button>
            </div>
        </div>
    `).join('''')'

$newTemplate = 'providersGrid.innerHTML = `
        <div class="providers-list">
            ${settingsProvidersCache.map(provider => `
                <div class="provider-list-item">
                    <div class="provider-name">
                        <i class="fas fa-plug"></i>
                        <span>${escapeHtml(provider.name)}</span>
                        <span class="status-badge ${provider.status === ''active'' ? ''completed'' : ''pending''}">${provider.status}</span>
                    </div>
                    <div class="provider-balance">
                        <i class="fas fa-wallet"></i>
                        <span>$${(provider.balance || 0).toFixed(2)}</span>
                    </div>
                    <div class="provider-actions-row">
                        <button class="btn-secondary btn-sm" onclick="testProvider(''${provider.id}'')" title="Test API Connection">
                            <i class="fas fa-check-circle"></i> Test Connection
                        </button>
                        <button class="btn-primary btn-sm" onclick="syncProvider(''${provider.id}'')" title="Sync Services from Provider">
                            <i class="fas fa-sync"></i> Sync Provider
                        </button>
                        <button class="btn-icon" onclick="editProvider(''${provider.id}'')" title="Edit Provider">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon btn-danger" onclick="deleteProvider(''${provider.id}'')" title="Delete Provider">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('''')}
        </div>
    `;'

if ($content -contains $oldTemplate) {
    Write-Host "Found pattern - replacing"
    $newContent = $content -replace [regex]::Escape($oldTemplate), $newTemplate
    [System.IO.File]::WriteAllText($path, $newContent, [System.Text.Encoding]::UTF8)
    Write-Host "SUCCESS - template updated"
} else {
    Write-Host "ERROR - pattern not found"
    Write-Host "Searching for partial matches..."
    if ($content -like "*provider-card*") {
        Write-Host "Found provider-card"
    }
    if ($content -like "*provider-list-item*") {
        Write-Host "Found provider-list-item (already updated?)"
    }
}
