// ==========================================
// Load Services from API (compatible with api-client.js)
// ==========================================
async function loadServicesFromAPI() {
    const container = document.getElementById('servicesContainer');

    try {
        // Loading spinner
        container.innerHTML = `
            <div class="loading-spinner" style="text-align:center; padding:60px;">
                <div style="display:inline-block; width:50px; height:50px; border:4px solid rgba(255,20,148,0.2); border-top-color:#FF1494; border-radius:50%; animation:spin 1s linear infinite;"></div>
                <p style="margin-top:20px; color:#94A3B8;">Loading services...</p>
            </div>
        `;

        // ✅ Senin sistemdeki çağrı — api-client.js'den geliyor
        const data = await fetchServices();
        const services = data?.services || [];

        if (!Array.isArray(services) || services.length === 0) {
            container.innerHTML = '<p style="text-align:center; padding:80px;">No services available</p>';
            return;
        }

        // 🔢 Özel site ID sayacı
        let globalServiceCounter = 0;
        const START_SITE_ID = 2231;

        // Gruplama
        const grouped = {};
        services.forEach(service => {
            const category = (service.category || 'Other').toLowerCase();
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(service);
        });

        let html = '';
        const categoryIcons = {
            instagram: '📱',
            tiktok: '🎵',
            youtube: '▶️',
            twitter: '🐦',
            facebook: '👥',
            telegram: '💬',
            spotify: '🎧',
            soundcloud: '🎶',
            other: '⭐'
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
                const rate = parseFloat(service.rate || 0).toFixed(2);
                const minRaw = service.min_quantity ?? service.min_order;
                const maxRaw = service.max_quantity ?? service.max_order;
                const min = Number.isFinite(Number(minRaw)) ? Number(minRaw) : 10;
                const max = maxRaw == null ? '∞' : (Number.isFinite(Number(maxRaw)) ? Number(maxRaw) : 10000);

                // 🔒 Gerçek public_id'yi kullanmıyoruz, sadece site ID
                const labelId = START_SITE_ID + globalServiceCounter;
                globalServiceCounter++;

                html += `
                    <div class="service-row" data-service-id="${service.id}">
                        <div class="service-col">
                            <strong>${labelId} · ${escapeHtml(service.name)}</strong>
                            <span class="service-details">${escapeHtml(service.description || 'No description available')}</span>
                        </div>
                        <div class="service-col price">$${rate}</div>
                        <div class="service-col">${min} / ${max}</div>
                        <div class="service-col">
                            <button onclick="showServiceDescription(
                                '${service.id}',
                                '${escapeHtml(`${labelId} · ${service.name}`).replace(/'/g, "\\'")}',
                                '${escapeHtml(service.description || 'No description available').replace(/'/g, "\\'")}',
                                '${rate}',
                                '${min}',
                                '${max}'
                            )" class="btn btn-primary btn-sm">Description</button>
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
        console.log('[SUCCESS] Services loaded (via api-client.js)');

    } catch (error) {
        console.error('[ERROR] Failed to load services:', error);
        container.innerHTML = `<p style="text-align:center; padding:80px;">Failed to load services: ${error.message}</p>`;
    }
}


