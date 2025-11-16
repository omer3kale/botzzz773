// Settings API - Manage Site Settings
const { supabase, supabaseAdmin } = require('./utils/supabase');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const ACTION_KEY_MAP = {
  'update-general': 'general',
  'update-payment': 'payment',
  'update-notification': 'notification',
  'update-bonus': 'bonus',
  'update-signup': 'signup',
  'update-ticket': 'ticket',
  'update-modules': 'modules',
  'update-integrations': 'integrations'
};

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
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const user = getUserFromToken(event.headers.authorization);
  if (!user || user.role !== 'admin') {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Admin access required' })
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    switch (event.httpMethod) {
      case 'GET':
        return await handleGetSettings(headers);
      case 'PUT':
        return await handleUpdateSettings(body, headers);
      case 'POST':
        return await handleActionUpdate(body, headers);
      default:
        return {
          statusCode: 405,
          headers,
          body: JSON.stringify({ error: 'Method not allowed' })
        };
    }
  } catch (error) {
    console.error('Settings API error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

async function handleGetSettings(headers) {
  try {
    const { data: settings, error } = await supabaseAdmin
      .from('settings')
      .select('*')
      .order('key', { ascending: true });

    if (error) {
      console.error('Get settings error:', error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'Failed to fetch settings' })
      };
    }

    // Convert array to object for easier access
    const settingsObj = {};
    settings.forEach(setting => {
      settingsObj[setting.key] = normalizeSettingValue(setting.value);
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ settings: settingsObj })
    };
  } catch (error) {
    console.error('Get settings error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleUpdateSettings(data, headers) {
  try {
    const { key, value } = data;

    if (!key) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Setting key is required' })
      };
    }

    const setting = await upsertSettingRecord(key, value);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        setting
      })
    };
  } catch (error) {
    console.error('Update setting error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
}

async function handleActionUpdate(body, headers) {
  const { action, settings } = body || {};
  const key = ACTION_KEY_MAP[action];

  if (!key) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Unknown settings action' })
    };
  }

  if (!settings || typeof settings !== 'object') {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Settings payload must be an object' })
    };
  }

  try {
    const setting = await upsertSettingRecord(key, settings);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, setting })
    };
  } catch (error) {
    console.error('Action update error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to update settings' })
    };
  }
}

async function upsertSettingRecord(key, value) {
  const { data: setting, error } = await supabaseAdmin
    .from('settings')
    .upsert({
      key,
      value
    }, {
      onConflict: 'key'
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return setting;
}

function normalizeSettingValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch (error) {
        return value;
      }
    }
  }

  return value;
}
