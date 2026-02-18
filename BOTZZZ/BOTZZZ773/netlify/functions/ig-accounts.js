// Instagram Bot Accounts - Netlify Function
// Connects to the Instagram Bot's Supabase (separate from SMM panel)
const { createClient } = require('@supabase/supabase-js');

const IG_SUPABASE_URL = process.env.IG_SUPABASE_URL;
const IG_SUPABASE_KEY = process.env.IG_SUPABASE_KEY;

let igSupabase = null;
function getClient() {
  if (!igSupabase) {
    if (!IG_SUPABASE_URL || !IG_SUPABASE_KEY) {
      throw new Error('Missing IG_SUPABASE_URL or IG_SUPABASE_KEY environment variables');
    }
    igSupabase = createClient(IG_SUPABASE_URL, IG_SUPABASE_KEY);
  }
  return igSupabase;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  };

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const supabase = getClient();

    // ─── GET: Tüm hesapları listele ───
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('instagram_accounts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[IG-ACCOUNTS] List error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to fetch accounts', details: error.message })
        };
      }

      // İstatistikler
      const total = data.length;
      const active = data.filter(a => a.ig_status === 'active').length;
      const deleted = data.filter(a => a.ig_status === 'deleted').length;
      const unknown = data.filter(a => !a.ig_status || a.ig_status === 'unknown' || a.ig_status === 'error').length;

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          stats: { total, active, deleted, unknown },
          accounts: data
        })
      };
    }

    // ─── DELETE: Hesap sil (username ile) ───
    if (event.httpMethod === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const username = body.username;

      if (!username) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Username is required' })
        };
      }

      const { error } = await supabase
        .from('instagram_accounts')
        .delete()
        .eq('username', username);

      if (error) {
        console.error('[IG-ACCOUNTS] Delete error:', error);
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'Failed to delete account', details: error.message })
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true, deleted: username })
      };
    }

    // ─── POST: Toplu işlemler ───
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const action = body.action;

      // Tüm deleted hesapları sil
      if (action === 'cleanup') {
        const { data, error } = await supabase
          .from('instagram_accounts')
          .delete()
          .eq('ig_status', 'deleted')
          .select();

        if (error) {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Cleanup failed', details: error.message })
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            action: 'cleanup',
            deleted_count: data ? data.length : 0
          })
        };
      }

      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Unknown action' })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (err) {
    console.error('[IG-ACCOUNTS] Error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
