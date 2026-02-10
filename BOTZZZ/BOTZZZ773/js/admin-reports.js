// Admin Reports and Analytics - PROFIT ONLY
window.initializeAdminPopupSurface?.('Admin reports window');

let currentChart = null;
let allOrdersData = []; // Store all orders for client-side filtering
let reportData = null;
let selectedDateRange = '7days'; // Default: last 7 days

// Format currency dynamically (5 decimals, remove trailing zeros)
function formatCurrencyDynamic(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '$0';
    }
    let formatted = Math.abs(number).toFixed(5).replace(/\.?0+$/, '');
    const sign = number < 0 ? '-' : '';
    return `$${sign}${formatted}`;
}

// Show notification helper
function showNotification(message, type = 'info') {
    console.log(`[${type.toUpperCase()}] ${message}`);
    // Can be enhanced with toast notifications UI
}

// Initialize chart on page load
document.addEventListener('DOMContentLoaded', async () => {
    console.log('[REPORTS] Page loaded, starting initialization...');
    await loadReportData();
    console.log('[REPORTS] Data loaded, initializing chart...');
    initializeChart();
    console.log('[REPORTS] Chart initialized');
});

// Load report data from backend
async function loadReportData() {
    try {
        const token = localStorage.getItem('token');  // Fixed: was 'authToken', should be 'token'
        console.log('[REPORTS] token exists:', !!token);
        
        if (!token) {
            console.error('[REPORTS] No token found in localStorage');
            return;
        }
        
        const dateRange = document.getElementById('dateRange')?.value || '7days';
        selectedDateRange = dateRange;
        console.log('[REPORTS] Fetching dashboard data with dateRange:', dateRange);
        const response = await fetch(`/.netlify/functions/dashboard?dateRange=${encodeURIComponent(dateRange)}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        console.log('[REPORTS] Response status:', response.status);
        
        const data = await response.json();
        console.log('[REPORTS] Response data:', data);
        console.log('[REPORTS] ordersChart detaylı:', data.ordersChart);
        console.log('[REPORTS] profitChart detaylı:', data.profitChart);
        
        if (data.stats) {
            reportData = data;
            console.log('[REPORTS] Report data loaded successfully:', data.stats);
            
            // Process profit chart data
            processProfitChartData(data);
            
            // Display stats
            displayProfitStats(data.stats);
            
            // If Users tab is active, refresh the users table
            const activeTab = document.querySelector('.chart-tab.active');
            if (activeTab && activeTab.textContent.trim() === 'Users') {
                console.log('[REPORTS] Users tab active, refreshing users table');
                if (reportData.usersByDay) {
                    fillUsersTable(reportData.usersByDay);
                }
            }
        } else {
            console.error('[REPORTS] No stats in response');
        }
    } catch (error) {
        console.error('[REPORTS] Failed to load report data:', error);
        showNotification('Failed to load report data: ' + error.message, 'error');
    }
}

// Process profit data for chart (last 7 days by default)
function processProfitChartData(data) {
    if (!data.stats) return;
    
    // Use backend-calculated daily profits
    if (data.profitChart) {
        reportData.profitChart = data.profitChart;
        console.log('[REPORTS] Using backend-calculated daily profits:', data.profitChart);
    } else {
        // Fallback: Calculate if not provided
        console.warn('[REPORTS] profitChart not in response, calculating...');
        const dailyProfits = {};
        
        // Initialize last 7 days
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            dailyProfits[dateStr] = 0;
        }
        
        // Fallback: divide total profit evenly
        const totalProfit = parseFloat(data.stats.totalProfits) || 0;
        const dayCount = Object.keys(dailyProfits).length;
        const avgDailyProfit = totalProfit / dayCount;
        
        Object.keys(dailyProfits).forEach(date => {
            dailyProfits[date] = parseFloat(avgDailyProfit.toFixed(5));
        });
        
        reportData.profitChart = dailyProfits;
    }
}

// Display profit statistics
function displayProfitStats(stats) {
    const totalProfitEl = document.querySelector('[data-stat="total-profit"]');
    const dailyAvgEl = document.querySelector('[data-stat="daily-avg-profit"]');
    const totalRevenueEl = document.querySelector('[data-stat="total-revenue"]');
    
    if (totalProfitEl) {
        totalProfitEl.textContent = formatCurrencyDynamic(stats.totalProfits);
    }
    
    if (totalRevenueEl) {
        totalRevenueEl.textContent = formatCurrencyDynamic(stats.totalRevenue);
    }
    
    if (dailyAvgEl) {
        const avgDaily = parseFloat(stats.totalProfits) / 7;
        dailyAvgEl.textContent = formatCurrencyDynamic(avgDaily);
    }
}

// Initialize main chart - PROFIT ONLY
function initializeChart() {
    const ctx = document.getElementById('mainChart');
    console.log('[CHART] Canvas element:', ctx);
    console.log('[CHART] reportData exists:', !!reportData);
    
    if (!ctx) {
        console.error('[CHART] Canvas element #mainChart not found!');
        return;
    }
    
    if (!reportData) {
        console.error('[CHART] reportData is null/undefined');
        return;
    }

    const profitChartData = reportData.profitChart || {};
    const labels = Object.keys(profitChartData).sort();
    const data = labels.map(date => profitChartData[date]);
    
    console.log('[CHART] Labels:', labels);
    console.log('[CHART] Data:', data);

    const chartConfig = {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Daily Profit',
                data: data,
                backgroundColor: '#fbbf24',
                borderColor: '#b45309',
                borderWidth: 1,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: {
                        color: '#ffffff',
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#1a1a1a',
                    titleColor: '#ffffff',
                    bodyColor: '#a0a0a0',
                    borderColor: '#2a2a2a',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return 'Profit: ' + formatCurrencyDynamic(context.parsed.y);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: '#2a2a2a'
                    },
                    ticks: {
                        color: '#a0a0a0',
                        callback: function(value) {
                            return formatCurrencyDynamic(value);
                        }
                    }
                },
                x: {
                    grid: {
                        color: '#2a2a2a',
                        display: false
                    },
                    ticks: {
                        color: '#a0a0a0'
                    }
                }
            }
        }
    };

    currentChart = new Chart(ctx, chartConfig);
}

// Switch report tab - PROFIT ONLY
function switchReportTab(tab) {
    console.log('[REPORTS] Switching to tab:', tab);
    
    // Update active tab button
    document.querySelectorAll('.chart-tab').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    if (tab === 'profits') {
        // Show profit chart and hide users
        document.getElementById('chartView').style.display = 'block';
        document.getElementById('tableView').style.display = 'none';
        document.getElementById('usersTableView').style.display = 'none';
        document.querySelector('.view-toggle').style.display = 'flex';
        if (currentChart) {
            currentChart.resize();
        }
    } else if (tab === 'users') {
        // Hide chart and show users table
        document.getElementById('chartView').style.display = 'none';
        document.getElementById('tableView').style.display = 'none';
        document.getElementById('usersTableView').style.display = 'block';
        document.querySelector('.view-toggle').style.display = 'none';
        
        // Fill users table
        if (reportData && reportData.usersByDay) {
            fillUsersTable(reportData.usersByDay);
        }
    }
}

// Update chart data from reportData - REMOVED (only profit now)
function updateChartData(tab) {
    // Profit-only, no tab switching
    console.log('Profit reports only');
}

// Update charts based on date range - PROFIT ONLY
function updateCharts() {
    console.log('[REPORTS] updateCharts called');
    const dateRangeSelect = document.getElementById('dateRange');
    const selectedValue = dateRangeSelect?.value || 'last-7-days';
    
    // HTML seçeneklerini backend değerlerine map et
    const dateRangeMap = {
        'this-month': 'this-month',
        'last-month': 'last-month',
        'last-7-days': '7days',
        'last-30-days': '30days',
        'last-90-days': '90days',
        'this-year': 'this-year'
    };
    
    selectedDateRange = dateRangeMap[selectedValue] || '7days';
    console.log('[REPORTS] Seçilen tarih aralığı:', selectedValue, '=>', selectedDateRange);
    
    // Veri yeniden yükle ve güncelle
    loadReportData().then(() => {
        console.log('[REPORTS] Data reloaded, destroying old chart');
        if (currentChart) {
            currentChart.destroy();
            currentChart = null;
        }
        console.log('[REPORTS] Initializing new chart');
        initializeChart();
        fillProfitTable();  // Tablo da görünürse güncelle
        showNotification(`Kâr raporu güncellendi: ${dateRangeLabel(selectedDateRange)}`, 'success');
    }).catch(error => {
        console.error('[REPORTS] Error updating charts:', error);
        showNotification('Error updating profit report: ' + error.message, 'error');
    });
}

// Helper: Get label for date range
function dateRangeLabel(range) {
    const labels = {
        '7days': 'Son 7 gün',
        '30days': 'Son 30 gün',
        '90days': 'Son 90 gün',
        'this-month': 'Bu ay',
        'last-month': 'Geçen ay',
        'this-year': 'Bu yıl',
        'ytd': 'Year to date',
        'all': 'All time'
    };
    return labels[range] || 'Son 7 gün';
}

// Günlük profit verisiyle tablo doldur
function fillProfitTable() {
    const tableBody = document.getElementById('reportTableBody');
    if (!tableBody || !reportData || !reportData.profitChart) {
        console.log('[TABLO] Profit verisi yok');
        return;
    }
    
    const profitData = reportData.profitChart;
    const orderData = reportData.ordersChart || {};
    const dates = Object.keys(profitData).sort();
    
    console.log('[TABLO] profitData:', profitData);
    console.log('[TABLO] orderData:', orderData);
    console.log('[TABLO] Tüm reportData:', reportData);
    
    tableBody.innerHTML = '';
    
    dates.forEach(dateStr => {
        const profit = profitData[dateStr];
        const orderCount = orderData[dateStr] || 0;
        const date = new Date(dateStr + 'T00:00:00');
        
        // Format: 25.01.2026 Monday
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        const dateFormatted = `${day}.${month}.${year} ${dayName}`;
        
        console.log(`[TABLO] ${dateStr}: ${orderCount} order, ${profit} profit`);
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${dateFormatted}</td>
            <td>${orderCount}</td>
            <td>${formatCurrencyDynamic(profit)}</td>
        `;
        tableBody.appendChild(row);
    });
    
    // Add total row
    const totalOrders = dates.reduce((sum, dateStr) => sum + (orderData[dateStr] || 0), 0);
    const totalProfit = dates.reduce((sum, dateStr) => sum + (profitData[dateStr] || 0), 0);
    
    const totalRow = document.createElement('tr');
    totalRow.style.fontWeight = 'bold';
    totalRow.style.borderTop = '2px solid var(--admin-accent)';
    totalRow.style.borderBottom = '2px solid var(--admin-accent)';
    totalRow.style.backgroundColor = 'rgba(var(--admin-accent-rgb), 0.08)';
    totalRow.innerHTML = `
        <td style="padding: 12px 8px;">TOTAL</td>
        <td>${totalOrders}</td>
        <td>${formatCurrencyDynamic(totalProfit)}</td>
    `;
    tableBody.appendChild(totalRow);
    
    console.log('[TABLO] Profit tablosu dolduruldu:', dates.length, 'gün, Total:', totalOrders, 'orders,', formatCurrencyDynamic(totalProfit), 'profit');
}

// Chart ve table arasında geçiş yap
function toggleView(view) {
    const chartView = document.getElementById('chartView');
    const tableView = document.getElementById('tableView');
    const usersTableView = document.getElementById('usersTableView');
    const buttons = document.querySelectorAll('.toggle-btn');
    
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    if (view === 'chart') {
        chartView.style.display = 'block';
        tableView.style.display = 'none';
        usersTableView.style.display = 'none';
    } else {
        chartView.style.display = 'none';
        tableView.style.display = 'block';
        usersTableView.style.display = 'none';
        fillProfitTable();  // Table sekmesine geçilince tablo doldur
    }
}

// Export report - PROFIT ONLY
function exportReport(format) {
    if (!reportData || !reportData.stats) {
        showNotification('No data to export', 'warning');
        return;
    }
    
    showNotification(`Exporting profit report as ${format.toUpperCase()}...`, 'success');
    
    const profitData = {
        totalProfit: reportData.stats.totalProfits,
        totalRevenue: reportData.stats.totalRevenue,
        dateRange: dateRangeLabel(selectedDateRange),
        generatedAt: new Date().toISOString(),
        dailyProfits: reportData.profitChart
    };
    
    if (format === 'json') {
        downloadJSON(profitData, `profit-report-${new Date().toISOString().split('T')[0]}.json`);
    } else if (format === 'csv') {
        downloadCSV(profitData, `profit-report-${new Date().toISOString().split('T')[0]}.csv`);
    }
    
    setTimeout(() => {
        showNotification(`Profit report exported successfully!`, 'success');
    }, 1500);
}

// Download JSON helper
function downloadJSON(data, filename) {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

// Fill users table with daily user spending and profit data
function fillUsersTable(usersByDay) {
    const tableBody = document.getElementById('usersTableBody');
    tableBody.innerHTML = '';
    
    if (!usersByDay || Object.keys(usersByDay).length === 0) {
        tableBody.innerHTML = '<tr><td colspan="4">No user data available</td></tr>';
        return;
    }
    
    // Flatten users by day data into rows
    const rows = [];
    
    Object.entries(usersByDay).forEach(([date, users]) => {
        if (Array.isArray(users)) {
            users.forEach(user => {
                rows.push({
                    date: date,
                    username: user.username,
                    totalSpent: user.total_charge,
                    profit: user.profit
                });
            });
        }
    });
    
    // Sort by date descending
    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Format dates
    rows.forEach(row => {
        const date = new Date(row.date + 'T00:00:00Z');
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });
        const dateFormatted = `${day}.${month}.${year} ${dayName}`;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${dateFormatted}</td>
            <td>${row.username || 'Anonymous'}</td>
            <td>${formatCurrencyDynamic(row.totalSpent)}</td>
            <td>${formatCurrencyDynamic(row.profit)}</td>
        `;
        tableBody.appendChild(tr);
    });
}
// Download CSV helper
function downloadCSV(data, filename) {
    let csv = 'Date,Profit\n';
    Object.entries(data.dailyProfits || {}).forEach(([date, profit]) => {
        csv += `${date},${profit}\n`;
    });
    csv += `\nTotal,${data.totalProfit}\n`;
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
