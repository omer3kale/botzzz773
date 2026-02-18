// Instagram Bot Accounts - Netlify Function
// Connects to the Instagram Bot's Supabase (separate from SMM panel)
const { createClient } = require('@supabase/supabase-js');

const IG_SUPABASE_URL = process.env.IG_SUPABASE_URL;
const IG_SUPABASE_KEY = process.env.IG_SUPABASE_KEY;

let igSupabase = null;
function getClient() {
  if (!igSupabase) {
    if (!IG_SUPABASE_URL || !IG_SUPABASE_KEY) {
      throw new Error(`Missing env vars - IG_SUPABASE_URL: ${!!IG_SUPABASE_URL}, IG_SUPABASE_KEY: ${!!IG_SUPABASE_KEY}. Add them in Netlify Dashboard > Site Settings > Environment Variables.`);
    }
    igSupabase = createClient(IG_SUPABASE_URL, IG_SUPABASE_KEY);
  }
  return igSupabase;
}

// ─── Instagram profil kontrol fonksiyonu ───
// IG_SESSION_ID env variable gerekli (tarayıcıdan bir kere alınır, ~1 yıl geçerli)
async function checkInstagramProfile(username) {
  const sessionId = process.env.IG_SESSION_ID;

  // Session ile API çağrısı
  const headers = {
    'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)',
    'X-IG-App-ID': '936619743392459',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Dest': 'empty'
  };

  if (sessionId) {
    headers['Cookie'] = `sessionid=${sessionId}`;
  }

  try {
    console.log(`[IG-CHECK] Checking ${username}... (session: ${sessionId ? 'yes' : 'no'})`);
    const apiResp = await fetch(
      `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      { headers }
    );

    console.log(`[IG-CHECK] ${username}: status=${apiResp.status}`);

    if (apiResp.status === 404) return 'deleted';
    if (apiResp.ok) {
      const json = await apiResp.json();
      if (json?.data?.user?.username) return 'active';
      return 'deleted';
    }
    
    // 400 = SecFetch Policy violation, retry without Sec-Fetch headers
    if (apiResp.status === 400) {
      const errText = await apiResp.text();
      console.log(`[IG-CHECK] 400 error for ${username}: ${errText.substring(0, 100)}, retrying without Sec-Fetch`);
      const retryHeaders = {
        'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)',
        'X-IG-App-ID': '936619743392459'
      };
      if (sessionId) retryHeaders['Cookie'] = `sessionid=${sessionId}`;
      
      const retryResp = await fetch(
        `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
        { headers: retryHeaders }
      );
      console.log(`[IG-CHECK] Retry ${username}: status=${retryResp.status}`);
      if (retryResp.status === 404) return 'deleted';
      if (retryResp.ok) {
        const json = await retryResp.json();
        if (json?.data?.user?.username) return 'active';
        return 'deleted';
      }
      const retryBody = await retryResp.text();
      console.log(`[IG-CHECK] Retry failed for ${username}: ${retryBody.substring(0, 200)}`);
    }

    if (apiResp.status === 401 || apiResp.status === 429) {
      const body = await apiResp.text();
      console.log(`[IG-CHECK] Rate limited or session expired for ${username}: ${body.substring(0, 200)}`);
      return 'unknown';
    }
  } catch (e) {
    console.log(`[IG-CHECK] Error for ${username}: ${e.message}`);
  }

  return 'unknown';
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

      // ─── Canlı Kontrol: Tek hesap ───
      if (action === 'check_single') {
        const username = body.username;
        if (!username) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Username required' }) };
        }

        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        let ig_status = 'unknown';

        try {
          ig_status = await checkInstagramProfile(username);
        } catch (e) {
          console.error(`[IG-ACCOUNTS] Check error for ${username}:`, e.message);
          ig_status = 'error';
        }

        // Update DB
        await supabase.from('instagram_accounts').update({
          ig_status,
          ig_checked_at: now
        }).eq('username', username);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, username, ig_status, checked_at: now })
        };
      }

      // ─── Canlı Kontrol: Tüm hesaplar ───
      if (action === 'check_all') {
        const { data: accounts, error } = await supabase
          .from('instagram_accounts')
          .select('username')
          .order('created_at', { ascending: false });

        if (error) {
          return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to fetch accounts' }) };
        }

        const results = [];
        for (const acc of accounts) {
          const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
          let ig_status = 'unknown';

          try {
            ig_status = await checkInstagramProfile(acc.username);
          } catch (e) {
            ig_status = 'error';
          }

          await supabase.from('instagram_accounts').update({
            ig_status,
            ig_checked_at: now
          }).eq('username', acc.username);

          results.push({ username: acc.username, ig_status });

          // Rate limit - 2 saniye bekle
          await new Promise(r => setTimeout(r, 2000));
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            action: 'check_all',
            total_checked: results.length,
            results
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
