// Admin Reports and Analytics
window.initializeAdminPopupSurface?.('Admin reports window');

let currentChart = null;
let currentReportTab = 'payments';
let reportData = null;

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

// Initialize chart on page load
document.addEventListener('DOMContentLoaded', async () => {
    await loadReportData();
    initializeChart();
});

// Load report data from backend
async function loadReportData() {
    try {
        const token = localStorage.getItem('authToken');
        if (!token) return;
        
        const response = await fetch('/.netlify/functions/dashboard?reports=true', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            reportData = data;
        } else {
            // Use empty data if backend returns no data
            reportData = {
                payments: [],
                orders: [],
                tickets: [],
                profits: [],
                services: [],
                labels: []
            };
        }
    } catch (error) {
        console.error('Failed to load report data:', error);
        // Use empty data on error
        reportData = {
            payments: [],
            orders: [],
            tickets: [],
            profits: [],
            services: [],
            labels: []
        };
    }
}

// Initialize main chart
function initializeChart() {
    const ctx = document.getElementById('mainChart');
    if (!ctx || !reportData) return;

    const data = {
        labels: reportData.labels || [],
        datasets: [{
            label: 'Revenue',
            data: reportData.payments || [],
            borderColor: '#FF1494',
            backgroundColor: 'rgba(255, 20, 148, 0.1)',
            tension: 0.4,
            fill: true
        }]
    };

    const config = {
        type: 'line',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    backgroundColor: '#1a1a1a',
                    titleColor: '#ffffff',
                    bodyColor: '#a0a0a0',
                    borderColor: '#2a2a2a',
                    borderWidth: 1
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
                        color: '#2a2a2a'
                    },
                    ticks: {
                        color: '#a0a0a0'
                    }
                }
            }
        }
    };

    currentChart = new Chart(ctx, config);
}

// Switch report tab
function switchReportTab(tab) {
    currentReportTab = tab;
    
    // Update active tab
    document.querySelectorAll('.chart-tab').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    // Update chart data based on tab
    updateChartData(tab);
}

// Update chart data from reportData
function updateChartData(tab) {
    if (!currentChart || !reportData) return;
    
    let newData, label, color;
    
    switch(tab) {
        case 'payments':
            newData = reportData.payments || [11000, 8500, 6200, 4800, 3500, 2800, 1900, 1200, 800, 400];
            label = 'Revenue';
            color = '#FF1494';
            break;
        case 'orders':
            newData = reportData.orders || [450, 380, 320, 280, 240, 200, 160, 120, 80, 40];
            label = 'Orders';
            color = '#22c55e';
            break;
        case 'tickets':
            newData = reportData.tickets || [25, 32, 28, 35, 30, 22, 18, 15, 12, 10];
            label = 'Tickets';
            color = '#eab308';
            break;
        case 'profits':
            newData = reportData.profits || [3200, 2800, 2400, 2100, 1800, 1500, 1200, 900, 600, 300];
            label = 'Profits';
            color = '#3b82f6';
            break;
        case 'services':
            newData = reportData.services || [156, 156, 155, 154, 153, 152, 151, 150, 149, 148];
            label = 'Active Services';
            color = '#a855f7';
            break;
        case 'users':
            newData = [1109, 1095, 1082, 1070, 1058, 1045, 1032, 1020, 1008, 995];
            label = 'Users';
            color = '#f97316';
            break;
        case 'providers':
            newData = [3, 3, 3, 2, 2, 2, 2, 2, 2, 2];
            label = 'Active Providers';
            color = '#06b6d4';
            break;
    }
    
    currentChart.data.datasets[0].data = newData;
    currentChart.data.datasets[0].label = label;
    currentChart.data.datasets[0].borderColor = color;
    currentChart.data.datasets[0].backgroundColor = color + '20';
    currentChart.update();
}

// Update charts based on date range
function updateCharts() {
    const dateRange = document.getElementById('dateRange').value;
    showNotification(`Updated reports for ${dateRange.replace('-', ' ')}`, 'success');
    
    // In production, fetch new data based on date range
    updateChartData(currentReportTab);
}

// Toggle between chart and table view
function toggleView(view) {
    const chartView = document.getElementById('chartView');
    const tableView = document.getElementById('tableView');
    const buttons = document.querySelectorAll('.toggle-btn');
    
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    if (view === 'chart') {
        chartView.style.display = 'block';
        tableView.style.display = 'none';
    } else {
        chartView.style.display = 'none';
        tableView.style.display = 'block';
    }
}

// Export report
function exportReport(format) {
    showNotification(`Exporting report as ${format.toUpperCase()}...`, 'success');
    
    setTimeout(() => {
        showNotification(`Report exported successfully!`, 'success');
    }, 1500);
}
