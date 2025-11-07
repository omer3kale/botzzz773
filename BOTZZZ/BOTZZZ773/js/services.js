// ==========================================
// Services Page JavaScript
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
    // Load services from API
    loadServicesFromAPI();
    
    // Service Filter
    const filterButtons = document.querySelectorAll('.filter-btn');
    const searchInput = document.getElementById('serviceSearch');
    
    // Filter by category
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            const filter = this.dataset.filter;
            const serviceCategories = document.querySelectorAll('.service-category');
            
            // Update active button
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Filter categories
            serviceCategories.forEach(category => {
                if (filter === 'all') {
                    category.style.display = 'block';
                } else {
                    if (category.dataset.category === filter) {
                        category.style.display = 'block';
                    } else {
                        category.style.display = 'none';
                    }
                }
            });
            
            // Animate appearance
            setTimeout(() => {
                const visibleCategories = Array.from(serviceCategories)
                    .filter(cat => cat.style.display !== 'none');
                visibleCategories.forEach((cat, index) => {
                    cat.style.animation = 'none';
                    setTimeout(() => {
                        cat.style.animation = 'fadeInUp 0.5s ease';
                    }, index * 100);
                });
            }, 100);
        });
    });
    
    // Search functionality
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const serviceCategories = document.querySelectorAll('.service-category');
            
            serviceCategories.forEach(category => {
                const categoryTitle = category.querySelector('.category-title').textContent.toLowerCase();
                const subcategories = category.querySelectorAll('.service-subcategory');
                let hasVisibleSubcategory = false;
                
                subcategories.forEach(subcategory => {
                    const subcategoryTitle = subcategory.querySelector('.subcategory-title').textContent.toLowerCase();
                    const rows = subcategory.querySelectorAll('.service-row:not(.service-row-header)');
                    let hasVisibleRow = false;
                    
                    rows.forEach(row => {
                        const serviceName = row.querySelector('strong')?.textContent.toLowerCase() || '';
                        const serviceDetails = row.querySelector('.service-details')?.textContent.toLowerCase() || '';
                        
                        if (serviceName.includes(searchTerm) || 
                            serviceDetails.includes(searchTerm) ||
                            categoryTitle.includes(searchTerm) ||
                            subcategoryTitle.includes(searchTerm)) {
                            row.style.display = 'grid';
                            hasVisibleRow = true;
                        } else {
                            row.style.display = 'none';
                        }
                    });
                    
                    if (hasVisibleRow || subcategoryTitle.includes(searchTerm)) {
                        subcategory.style.display = 'block';
                        hasVisibleSubcategory = true;
                    } else {
                        subcategory.style.display = 'none';
                    }
                });
                
                if (hasVisibleSubcategory || categoryTitle.includes(searchTerm)) {
                    category.style.display = 'block';
                } else {
                    category.style.display = 'none';
                }
            });
        });
    }
    
    // Smooth scroll to category from hash
    if (window.location.hash) {
        setTimeout(() => {
            const target = document.querySelector(window.location.hash);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }, 100);
    }
    
    // Highlight matching text in search
    function highlightText(text, search) {
        if (!search) return text;
        const regex = new RegExp(`(${search})`, 'gi');
        return text.replace(regex, '<mark style="background: rgba(255,20,148,0.3); color: #FF1494;">$1</mark>');
    }
});

// Add fade in animation
const style = document.createElement('style');
style.textContent = `
    @keyframes fadeInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
`;
document.head.appendChild(style);

console.log('📱 Services page loaded!');

// ==========================================
// Load Services from API
// ==========================================

async function loadServicesFromAPI() {
    const container = document.getElementById('servicesContainer');
    
    try {
        // Show loading state
        container.innerHTML = '<div class="loading-spinner" style="text-align: center; padding: 60px;"><div style="display: inline-block; width: 50px; height: 50px; border: 4px solid rgba(255,20,148,0.2); border-top-color: #FF1494; border-radius: 50%; animation: spin 1s linear infinite;"></div><p style="margin-top: 20px; color: #94A3B8;">Loading services...</p></div>';
        
        const response = await fetch('/.netlify/functions/services', {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || 'Failed to load services');
        }
        
        const services = data.services || [];
        console.log('[DEBUG] Loaded services:', services.length, services);
        
        if (services.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 80px 20px;">
                    <div style="font-size: 80px; margin-bottom: 20px;">📦</div>
                    <h3 style="color: #1E293B; margin-bottom: 12px; font-size: 24px;">No Services Available</h3>
                    <p style="color: #64748B; font-size: 16px;">Services will appear here once they are synced from providers.</p>
                </div>
            `;
            return;
        }
        
        // Group services by category
        const grouped = {};
        services.forEach(service => {
            const category = (service.category || 'Other').toLowerCase();
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push(service);
        });
        
        // Generate HTML for each category
        let html = '';
        const categoryIcons = {
            'instagram': '📱',
            'tiktok': '🎵',
            'youtube': '▶️',
            'twitter': '🐦',
            'facebook': '👥',
            'telegram': '💬',
            'spotify': '🎧',
            'soundcloud': '🎶',
            'other': '⭐'
        };
        
        Object.keys(grouped).sort().forEach(category => {
            const icon = categoryIcons[category] || '⭐';
            const categoryServices = grouped[category];
            const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
            
            html += `
                <div class="service-category" data-category="${category}" id="${category}">
                    <h2 class="category-title">${icon} ${categoryName} Services</h2>
                    
                    <div class="service-subcategory">
                        <div class="services-table">
                            <div class="service-row service-row-header">
                                <div class="service-col">Service Name</div>
                                <div class="service-col">Rate (per 1000)</div>
                                <div class="service-col">Min/Max</div>
                                <div class="service-col">Action</div>
                            </div>
            `;
            
            categoryServices.forEach(service => {
                const rate = parseFloat(service.rate || 0);
                const pricePerK = rate.toFixed(2);
                const min = parseInt(service.min_order || 10);
                const max = parseInt(service.max_order || 10000);
                
                html += `
                    <div class="service-row" data-service-id="${service.id}">
                        <div class="service-col">
                            <strong>${escapeHtml(service.name)}</strong>
                            <span class="service-details">${escapeHtml(service.description || '')}</span>
                        </div>
                        <div class="service-col price">$${pricePerK}</div>
                        <div class="service-col">${formatNumber(min)} / ${formatNumber(max)}</div>
                        <div class="service-col">
                            <a href="order.html?service=${service.id}" class="btn btn-primary btn-sm">Order</a>
                        </div>
                    </div>
                `;
            });
            
            html += `
                        </div>
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
        console.log('[SUCCESS] Services loaded and displayed');
        
    } catch (error) {
        console.error('[ERROR] Failed to load services:', error);
        container.innerHTML = `
            <div style="text-align: center; padding: 80px 20px;">
                <div style="font-size: 80px; margin-bottom: 20px;">⚠️</div>
                <h3 style="color: #DC2626; margin-bottom: 12px; font-size: 24px;">Failed to Load Services</h3>
                <p style="color: #64748B; font-size: 16px; margin-bottom: 20px;">${error.message}</p>
                <button onclick="location.reload()" class="btn btn-primary">Retry</button>
            </div>
        `;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(0) + 'K';
    }
    return num.toString();
}
