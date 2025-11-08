// Services API - Get, Create, Update, Delete Services
const { supabase, supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const JWT_SECRET = process.env.JWT_SECRET;

function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const user = getUserFromToken(event.headers.authorization);
  
  try {
    const body = JSON.parse(event.body || '{}');

    switch (event.httpMethod) {
      case 'GET':
        return await handleGetServices(user, headers);
      case 'POST':
        return await handleCreateService(user, body, headers);
      case 'PUT':
        return await handleUpdateService(user, body, headers);
      case 'DELETE':
        return await handleDeleteService(user, body, headers);
      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    console.error('Services API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleGetServices(user, headers) {
  try {
    const isAdmin = user && user.role === 'admin';
    const client = isAdmin ? supabaseAdmin : supabase;

    let query = client
      .from('services')
      .select(`
        *,
        provider:providers(id, name, status, markup)
      `);

    if (!isAdmin) {
      query = query.eq('status', 'active');
    }

    query = query.order('category', { ascending: true }).order('name', { ascending: true });

    const { data: services, error } = await query;
    if (error) {
      console.error('Get services error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch services' })
      };
    }

    // Ensure stable admin-matching site_id for every service.
    // If a service lacks a persisted public/site id, generate a deterministic one
    // (offset + DB id) and persist it using the admin client so admin & public match.
    const ID_OFFSET = 2230;
    const pendingUpdates = [];
    const servicesWithSiteId = await Promise.all(services.map(async service => {
      let site_id = service.public_id ?? service.publicId ?? service.site_id ?? null;
      if (!site_id) {
        const numericId = Number(service.id || 0);
        // fallback: use offset + db id to produce a stable, readable id
        site_id = String(ID_OFFSET + (Number.isFinite(numericId) ? numericId : Date.now()));
        // persist the generated id so future responses (and admin UI) match
        try {
          // use admin client to persist; don't block return if update fails, but log
          pendingUpdates.push(
            supabaseAdmin
              .from('services')
              .update({ public_id: site_id })
              .eq('id', service.id)
          );
        } catch (e) {
          console.error('Schedule persist site_id failed for service', service.id, e);
        }
      } else {
        site_id = String(site_id);
      }
      return { ...service, site_id };
    }));

    if (pendingUpdates.length) {
      try {
        const results = await Promise.all(pendingUpdates);
        results.forEach(r => { if (r && r.error) console.error('Persist site_id error:', r.error); });
      } catch (e) {
        console.error('Persist site_id bulk error:', e);
      }
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ services: servicesWithSiteId })
    };
  } catch (error) {
    console.error('Get services error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

// --- Diğer fonksiyonlar orijinal kodunla tamamen aynı kalıyor ---
async function handleCreateService(user, data, headers) {
  try {
    if (!user || user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { action } = data;

    if (action === 'create-category') {
      return await handleCreateCategory(data, headers);
    }

    if (action === 'duplicate') {
      return await handleDuplicateService(data, headers);
    }

    const {
      providerId,
      providerServiceId,
      name,
      category,
      description,
      rate,
      price,
      min_quantity,
      minOrder,
      max_quantity,
      maxOrder,
      type,
      status
    } = data;

    if (!name || !category) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    const servicePrice = rate || price || 0;
    const minQty = min_quantity || minOrder || 10;
    const maxQty = max_quantity || maxOrder || 100000;

    const { data: service, error } = await supabaseAdmin
      .from('services')
      .insert({
        provider_id: providerId || null,
        provider_service_id: providerServiceId || null,
        name,
        category,
        description: description || '',
        rate: servicePrice,
        min_quantity: minQty,
        max_quantity: maxQty,
        type: type || 'service',
        status: status || 'active'
      })
      .select()
      .single();

    if (error) {
      console.error('Create service error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to create service' })
      };
    }

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        service
      })
    };
  } catch (error) {
    console.error('Create service error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleUpdateService(user, data, headers) {
  try {
    if (!user || user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const {
      serviceId,
      name,
      category,
      rate,
      price,
      min_quantity,
      max_quantity,
      description,
      status,
      providerId,
      provider_id,
      providerServiceId,
      provider_service_id,
      ...updateData
    } = data;

    if (!serviceId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service ID is required' })
      };
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (rate !== undefined) updates.rate = rate;
    if (price !== undefined) updates.rate = price;
    if (min_quantity !== undefined) updates.min_quantity = min_quantity;
    if (max_quantity !== undefined) updates.max_quantity = max_quantity;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;

    const resolvedProviderId = providerId !== undefined ? providerId : provider_id;
    if (resolvedProviderId !== undefined) {
      updates.provider_id = resolvedProviderId || null;
    }

    const resolvedProviderServiceId = providerServiceId !== undefined ? providerServiceId : provider_service_id;
    if (resolvedProviderServiceId !== undefined) {
      updates.provider_service_id = resolvedProviderServiceId || null;
    }

    const { data: service, error } = await supabaseAdmin
      .from('services')
      .update(updates)
      .eq('id', serviceId)
      .select()
      .single();

    if (error) {
      console.error('Update service error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to update service' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        service
      })
    };
  } catch (error) {
    console.error('Update service error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleDeleteService(user, data, headers) {
  try {
    if (!user || user.role !== 'admin') {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({ error: 'Admin access required' })
      };
    }

    const { serviceId } = data;

    if (!serviceId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Service ID is required' })
      };
    }

    const { error } = await supabaseAdmin
      .from('services')
      .delete()
      .eq('id', serviceId);

    if (error) {
      console.error('Delete service error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to delete service' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true })
    };
  } catch (error) {
    console.error('Delete service error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleCreateCategory(data, headers) {
  try {
    const { name, description, icon } = data;
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        message: `Category "${name}" created successfully`,
        category: { name, description, icon }
      })
    };
  } catch (error) {
    console.error('Create category error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create category' })
    };
  }
}

async function handleDuplicateService(data, headers) {
  try {
    const { serviceId } = data;

    const { data: originalService, error: fetchError } = await supabaseAdmin
      .from('services')
      .select('*')
      .eq('id', serviceId)
      .single();

    if (fetchError || !originalService) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'Service not found' })
      };
    }

    const { data: newService, error: insertError } = await supabaseAdmin
      .from('services')
      .insert({
        provider_id: originalService.provider_id,
        provider_service_id: originalService.provider_service_id,
        name: `${originalService.name} (Copy)`,
        category: originalService.category,
        description: originalService.description,
        rate: originalService.rate,
        min_quantity: originalService.min_quantity,
        max_quantity: originalService.max_quantity,
        type: originalService.type,
        status: 'inactive'
      })
      .select()
      .single();

    if (insertError) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to duplicate service' })
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true,
        service: newService
      })
    };
  } catch (error) {
    console.error('Duplicate service error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to duplicate service' })
    };
  }
}

// --- FRONTEND ENTEGRASYONU: API’den servisleri çekip services.html’de listeleme ---
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const servicesContainer = document.getElementById('servicesContainer');
    if (!servicesContainer) return;

    fetch('/.netlify/functions/services', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
        // Token gerekiyorsa: 'Authorization': 'Bearer ' + localStorage.getItem('token')
      }
    })
      .then(res => res.json())
      .then(data => {
        if (!data.services) return;

        // Mevcut HTML’yi temizle
        servicesContainer.innerHTML = '';

        // Kategorilere göre grupla
        const categories = {};
        data.services.forEach(service => {
          const cat = service.category || 'Uncategorized';
          if (!categories[cat]) categories[cat] = [];
          categories[cat].push(service);
        });

        // HTML oluştur
        for (const [category, services] of Object.entries(categories)) {
          const categoryDiv = document.createElement('div');
          categoryDiv.classList.add('service-category');
          categoryDiv.dataset.category = category.toLowerCase();

          const categoryTitle = document.createElement('h2');
          categoryTitle.classList.add('category-title');
          categoryTitle.textContent = category;
          categoryDiv.appendChild(categoryTitle);

          services.forEach(service => {
            const serviceSub = document.createElement('div');
            serviceSub.classList.add('service-subcategory');

            const subTitle = document.createElement('h3');
            subTitle.classList.add('subcategory-title');
            subTitle.textContent = service.name;
            serviceSub.appendChild(subTitle);

            const table = document.createElement('div');
            table.classList.add('services-table');

            const row = document.createElement('div');
            row.classList.add('service-row');

            row.innerHTML = `
              <div class="service-col">
                <strong>${service.name}</strong>
                <span class="service-details">${service.description || ''}</span>
              </div>
              <div class="service-col price">$${service.rate}</div>
              <div class="service-col">${service.min_quantity} / ${service.max_quantity}</div>
              <div class="service-col">
                <a href="order.html?service=${encodeURIComponent(service.name)}" class="btn btn-primary btn-sm">Order</a>
              </div>
            `;

            table.appendChild(row);
            serviceSub.appendChild(table);
            categoryDiv.appendChild(serviceSub);
          });

          servicesContainer.appendChild(categoryDiv);
        }
      })
      .catch(err => console.error('Failed to load services:', err));

    // Sample fetch for services API
    fetch('/.netlify/functions/services')
      .then(r => r.json())
      .then(d => console.log('services api sample', d.services && d.services.slice(0,5)))
      .catch(err => console.error('Sample fetch error:', err));
  });
}

