// Data Backup API - Create and list compressed snapshots
const { supabaseAdmin } = require('./utils/supabase');
const { withRateLimit } = require('./utils/rate-limit');
const { createLogger, serializeError } = require('./utils/logger');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const zlib = require('zlib');

const JWT_SECRET = process.env.JWT_SECRET;
const DEFAULT_SCOPE = ['users', 'orders', 'payments'];
const DEFAULT_EXPIRY_DAYS = 30;
const logger = createLogger('backups');

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

async function fetchAllRows(table, columns = '*', chunk = 1000) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(columns)
      .range(from, from + chunk - 1);

    if (error) {
      throw error;
    }

    rows.push(...(data || []));
    if (!data || data.length < chunk) {
      break;
    }
    from += chunk;
  }
  return rows;
}

async function collectSnapshot(scopes = DEFAULT_SCOPE) {
  const datasetFetchers = {
    users: () => fetchAllRows('users', 'id,email,username,role,balance,status,created_at,updated_at'),
    orders: () => fetchAllRows('orders', 'id,user_id,service_id,status,quantity,link,charge,currency,created_at,updated_at'),
    payments: () => fetchAllRows('payments', 'id,user_id,amount,status,method,transaction_id,created_at,updated_at')
  };

  const payload = { generatedAt: new Date().toISOString(), datasets: {} };
  const recordCounts = {};

  for (const scope of scopes) {
    if (!datasetFetchers[scope]) {
      continue;
    }
    const data = await datasetFetchers[scope]();
    payload.datasets[scope] = data;
    recordCounts[scope] = data.length;
  }

  return { payload, recordCounts };
}

function compressPayload(payload) {
  const serialized = JSON.stringify(payload);
  const compressed = zlib.gzipSync(serialized);
  const checksum = crypto.createHash('sha256').update(compressed).digest('hex');
  return {
    base64: compressed.toString('base64'),
    size: compressed.length,
    checksum
  };
}

async function handleCreateBackup(user, body, headers) {
  if (user?.role !== 'admin') {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Only admins can create backups' })
    };
  }

  const scopes = Array.isArray(body?.scopes) && body.scopes.length ? body.scopes : DEFAULT_SCOPE;
  const label = body?.label || `snapshot-${new Date().toISOString()}`;
  const expiresInDays = Number.isFinite(body?.expiresInDays) ? Math.max(1, body.expiresInDays) : DEFAULT_EXPIRY_DAYS;
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

  logger.info('Starting backup snapshot', { label, scopes, expiresAt });
  const startedAt = Date.now();

  try {
    const { payload, recordCounts } = await collectSnapshot(scopes);
    const compressed = compressPayload(payload);

    const insertPayload = {
      snapshot_label: label,
      scope: scopes,
      compression: 'gzip+base64',
      checksum: compressed.checksum,
      payload: compressed.base64,
      payload_size_bytes: compressed.size,
      record_counts: recordCounts,
      created_by: user.userId || null,
      expires_at: expiresAt,
      meta: {
        durationMs: Date.now() - startedAt,
        formatVersion: '1.0.0'
      }
    };

    const { data, error } = await supabaseAdmin
      .from('data_backups')
      .insert(insertPayload)
      .select('*')
      .single();

    if (error) {
      throw error;
    }

    logger.info('Backup snapshot completed', { label, id: data.id, durationMs: insertPayload.meta.durationMs });

    return {
      statusCode: 201,
      headers,
      body: JSON.stringify({
        success: true,
        backup: {
          id: data.id,
          label: data.snapshot_label,
          scopes: data.scope,
          checksum: data.checksum,
          payloadSizeBytes: data.payload_size_bytes,
          recordCounts: data.record_counts,
          expiresAt: data.expires_at,
          createdAt: data.created_at
        }
      })
    };
  } catch (error) {
    logger.error('Failed to create backup snapshot', { error: serializeError(error) });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create backup snapshot' })
    };
  }
}

function decodePayload(record) {
  try {
    const buffer = Buffer.from(record.payload, 'base64');
    const json = zlib.gunzipSync(buffer).toString('utf-8');
    return JSON.parse(json);
  } catch (error) {
    logger.error('Failed to decode backup payload', { error: serializeError(error), id: record.id });
    return null;
  }
}

async function handleListBackups(user, query, headers) {
  if (user?.role !== 'admin') {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({ error: 'Only admins can access backups' })
    };
  }

  const selectPayload = query?.id
    ? '*'
    : 'id,snapshot_label,scope,compression,payload_size_bytes,checksum,record_counts,status,created_at,expires_at,meta';

  const request = supabaseAdmin
    .from('data_backups')
    .select(selectPayload)
    .order('created_at', { ascending: false })
    .limit(query?.limit ? Number(query.limit) : 20);

  if (query?.id) {
    request.eq('id', query.id);
  }

  const { data, error } = await request;

  if (error) {
    logger.error('Failed to fetch backups', { error: serializeError(error) });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch backups' })
    };
  }

  let responseData = data;
  if (query?.id && query?.includePayload === 'true' && data?.length) {
    responseData = data.map((record) => ({
      ...record,
      snapshot: decodePayload(record)
    }));
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      backups: responseData
    })
  };
}

const baseHandler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const user = getUserFromToken(event.headers.authorization || event.headers.Authorization);
  if (!user) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    if (event.httpMethod === 'GET') {
      return await handleListBackups(user, event.queryStringParameters || {}, headers);
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      return await handleCreateBackup(user, body, headers);
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  } catch (error) {
    logger.error('Backups handler failure', { error: serializeError(error) });
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Unexpected backup error' })
    };
  }
};

const BACKUP_RATE_LIMIT = {
  route: 'backups',
  limit: 10,
  windowSeconds: 3600
};

exports.handler = withRateLimit(BACKUP_RATE_LIMIT, baseHandler);
