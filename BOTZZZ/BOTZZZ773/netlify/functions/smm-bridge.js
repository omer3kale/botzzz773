/**
 * SMM Bridge — Netlify Function
 *
 * Replaces the local smm_bridge.py + ngrok setup.
 * Acts as an SMM panel provider API (action=add/status/services)
 * and a config endpoint for the dashboard (/config/services).
 *
 * Panel provider URL: https://www.botzzz773.pro/smm-bridge
 *
 * NOTE: Uses the BOT Supabase (IG_SUPABASE_URL / IG_SUPABASE_KEY),
 *       NOT the main panel Supabase (SUPABASE_URL).
 */

const { createClient } = require('@supabase/supabase-js');

// Bot Supabase — same DB as smm_orders table & config storage bucket
const IG_SUPABASE_URL = process.env.IG_SUPABASE_URL;
const IG_SUPABASE_KEY = process.env.IG_SUPABASE_KEY;

let supabaseAdmin = null;
function getClient() {
  if (!supabaseAdmin) {
    if (!IG_SUPABASE_URL || !IG_SUPABASE_KEY) {
      throw new Error(`Missing env vars - IG_SUPABASE_URL: ${!!IG_SUPABASE_URL}, IG_SUPABASE_KEY: ${!!IG_SUPABASE_KEY}`);
    }
    supabaseAdmin = createClient(IG_SUPABASE_URL, IG_SUPABASE_KEY);
  }
  return supabaseAdmin;
}

// ── CONFIG ──
const API_KEY = process.env.SMM_BRIDGE_API_KEY || 'BOTZZZ773_SECRET_KEY';
const STORAGE_BUCKET = 'config';
const SERVICES_FILE = 'services.json';

// ── STATUS MAP ──
const STATUS_MAP = {
  pending: 'Pending',
  'in progress': 'In progress',
  paused: 'In progress',
  completed: 'Completed',
  partial: 'Partial',
  canceled: 'Canceled',
  error: 'Canceled',
};

// ── HELPERS ──
const json = (statusCode, body, cors = false) => {
  const headers = { 'Content-Type': 'application/json' };
  if (cors) {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return { statusCode, headers, body: JSON.stringify(body) };
};

async function loadServicesDict() {
  try {
    const url = `${IG_SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${SERVICES_FILE}`;
    const res = await fetch(url, {
      headers: {
        apikey: IG_SUPABASE_KEY,
        Authorization: `Bearer ${IG_SUPABASE_KEY}`,
      },
    });
    if (!res.ok) {
      console.error('[SMM-BRIDGE] Storage fetch error:', res.status);
      return {};
    }
    const text = await res.text();
    return JSON.parse(text);
  } catch (e) {
    console.error('[SMM-BRIDGE] loadServicesDict error:', e.message);
    return {};
  }
}

async function loadServicesList() {
  const dict = await loadServicesDict();
  return Object.entries(dict).map(([sid, s]) => ({
    service: sid,
    name: s.name || '',
    type: s.type || 'Default',
    category: s.category || '',
    rate: String(s.rate || '0'),
    min: String(s.min || 1),
    max: String(s.max || 100),
    refill: s.refill || false,
    cancel: s.cancel || false,
  }));
}

async function saveServicesDict(dict) {
  const body = JSON.stringify(dict, null, 2);
  const url = `${IG_SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${SERVICES_FILE}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: IG_SUPABASE_KEY,
      Authorization: `Bearer ${IG_SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Storage save failed (${res.status}): ${text}`);
  }
}

// ── ACTIONS ──
async function handleServices() {
  const services = await loadServicesList();
  return json(200, services);
}

async function handleAdd(params) {
  const service = params.service;
  const link = params.link;
  const quantity = params.quantity;

  if (!service || !link || !quantity) {
    return json(200, { error: 'Missing: service, link, quantity' });
  }

  const qty = parseInt(quantity, 10);
  if (isNaN(qty) || qty < 1) {
    return json(200, { error: 'quantity must be a positive integer' });
  }

  const now = new Date().toISOString();
  const { data, error } = await getClient()
    .from('smm_orders')
    .insert({
      service: String(service),
      link,
      quantity: qty,
      completed: 0,
      status: 'pending',
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single();

  if (error || !data) {
    console.error('[SMM-BRIDGE] Insert error:', error?.message);
    return json(200, { error: 'Database insert failed' });
  }

  console.log(`[SMM-BRIDGE] ADD order=${data.id} service=${service} qty=${qty} link=${link}`);
  return json(200, { order: data.id });
}

async function handleStatus(params) {
  const orderId = params.order;
  if (!orderId) {
    return json(200, { error: 'Missing: order' });
  }

  const { data, error } = await getClient()
    .from('smm_orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (error || !data) {
    return json(200, { error: 'Order not found' });
  }

  const quantity = data.quantity || 0;
  const completed = data.completed || 0;
  const status = data.status || 'pending';
  const startCount = data.start_count;
  let remains = data.remains;
  if (remains == null) remains = Math.max(0, quantity - completed);

  return json(200, {
    charge: '0',
    start_count: String(startCount != null ? startCount : 0),
    status: STATUS_MAP[status] || status,
    remains: String(remains),
    currency: 'USD',
  });
}

// ── MAIN HANDLER ──
exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return json(204, '', true);
  }

  // ── GET /config/services (dashboard reads services) ──
  if (event.httpMethod === 'GET') {
    const dict = await loadServicesDict();
    return json(200, dict, true);
  }

  // ── POST ──
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body = event.body || '';
  if (event.isBase64Encoded) {
    body = Buffer.from(body, 'base64').toString('utf-8');
  }

  // Detect content type
  const ct = (event.headers['content-type'] || '').toLowerCase();

  // ── JSON body → config endpoints ──
  if (ct.includes('application/json')) {
    try {
      const data = JSON.parse(body);

      // Dashboard saving services config (must have _saveConfig marker)
      if (data && typeof data === 'object' && data._saveConfig === true) {
        delete data._saveConfig;
        if (Object.keys(data).length === 0) {
          return json(200, { error: 'Empty services config, not saving' }, true);
        }
        await saveServicesDict(data);
        console.log(`[SMM-BRIDGE] Services config updated: ${Object.keys(data).join(', ')}`);
        return json(200, { ok: true }, true);
      }
    } catch (e) {
      return json(200, { error: 'Invalid JSON: ' + e.message }, true);
    }
  }

  // ── Form-encoded body → SMM panel API ──
  const params = {};
  if (ct.includes('json')) {
    try { Object.assign(params, JSON.parse(body)); } catch {}
  } else {
    const { URLSearchParams } = require('url');
    const sp = new URLSearchParams(body);
    for (const [k, v] of sp) params[k] = v;
  }

  // API key check
  if (params.key !== API_KEY) {
    return json(200, { error: 'Invalid API key' });
  }

  const action = params.action;
  switch (action) {
    case 'services':
      return handleServices();
    case 'add':
      return handleAdd(params);
    case 'status':
      return handleStatus(params);
    default:
      return json(200, { error: `Unknown action: ${action}` });
  }
};
