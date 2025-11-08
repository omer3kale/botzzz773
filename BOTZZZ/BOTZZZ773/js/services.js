// Services API - Get, Create, Update, Delete Services
const { supabase, supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const JWT_SECRET = process.env.JWT_SECRET;

function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
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

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

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
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
  } catch (error) {
    console.error('Services API error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};

async function handleGetServices(user, headers) {
  try {
    const isAdmin = user && user.role === 'admin';
    const client = isAdmin ? supabaseAdmin : supabase;

    let query = client
      .from('services')
      .select(`*, provider:providers(id, name, status, markup)`);

    if (!isAdmin) query = query.eq('status', 'active');
    query = query.order('category', { ascending: true }).order('name', { ascending: true });

    const { data: services, error } = await query;
    if (error) throw error;

    // 🔹 Site özel ID ekliyoruz
    const startingId = 2231;
    const servicesWithCustomId = services.map((service, index) => ({
      ...service,
      site_id: startingId + index
    }));

    return { statusCode: 200, headers, body: JSON.stringify({ services: servicesWithCustomId }) };
  } catch (error) {
    console.error('Get services error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch services' }) };
  }
}

// ----------------- CREATE / UPDATE / DELETE (Admin Only) -----------------
async function handleCreateService(user, data, headers) {
  if (!user || user.role !== 'admin')
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };

  try {
    const { providerId, providerServiceId, name, category, description, rate, price, min_quantity, max_quantity, type, status } = data;

    if (!name || !category)
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };

    const servicePrice = rate || price || 0;
    const minQty = min_quantity || 10;
    const maxQty = max_quantity || 100000;

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

    if (error) throw error;

    return { statusCode: 201, headers, body: JSON.stringify({ success: true, service }) };
  } catch (error) {
    console.error('Create service error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

async function handleUpdateService(user, data, headers) {
  if (!user || user.role !== 'admin')
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };

  try {
    const { serviceId, name, category, rate, price, min_quantity, max_quantity, description, status } = data;
    if (!serviceId)
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Service ID is required' }) };

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (category !== undefined) updates.category = category;
    if (rate !== undefined) updates.rate = rate;
    if (price !== undefined) updates.rate = price;
    if (min_quantity !== undefined) updates.min_quantity = min_quantity;
    if (max_quantity !== undefined) updates.max_quantity = max_quantity;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;

    const { data: service, error } = await supabaseAdmin
      .from('services')
      .update(updates)
      .eq('id', serviceId)
      .select()
      .single();

    if (error) throw error;
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, service }) };
  } catch (error) {
    console.error('Update service error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

async function handleDeleteService(user, data, headers) {
  if (!user || user.role !== 'admin')
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin access required' }) };

  try {
    const { serviceId } = data;
    if (!serviceId)
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Service ID is required' }) };

    const { error } = await supabaseAdmin.from('services').delete().eq('id', serviceId);
    if (error) throw error;

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error('Delete service error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) };
  }
}

// ----------------- FRONTEND SERVICE RENDERING -----------------
if (typeof window !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('servicesContainer');
    if (!container) return;

    try {
      const res = await fetch('/.netlify/functions/services');
      const json = await res.json();
      const services = json.services || [];

      if (!services.length) {
        container.innerHTML = '<p>No services available.</p>';
        return;
      }

      // Tabloyu oluştur
      const table = document.createElement('table');
      table.classList.add('services-table');
      table.innerHTML = `
        <thead>
          <tr>
            <th>Service ID</th>
            <th>Name</th>
            <th>Rate</th>
            <th>Per</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = table.querySelector('tbody');

      services.forEach(s => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>#${s.site_id}</td>
          <td>${s.name}</td>
          <td>${s.rate}</td>
          <td>${s.per || ''}</td>
        `;
        tbody.appendChild(row);
      });

      container.appendChild(table);
    } catch (error) {
      console.error('Frontend fetch services error:', error);
      container.innerHTML = '<p>Failed to load services.</p>';
    }
  });
}
