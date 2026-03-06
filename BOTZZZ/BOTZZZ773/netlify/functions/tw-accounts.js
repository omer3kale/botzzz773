// Twitter Bot Accounts - Netlify Function
// Connects to the Bot's Supabase (same DB as IG accounts)
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.IG_SUPABASE_URL;
const SUPABASE_KEY = process.env.IG_SUPABASE_KEY;

let supabase = null;
function getClient() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error(`Missing env vars - IG_SUPABASE_URL: ${!!SUPABASE_URL}, IG_SUPABASE_KEY: ${!!SUPABASE_KEY}`);
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return supabase;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, DELETE, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const db = getClient();

    // ─── GET: List all Twitter accounts ───
    if (event.httpMethod === 'GET') {
      const { data, error } = await db
        .from('twitter_accounts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[TW-ACCOUNTS] List error:', error);
        return {
          statusCode: 500, headers,
          body: JSON.stringify({ error: 'Failed to fetch accounts', details: error.message })
        };
      }

      const total = data.length;
      const pending = data.filter(a => !a.warmup_status || a.warmup_status === 'pending').length;
      const photo_done = data.filter(a => a.warmup_status === 'photo_done').length;
      const completed = data.filter(a => a.warmup_status === 'completed').length;
      const error_count = data.filter(a => a.warmup_status === 'error').length;

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          success: true,
          stats: { total, pending, photo_done, completed, error: error_count },
          accounts: data
        })
      };
    }

    // ─── DELETE: Remove a Twitter account ───
    if (event.httpMethod === 'DELETE') {
      const { username } = JSON.parse(event.body || '{}');
      if (!username) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Username required' }) };
      }

      const { error } = await db.from('twitter_accounts').delete().eq('username', username);
      if (error) {
        console.error('[TW-DELETE] Error:', error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, message: `${username} deleted` })
      };
    }

    // ─── POST: Fetch Twitter bio or cleanup deleted accounts ───
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const { username, action } = body;
      
      // ─── CLEANUP: Remove all accounts with status='deleted' ───
      if (action === 'cleanup') {
        const { data, error } = await db
          .from('twitter_accounts')
          .delete()
          .eq('status', 'deleted')
          .select();
        
        if (error) {
          console.error('[TW-CLEANUP] Error:', error);
          return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
        }
        
        return {
          statusCode: 200, headers,
          body: JSON.stringify({ success: true, deleted_count: data ? data.length : 0, message: 'Cleanup complete' })
        };
      }
      
      // ─── BIO FETCH: Get bio from fxtwitter (free, no auth) ───
      if (!username) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Username required' }) };
      }

      let bio = '';

      try {
        const res = await fetch(`https://api.fxtwitter.com/${username}`, {
          headers: { 'User-Agent': 'BotzzBot/1.0' }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.code === 200 && data.user) {
            bio = data.user.description || '';
          }
        } else if (res.status === 404) {
          bio = '[DELETED]';
        }
      } catch (e) {
        console.error('[TW-BIO] fxtwitter error:', e.message);
        return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch bio: ' + e.message }) };
      }

      // Only update bio - never touch last_tweet (that comes from xwarmup bot)
      const { error: updateErr } = await db
        .from('twitter_accounts')
        .update({ bio })
        .eq('username', username);

      if (updateErr) {
        console.error('[TW-UPDATE] Error:', updateErr);
        return { statusCode: 500, headers, body: JSON.stringify({ error: updateErr.message }) };
      }

      return {
        statusCode: 200, headers,
        body: JSON.stringify({ success: true, bio, message: 'Bio updated' })
      };
    }

    return {
      statusCode: 405, headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };

  } catch (err) {
    console.error('[TW-ACCOUNTS] Error:', err);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
