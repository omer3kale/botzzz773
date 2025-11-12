// ==========================================
// Services Page JavaScript
// ==========================================

let filterButtons;

document.addEventListener('DOMContentLoaded', function() {
    // Load services from API first, then initialize filters
    loadServicesFromAPI()
        .then(isLoaded => {
            if (isLoaded) {
                initializeFilters();
            } else {
                console.warn('[FILTERS] Skipping initialization because services failed to load.');
            }
        })
        .catch(error => {
            console.error('[FILTERS] Failed to load services before initialization:', error);
        });
    
    // Initialize search (can work immediately)
    initializeSearch();
});

// Initialize filter buttons
function initializeFilters() {
    filterButtons = document.querySelectorAll('[data-filter]');
    
    console.log('[FILTERS] Initializing with', filterButtons.length, 'buttons');
    
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            const filter = this.dataset.filter;
            const serviceCategories = document.querySelectorAll('.service-category');
            
            console.log('[FILTER] Clicked:', filter);
            console.log('[FILTER] Found categories:', serviceCategories.length);
            
            // Update active button
            filterButtons.forEach(btn => btn.classList.remove('active'));
            this.classList.add('active');
            
            // Filter categories
            serviceCategories.forEach(category => {
                if (filter === 'all') {
                    category.style.display = 'block';
                } else {
                    const categoryName = category.dataset.category;
                    console.log('[FILTER] Category:', categoryName, 'Filter:', filter, 'Match:', categoryName === filter);
                    if (categoryName === filter) {
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
    
    console.log('[FILTERS] Initialized successfully');
}

// Initialize search functionality
function initializeSearch() {
    const searchInput = document.getElementById('serviceSearch');
    
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase();
            const serviceCategories = document.querySelectorAll('.service-category');
            
            serviceCategories.forEach(category => {
                const categoryTitle = category.querySelector('.category-title')?.textContent.toLowerCase() || '';
                const rows = category.querySelectorAll('.service-row:not(.service-row-header)');
                let hasVisibleRow = false;
                
                rows.forEach(row => {
                    const serviceName = row.querySelector('strong')?.textContent.toLowerCase() || '';
                    const serviceDetails = row.querySelector('.service-details')?.textContent.toLowerCase() || '';
                    
                    if (serviceName.includes(searchTerm) || 
                        serviceDetails.includes(searchTerm) ||
                        categoryTitle.includes(searchTerm)) {
                        row.style.display = 'grid';
                        hasVisibleRow = true;
                    } else {
                        row.style.display = 'none';
                    }
                });
                
                if (hasVisibleRow || categoryTitle.includes(searchTerm)) {
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
}

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
    if (!container) {
        console.warn('[SERVICES] Container element not found.');
        return false;
    }
    
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
            return true;
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
                const minRaw = service.min_quantity ?? service.min_order;
                const maxRaw = service.max_quantity ?? service.max_order;
                const min = Number.isFinite(Number(minRaw)) ? Number(minRaw) : 10;
                const max = maxRaw === null || maxRaw === undefined
                    ? Infinity
                    : (Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : 10000);
                const publicId = Number(service.public_id ?? service.publicId);
                const labelId = Number.isFinite(publicId)
                    ? `#${publicId}`
                    : (service.provider_service_id ? `PID ${service.provider_service_id}` : 'ID');
                
                html += `
                    <div class="service-row" data-service-id="${service.id}">
                        <div class="service-col">
                            <strong>${labelId} · ${escapeHtml(service.name)}</strong>
                            <span class="service-details">${escapeHtml(service.description || 'No description available')}</span>
                        </div>
                        <div class="service-col price">$${pricePerK}</div>
                        <div class="service-col">${formatNumber(min)} / ${formatNumber(max)}</div>
                        <div class="service-col">
                            <button onclick="showServiceDescription('${service.id}', '${escapeHtml(`${labelId} · ${service.name}`).replace(/'/g, "\\'")}', '${escapeHtml(service.description || 'No description available').replace(/'/g, "\\'")}', '${pricePerK}', '${formatNumber(min)}', '${formatNumber(max)}')" class="btn btn-primary btn-sm">Description</button>
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
        
        // Return true to signal completion
    return true;
        
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
        
        // Return false to signal error
        return false;
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatNumber(num) {
    if (!isFinite(num)) {
        return '∞';
    }

    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
        return (num / 1000).toFixed(0) + 'K';
    }
    return num.toString();
}

// ==========================================
// Show Service Description Modal
// ==========================================

function showServiceDescription(serviceId, serviceName, description, rate, min, max) {
    // Create modal HTML
    const modalHTML = `
        <div id="serviceDescriptionModal" class="modal" style="display: flex !important; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 10000; backdrop-filter: blur(4px);">
            <div class="modal-content" style="background: white; border-radius: 16px; padding: 32px; max-width: 600px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); animation: modalSlideIn 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 24px;">
                    <h2 style="color: #1E293B; margin: 0; font-size: 24px; font-weight: 600;">${serviceName}</h2>
                    <button onclick="closeServiceDescription()" style="background: none; border: none; font-size: 28px; color: #64748B; cursor: pointer; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; transition: all 0.2s;" onmouseover="this.style.background='#F1F5F9'; this.style.color='#1E293B'" onmouseout="this.style.background='none'; this.style.color='#64748B'">&times;</button>
                </div>
                
                <div style="background: linear-gradient(135deg, #FF1494 0%, #FF6B35 100%); padding: 20px; border-radius: 12px; margin-bottom: 24px;">
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; text-align: center;">
                        <div>
                            <div style="color: rgba(255,255,255,0.9); font-size: 14px; margin-bottom: 4px;">Rate per 1000</div>
                            <div style="color: white; font-size: 24px; font-weight: 700;">$${rate}</div>
                        </div>
                        <div>
                            <div style="color: rgba(255,255,255,0.9); font-size: 14px; margin-bottom: 4px;">Minimum</div>
                            <div style="color: white; font-size: 24px; font-weight: 700;">${min}</div>
                        </div>
                        <div>
                            <div style="color: rgba(255,255,255,0.9); font-size: 14px; margin-bottom: 4px;">Maximum</div>
                            <div style="color: white; font-size: 24px; font-weight: 700;">${max}</div>
                        </div>
                    </div>
                </div>
                
                <div style="margin-bottom: 24px;">
                    <h3 style="color: #1E293B; font-size: 16px; font-weight: 600; margin-bottom: 12px;">Service Description</h3>
                    <p style="color: #475569; line-height: 1.6; margin: 0; white-space: pre-wrap;">${description}</p>
                </div>
                
                <div style="display: flex; gap: 12px;">
                    <a href="order.html?service=${serviceId}" class="btn btn-primary" style="flex: 1; text-align: center; padding: 12px; font-size: 16px; font-weight: 600; text-decoration: none; display: block;">Order Now</a>
                    <button onclick="closeServiceDescription()" class="btn btn-secondary" style="padding: 12px 24px; font-size: 16px; font-weight: 600;">Close</button>
                </div>
            </div>
        </div>
        
        <style>
            @keyframes modalSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(-20px) scale(0.95);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
        </style>
    `;
    
    // Append modal to body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Prevent body scroll
    document.body.style.overflow = 'hidden';
    
    // Close on background click
    document.getElementById('serviceDescriptionModal').addEventListener('click', function(e) {
        if (e.target.id === 'serviceDescriptionModal') {
            closeServiceDescription();
        }
    });
    
    // Close on Escape key
    document.addEventListener('keydown', function escapeHandler(e) {
        if (e.key === 'Escape') {
            closeServiceDescription();
            document.removeEventListener('keydown', escapeHandler);
        }
    });
}

function closeServiceDescription() {
    const modal = document.getElementById('serviceDescriptionModal');
    if (modal) {
        modal.style.animation = 'modalSlideOut 0.2s ease';
        setTimeout(() => {
            modal.remove();
            document.body.style.overflow = '';
        }, 200);
    }
}

// Add modal slide out animation
const modalStyle = document.createElement('style');
modalStyle.textContent = `
    @keyframes modalSlideOut {
        from {
            opacity: 1;
            transform: translateY(0) scale(1);
        }
        to {
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
        }
    }
`;
document.head.appendChild(modalStyle);
