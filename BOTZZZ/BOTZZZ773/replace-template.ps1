$path = 'C:\Users\meydo\Desktop\repo\botzzz773\BOTZZZ\BOTZZZ773\js\admin-settings.js'
$lines = [System.IO.File]::ReadAllLines($path)

$startIdx = -1
$endIdx = -1

for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -like '*providersGrid.innerHTML*') {
        $startIdx = $i
        Write-Host "Start at line $($i+1)"
    }
    if ($i -gt $startIdx -and $startIdx -ge 0 -and $lines[$i] -like '*.join*') {
        $endIdx = $i
        Write-Host "End at line $($i+1)"
        break
    }
}

Write-Host "Replacing lines $($startIdx+1) to $($endIdx+1)"

$newLines = [System.Collections.ArrayList]::new()

# Add lines before the template
for ($i = 0; $i -lt $startIdx; $i++) {
    $newLines.Add($lines[$i]) > $null
}

# Add new template
@'
    providersGrid.innerHTML = `
        <div class="providers-list">
            ${settingsProvidersCache.map(provider => `
                <div class="provider-list-item">
                    <div class="provider-name">
                        <i class="fas fa-plug"></i>
                        <span>${escapeHtml(provider.name)}</span>
                        <span class="status-badge ${provider.status === 'active' ? 'completed' : 'pending'}">${provider.status}</span>
                    </div>
                    <div class="provider-balance">
                        <i class="fas fa-wallet"></i>
                        <span>$${(provider.balance || 0).toFixed(2)}</span>
                    </div>
                    <div class="provider-actions-row">
                        <button class="btn-secondary btn-sm" onclick="testProvider('${provider.id}')" title="Test API Connection">
                            <i class="fas fa-check-circle"></i> Test Connection
                        </button>
                        <button class="btn-primary btn-sm" onclick="syncProvider('${provider.id}')" title="Sync Services from Provider">
                            <i class="fas fa-sync"></i> Sync Provider
                        </button>
                        <button class="btn-icon" onclick="editProvider('${provider.id}')" title="Edit Provider">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon btn-danger" onclick="deleteProvider('${provider.id}')" title="Delete Provider">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
'@ -split "`n" | ForEach-Object {
    $newLines.Add($_) > $null
}

# Add lines after the template
for ($i = $endIdx + 1; $i -lt $lines.Count; $i++) {
    $newLines.Add($lines[$i]) > $null
}

Write-Host "Writing file with $($newLines.Count) lines"
[System.IO.File]::WriteAllLines($path, $newLines, [System.Text.Encoding]::UTF8)
Write-Host "SUCCESS!"
