// Public API v2 - Standard SMM Panel API Format
// Supports external integrations using API keys
const { supabaseAdmin } = require('./utils/supabase');
const { hashApiKey, extractKeyPrefix, safeCompareHash } = require('./utils/apiKeys');

// Verify API key and get user
async function getUserFromApiKey(apiKey) {
  if (!apiKey) {
    console.warn('[API v2] getUserFromApiKey called without apiKey');
    return null;
  }
  
  if (!apiKey.startsWith('sk_')) {
    console.warn('[API v2] Invalid API key format (must start with sk_):', { 
      keyPrefix: apiKey.substring(0, 6),
      length: apiKey.length 
    });
    return null;
  }

  try {
    const prefix = extractKeyPrefix(apiKey);
    const hashed = hashApiKey(apiKey);

    let candidates = [];

    if (prefix) {
      const { data: prefixMatches, error: prefixError } = await supabaseAdmin
        .from('api_keys')
        .select('id, key_hash, key_prefix, key, user:users(id, email, role, balance, status)')
        .eq('key_prefix', prefix)
        .eq('status', 'active');

      if (prefixError) {
        console.error('API key prefix lookup error:', prefixError);
        return null;
      }

      if (prefixMatches && prefixMatches.length) {
        candidates = prefixMatches;
      }
    }

    if (!candidates.length) {
      const { data: legacyMatches, error: legacyError } = await supabaseAdmin
        .from('api_keys')
        .select('id, key_hash, key_prefix, key, user:users(id, email, role, balance, status)')
        .eq('key', apiKey)
        .eq('status', 'active');

      if (legacyError) {
        console.error('API key legacy lookup error:', legacyError);
        return null;
      }

      if (legacyMatches && legacyMatches.length) {
        candidates = legacyMatches;
      }
    }

    if (!candidates.length) {
      console.warn('[API v2] No API key candidates found in database:', { 
        prefix: prefix || 'none',
        keyPrefix: apiKey.substring(0, 12) + '...',
        keyLength: apiKey.length
      });
      return null;
    }

    let matchingKey = candidates.find(candidate => {
      if (candidate.key_hash && safeCompareHash(hashed, candidate.key_hash)) {
        return true;
      }

      if (candidate.key && candidate.key === apiKey) {
        return true;
      }

      return false;
    });

    if (!matchingKey) {
      const { data: legacyMatches, error: legacyError } = await supabaseAdmin
        .from('api_keys')
        .select('id, key_hash, key_prefix, key, user:users(id, email, role, balance, status)')
        .eq('key', apiKey)
        .eq('status', 'active');

      if (legacyError) {
        console.error('API key legacy fallback error:', legacyError);
        return null;
      }

      if (legacyMatches && legacyMatches.length) {
        matchingKey = legacyMatches.find(candidate => candidate.key === apiKey);

        if (!matchingKey) {
          matchingKey = legacyMatches.find(candidate => candidate.key_hash && safeCompareHash(hashed, candidate.key_hash));
        }
      }
    }

    if (!matchingKey || !matchingKey.user) {
      console.warn('[API v2] API key found but no matching user:', {
        hasMatchingKey: !!matchingKey,
        hasUser: matchingKey ? !!matchingKey.user : false,
        keyPrefix: apiKey.substring(0, 12) + '...'
      });
      return null;
    }

    // Update last_used timestamp
    await supabaseAdmin
      .from('api_keys')
      .update({ last_used: new Date().toISOString() })
      .eq('id', matchingKey.id);

    return matchingKey.user;
  } catch (error) {
    console.error('API key verification error:', error);
    return null;
  }
}

// Simple in-memory rate limiter (resets on function cold start)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 120; // 120 requests per minute (2 per second average)

// Fallback in-memory rate limiting (for backwards compatibility during DB issues)
function checkRateLimit(userId) {
  const now = Date.now();
  const userLimit = rateLimitMap.get(userId) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  
  // Reset if window expired
  if (now > userLimit.resetAt) {
    userLimit.count = 0;
    userLimit.resetAt = now + RATE_LIMIT_WINDOW;
  }
  
  userLimit.count++;
  rateLimitMap.set(userId, userLimit);
  
  return userLimit.count <= MAX_REQUESTS_PER_WINDOW;
}

// Persistent rate limiting using Supabase
async function checkRateLimitPersistent(userId, isPublicAccess = false) {
  const now = new Date();
  const oneMinuteAgo = new Date(now - 60000); // 1 minute ago

  // Separate limits: authenticated = 120/min, public discovery = 30/min
  const limit = isPublicAccess ? 30 : 120;

  try {
    // Get request count from database for last minute
    const { data: requests, error: queryError } = await supabaseAdmin
      .from('rate_limit_log')
      .select('id')
      .eq('user_id', userId)
      .gte('created_at', oneMinuteAgo.toISOString());

    if (queryError) {
      console.error('[API v2] Rate limit check failed:', queryError);
      // Fall back to in-memory check if DB is down
      return checkRateLimit(userId);
    }

    const requestCount = requests ? requests.length : 0;

    // Log this request asynchronously (don't wait for it)
    supabaseAdmin
      .from('rate_limit_log')
      .insert({ user_id: userId, created_at: now.toISOString() })
      .catch(err => console.error('[API v2] Failed to log rate limit:', err));

    // Check if limit exceeded (separate limits for public vs authenticated)
    if (requestCount >= limit) {
      console.warn(`[API v2] Rate limit exceeded: user=${userId}, requests=${requestCount}, limit=${limit}, type=${isPublicAccess ? 'public' : 'authenticated'}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[API v2] Rate limit check error:', error);
    // Fall back to in-memory check on error
    return checkRateLimit(userId);
  }
}

// Comprehensive audit logging
async function auditLog(userId, eventType, details, severity = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = {
    user_id: userId || null,
    event_type: eventType,
    details: JSON.stringify(details),
    severity: severity, // 'info', 'warning', 'critical'
    created_at: timestamp
  };

  try {
    // Log to database asynchronously (don't block request)
    supabaseAdmin
      .from('audit_log')
      .insert([logEntry])
      .catch(err => console.error('[API v2] Audit log insert failed:', err));
  } catch (error) {
    console.error('[API v2] Audit log error:', error);
  }

  // Also log to stdout for serverless log aggregation
  const logLevel = severity === 'critical' ? 'error' : severity === 'warning' ? 'warn' : 'log';
  console[logLevel](`[AUDIT] ${timestamp} | user=${userId} | type=${eventType} |`, details);
}

exports.handler = async (event) => {
  // Generate correlation ID for request tracing
  const reqId = `req_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`;
  
  // Normalize request headers to lowercase for case-insensitive access
  const reqHeaders = Object.fromEntries(
    Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v])
  );

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, HEAD',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod === 'HEAD') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Enforce request size limit (10KB max)
  const bodyLength = (event.body || '').length;
  const MAX_BODY_SIZE = 10240; // 10KB
  if (bodyLength > MAX_BODY_SIZE) {
    console.warn(`[API v2] Request body exceeds size limit: ${bodyLength} bytes`);
    return {
      statusCode: 413,
      headers,
      body: JSON.stringify({ error: 'Request body too large. Maximum 10KB allowed.' })
    };
  }

  try {
    let params;
    
    if (event.httpMethod === 'GET') {
      // Allow basic GET usage for provider connectivity checks (some panels ping with GET)
      const qs = event.queryStringParameters || {};
      const { action, key } = qs;

      // If panel/script probes with action/key, keep pure JSON responses
      if (action || key) {
        params = qs;
        console.log(`[API v2][${reqId}] GET request:`, { action: params.action, hasKey: !!params.key });
      } else {
        // Check if headless client requesting JSON (no HTML)
        const acceptHeader = reqHeaders['accept'] || '';
        if (acceptHeader.includes('application/json')) {
          // Return empty services list for JSON-only clients
          params = { action: 'services' };
          console.log(`[API v2][${reqId}] GET request with JSON Accept header, returning services`);
        } else {
          // Human browsing: return friendly HTML instead of raw JSON
          return {
          statusCode: 200,
          headers: {
            ...headers,
            'Content-Type': 'text/html; charset=utf-8'
          },
          body: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BOTZZZ773 API v2 - SMM Panel Integration</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif; background: #0a0a0a; color: #e2e8f0; line-height: 1.6; }
        .container { max-width: 900px; margin: 0 auto; padding: 40px 20px; }
        h1 { background: linear-gradient(135deg, #ff1494 0%, #00ff7f 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; font-size: 2.5em; margin-bottom: 10px; }
        h2 { color: #ff1494; margin-top: 40px; margin-bottom: 15px; font-size: 1.5em; }
        h3 { color: #00ff7f; margin-top: 25px; margin-bottom: 10px; font-size: 1.2em; }
        p { margin-bottom: 15px; color: #94a3b8; }
        a { color: #ff1494; text-decoration: none; transition: all 0.2s; }
        a:hover { color: #00ff7f; text-decoration: underline; }
        code { background: rgba(255, 20, 148, 0.15); padding: 3px 8px; border-radius: 4px; color: #00ff7f; font-family: 'Courier New', monospace; font-size: 0.9em; }
        pre { background: #1a1a1a; border: 1px solid rgba(255, 20, 148, 0.3); border-radius: 8px; padding: 20px; margin: 20px 0; overflow-x: auto; }
        pre code { background: none; padding: 0; color: #e2e8f0; display: block; }
        .endpoint { background: rgba(0, 255, 127, 0.1); border-left: 4px solid #00ff7f; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
        .warning { background: rgba(255, 20, 148, 0.1); border-left: 4px solid #ff1494; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
        .info { background: rgba(100, 116, 139, 0.2); border-left: 4px solid #64748b; padding: 15px 20px; margin: 20px 0; border-radius: 4px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
        th { background: rgba(255, 20, 148, 0.1); color: #ff1494; font-weight: 600; }
        td { color: #94a3b8; }
        .btn { display: inline-block; background: linear-gradient(135deg, #ff1494 0%, #00ff7f 100%); color: #fff; padding: 12px 24px; border-radius: 6px; margin-top: 10px; font-weight: 600; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(255, 20, 148, 0.4); text-decoration: none; }
        hr { border: none; border-top: 1px solid rgba(255, 255, 255, 0.1); margin: 40px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 BOTZZZ773 API v2</h1>
        <p style="font-size: 1.1em; color: #64748b;">Standard SMM Panel API - Compatible with all major SMM platforms and reseller panels</p>
        
        <div class="endpoint">
            <strong style="color: #00ff7f;">Base URL:</strong> <code style="font-size: 1.1em;">https://www.botzzz773.pro/v2</code>
        </div>

        <h2>📖 Quick Start</h2>
        <p><strong>Request Method:</strong> POST (recommended) or GET<br>
        <strong>Content-Type:</strong> <code>application/x-www-form-urlencoded</code> or <code>application/json</code><br>
        <strong>API Key Format:</strong> All keys start with <code>sk_</code> (get yours from <a href="/api-dashboard.html">API Dashboard</a>)</p>

        <h3>Test Your Connection</h3>
        <div class="info">
            <p><strong>Quick connectivity test:</strong> Send a POST request to check your balance</p>
            <pre><code>POST https://www.botzzz773.pro/v2
Content-Type: application/x-www-form-urlencoded

key=YOUR_API_KEY&action=balance</code></pre>
        </div>

        <h2>🎯 Example Requests</h2>
        
        <h3>Get Services List</h3>
        <pre><code>key=YOUR_API_KEY&action=services</code></pre>
        <p><strong>Response:</strong> Array of available services with pricing and limits</p>

        <h3>Create Order</h3>
        <pre><code>key=YOUR_API_KEY&action=add&service=1&link=https://instagram.com/username&quantity=1000</code></pre>
        <p><strong>Response:</strong> <code>{"order": 12345}</code></p>

        <h3>Check Order Status</h3>
        <pre><code>key=YOUR_API_KEY&action=status&order=12345</code></pre>
        <p><strong>Response:</strong> <code>{"charge": "10.50", "start_count": "1500", "status": "Completed", "remains": "0", "currency": "USD"}</code></p>

        <h3>Check Balance</h3>
        <pre><code>key=YOUR_API_KEY&action=balance</code></pre>
        <p><strong>Response:</strong> <code>{"balance": "250.00", "currency": "USD"}</code></p>

        <h2>⚡ Advanced Features</h2>
        
        <h3>Multi-Status Check</h3>
        <p>Check multiple orders at once (comma-separated IDs):</p>
        <pre><code>key=YOUR_API_KEY&action=status&orders=123,456,789</code></pre>

        <h3>Refill Order</h3>
        <pre><code>key=YOUR_API_KEY&action=refill&order=12345</code></pre>
        <p><strong>Response:</strong> <code>{"refill": 67890}</code></p>

        <h3>Refill Status</h3>
        <p>Single or multiple refills:</p>
        <pre><code>key=YOUR_API_KEY&action=refill_status&refill=67890
key=YOUR_API_KEY&action=refill_status&refills=111,222,333</code></pre>

        <h2>📋 API Reference</h2>
        
        <table>
            <thead>
                <tr>
                    <th>Action</th>
                    <th>Required Parameters</th>
                    <th>Description</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><code>services</code></td>
                    <td><code>key</code> (optional)</td>
                    <td>Get list of all available services</td>
                </tr>
                <tr>
                    <td><code>add</code></td>
                    <td><code>key</code>, <code>service</code>, <code>link</code>, <code>quantity</code></td>
                    <td>Create a new order</td>
                </tr>
                <tr>
                    <td><code>status</code></td>
                    <td><code>key</code>, <code>order</code> or <code>orders</code></td>
                    <td>Get order status (single or multiple)</td>
                </tr>
                <tr>
                    <td><code>balance</code></td>
                    <td><code>key</code></td>
                    <td>Check account balance</td>
                </tr>
                <tr>
                    <td><code>refill</code></td>
                    <td><code>key</code>, <code>order</code></td>
                    <td>Request order refill</td>
                </tr>
                <tr>
                    <td><code>refill_status</code></td>
                    <td><code>key</code>, <code>refill</code> or <code>refills</code></td>
                    <td>Check refill status (single or batch)</td>
                </tr>
            </tbody>
        </table>

        <div class="warning">
            <p><strong>⚠️ Security Notes:</strong></p>
            <ul style="margin-left: 20px; color: #94a3b8;">
                <li>Keep your API key secret - never share it publicly</li>
                <li>Use HTTPS for all requests (enforced)</li>
                <li>Rate limit: 120 requests per minute per key</li>
                <li>All errors return HTTP 200 with <code>{"error": "message"}</code> for compatibility</li>
            </ul>
        </div>

        <h2>🔗 Integration Guide</h2>
        <p>Most SMM panel software and reseller platforms recognize this API format automatically.</p>
        <p><strong>Setup in your panel:</strong></p>
        <ol style="margin-left: 40px; color: #94a3b8;">
            <li>Navigate to Providers or API Settings</li>
            <li>Add new provider with URL: <code>https://www.botzzz773.pro/v2</code></li>
            <li>Enter your API key (starts with <code>sk_</code>)</li>
            <li>Test connection using the balance action</li>
            <li>Sync services to import our catalog</li>
        </ol>

        <hr>
        
        <a href="/api" class="btn">📚 View Full Documentation</a>
        <a href="/api-dashboard.html" class="btn" style="margin-left: 15px;">🔑 Get API Key</a>

        <p style="margin-top: 40px; text-align: center; color: #64748b; font-size: 0.9em;">
            BOTZZZ773 API v2 | <a href="https://www.botzzz773.pro">www.botzzz773.pro</a>
        </p>
    </div>
</body>
</html>`
          };
        }
      }
    } else {
      // Support both JSON and URL-encoded form data
      const contentType = event.headers['content-type'] || event.headers['Content-Type'] || '';
      
      console.log(`[API v2][${reqId}] Request received:`, {
        method: event.httpMethod,
        contentType: contentType,
        origin: event.headers.origin || event.headers.Origin || 'unknown',
        bodyLength: (event.body || '').length
      });
      
      if (contentType.includes('application/x-www-form-urlencoded')) {
        // Parse URL-encoded form data
        const querystring = require('querystring');
        params = querystring.parse(event.body || '');
        console.log(`[API v2][${reqId}] Parsed URL-encoded params:`, { action: params.action, hasKey: !!params.key });
      } else {
        // Parse JSON
        params = JSON.parse(event.body || '{}');
        console.log(`[API v2][${reqId}] Parsed JSON params:`, { action: params.action, hasKey: !!params.key });
      }
    }
    
    const { key, action, ...otherParams } = params;

    // Log when both action and key are missing (potential misconfiguration)
    if (!action && !key) {
      const clientIp = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
      console.warn(`[API v2][${reqId}] Request with no action or key (possible misconfiguration):`, {
        method: event.httpMethod,
        contentType: event.headers['content-type'] || event.headers['Content-Type'],
        bodyLength: (event.body || '').length,
        clientIp: clientIp,
        allParams: Object.keys(params)
      });
    }

    // Handle services action - can be authenticated or unauthenticated
    if (action === 'services') {
      // If key provided, validate it first
      if (key) {
        const user = await getUserFromApiKey(key);
        if (!user) {
          const clientIp = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
          const hasCorrectFormat = key.startsWith('sk_');
          console.warn(`[API v2][${reqId}] Services request with invalid API key:`, { 
            keyPrefix: key.substring(0, 6),
            keyLength: key.length,
            startsWithSk: hasCorrectFormat,
            method: event.httpMethod,
            clientIp: clientIp
          });
          
          let reason = 'key_not_found';
          if (!hasCorrectFormat) {
            reason = 'invalid_key_format';
          }
          
          await auditLog(null, 'auth_failure_services', { 
            keyPrefix: key.substring(0, 6), 
            method: event.httpMethod,
            reason: reason,
            client_ip: clientIp
          }, 'warning');
          
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ error: 'Invalid API key' })
          };
        }
        
        if (user.status !== 'active') {
          console.warn(`[API v2][${reqId}] Services request from inactive account: user=${user.id}, status=${user.status}`);
          await auditLog(user.id, 'auth_failure_services_inactive', { 
            user_status: user.status,
            reason: 'user_inactive',
            email: user.email 
          }, 'warning');
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ error: 'Invalid API key' })
          };
        }
        
        // Authenticated services request
        console.log(`[API v2][${reqId}] Services list requested with authentication:`, { 
          user: user.id, 
          method: event.httpMethod
        });
        return await handleServices(user, headers, reqId);
      } else {
        // Unauthenticated services request (public discovery)
        console.log(`[API v2][${reqId}] Services list requested without authentication (public discovery mode)`);
        return await handleServices(null, headers, reqId);
      }
    }
    
    // Default to services list when no action specified (unauthenticated)
    if (!action) {
      console.log(`[API v2][${reqId}] No action specified, returning services list (public discovery)`);
      return await handleServices(null, headers, reqId);
    }

    // Validate API key for other actions (add, status, balance, refill)
    if (!key) {
      const clientIp = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
      console.warn(`[API v2][${reqId}] Request attempted without API key:`, { 
        action, 
        method: event.httpMethod,
        contentType: event.headers['content-type'] || event.headers['Content-Type'],
        bodyLength: (event.body || '').length,
        clientIp: clientIp
      });
      await auditLog(null, 'auth_failure_missing_key', { 
        action, 
        method: event.httpMethod, 
        reason: 'no_key_provided',
        client_ip: clientIp 
      }, 'warning');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Invalid API key' })
      };
    }

    const user = await getUserFromApiKey(key);
    if (!user) {
      const clientIp = event.headers['x-forwarded-for'] || event.headers['x-real-ip'] || 'unknown';
      const hasCorrectFormat = key.startsWith('sk_');
      console.warn(`[API v2][${reqId}] Request with invalid API key attempted:`, { 
        action, 
        keyPrefix: key.substring(0, 6),
        keyLength: key.length,
        startsWithSk: hasCorrectFormat,
        method: event.httpMethod,
        clientIp: clientIp
      });
      
      // Determine specific reason for failure
      let reason = 'key_not_found';
      if (!hasCorrectFormat) {
        reason = 'invalid_key_format';
      }
      
      await auditLog(null, 'auth_failure_invalid_key', { 
        action, 
        keyPrefix: key.substring(0, 6), 
        method: event.httpMethod,
        reason: reason,
        client_ip: clientIp
      }, 'warning');
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Invalid API key' })
      };
    }

    if (user.status !== 'active') {
      console.warn(`[API v2][${reqId}] Request from inactive account: user=${user.id}, status=${user.status}, action=${action}`);
      await auditLog(user.id, 'auth_failure_inactive_account', { 
        action, 
        user_status: user.status,
        reason: 'user_inactive',
        email: user.email 
      }, 'warning');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Invalid API key' })
      };
    }

    // Rate limiting check (persistent via Supabase, with in-memory fallback)
    if (!await checkRateLimitPersistent(user.id)) {
      await auditLog(user.id, 'rate_limit_exceeded', { action }, 'warning');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Rate limit exceeded. Maximum 120 requests per minute.' })
      };
    }

    // Route to appropriate handler based on action
    switch (action) {
      case 'add':
        return await handleAddOrder(user, otherParams, headers, reqHeaders, reqId);
      case 'status':
        return await handleOrderStatus(user, otherParams, headers, reqId);
      case 'balance':
        return await handleBalance(user, headers, reqId);
      case 'refill':
        return await handleRefill(user, otherParams, headers, reqId);
      case 'refill_status':
      case 'refills':
        return await handleRefillStatus(user, otherParams, headers, reqId);
      default:
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ error: 'Invalid action. Supported: services, add, status, balance, refill, refill_status' })
        };
    }
  } catch (error) {
    console.error('API v2 error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

// Convert UUID to numeric ID (consistent hash)
function uuidToNumericId(uuid) {
  // Remove hyphens and take first 8 characters
  const hex = uuid.replace(/-/g, '').substring(0, 8);
  // Convert to integer (max safe integer in JS is 9007199254740991)
  const numericId = parseInt(hex, 16);
  return numericId;
}

// Find service UUID by numeric ID (reverse lookup)
async function findServiceByNumericId(numericId) {
  try {
    // Get all services and find matching numeric ID
    const { data: services } = await supabaseAdmin
      .from('services')
      .select('id')
      .eq('status', 'active');
    
    if (!services) return null;
    
    for (const service of services) {
      if (uuidToNumericId(service.id) === parseInt(numericId, 10)) {
        return service.id;
      }
    }
    return null;
  } catch (error) {
    console.error('[API v2] Error finding service by numeric ID:', error);
    return null;
  }
}

// Get services list
async function handleServices(user, headers, reqId) {
  try {
    // Log service access (authenticated vs unauthenticated)
    if (user) {
      console.log(`[API v2][${reqId}] Services list requested by authenticated user: user=${user.id}`);
    } else {
      console.log(`[API v2][${reqId}] Services list requested without authentication (public discovery mode)`);
    }
    
    const { data: services, error } = await supabaseAdmin
      .from('services')
      .select('id, public_id, name, type, category, rate, min_quantity, max_quantity, dripfeed, refill, cancel, description, status')
      .eq('status', 'active')
      .order('category', { ascending: true })
      .order('public_id', { ascending: true }); // Stable ordering by public_id for external consistency

    if (error) {
      console.error(`[API v2][${reqId}] Services query error:`, { 
        errorCode: error.code,
        errorMessage: error.message,
        expectedCount: 'unknown',
        returningEmptyArray: true
      });
      // Return empty array instead of error for reliability (graceful degradation)
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify([])
      };
    }

    // Validate services array
    if (!Array.isArray(services)) {
      console.error(`[API v2][${reqId}] Services response is not an array:`, { 
        actualType: typeof services,
        servicesValue: services,
        returningEmptyArray: true
      });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify([])
      };
    }

    // Format services in standard SMM panel format with strict validation
    const formattedServices = services
      .filter(service => {
        // Filter out invalid services
        if (!service.id || !service.name || service.rate === undefined) {
          console.warn(`[API v2] Skipping invalid service:`, service);
          return false;
        }
        // Must have public_id for external API compatibility
        if (!service.public_id) {
          console.warn(`[API v2] Skipping service without public_id:`, { id: service.id, name: service.name });
          return false;
        }
        return true;
      })
      .map(service => {
        try {
          const rate = parseFloat(service.rate);
          const minQty = parseInt(service.min_quantity || 1, 10);
          const maxQty = parseInt(service.max_quantity || 1000, 10);

          if (isNaN(rate) || isNaN(minQty) || isNaN(maxQty)) {
            console.warn(`[API v2] Service has invalid numeric values:`, { service: service.id, rate, minQty, maxQty });
            return null;
          }

          // Use public_id for external service ID (parallel IDs: UUID internal, numeric external)
          const serviceId = Number(service.public_id);

          console.log(`[API v2][${reqId}] Exporting service: internal_id=${service.id}, public_id=${serviceId}, name=${service.name}`);

          return {
            service: serviceId,
            name: String(service.name || 'Unnamed Service').substring(0, 100),
            type: String(service.type || 'Default').substring(0, 50),
            category: String(service.category || 'General').substring(0, 50),
            rate: rate.toFixed(2),  // 2 decimal places (standard for price per 1000)
            min: String(minQty),
            max: String(maxQty),
            dripfeed: service.dripfeed ? true : false,
            refill: service.refill !== false,  // Default true unless explicitly false
            cancel: service.cancel !== false,  // Default true unless explicitly false
            description: service.description ? String(service.description).substring(0, 255) : ''
          };
        } catch (formatError) {
          console.error(`[API v2] Error formatting service ${service.id}:`, formatError);
          return null;
        }
      })
      .filter(s => s !== null); // Remove null entries

    // Log services export summary
    console.log(`[API v2][${reqId}] Exporting ${formattedServices.length} services total`);
    if (formattedServices.length > 0) {
      console.log(`[API v2][${reqId}] Sample service: id=${formattedServices[0].service}, name="${formattedServices[0].name}", rate=${formattedServices[0].rate}`);
    }

    // Always return JSON for API compatibility (plain array, not wrapped in object)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(formattedServices)
    };
  } catch (error) {
    console.error(`[API v2][${reqId}] Services error:`, { 
      errorMessage: error.message,
      errorStack: error.stack,
      returningEmptyArray: true
    });
    // Return empty array on error for reliability
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify([])
    };
  }
}

// Add new order
async function handleAddOrder(user, params, headers, reqHeaders, reqId) {
  try {
    const { service, link, quantity, runs, interval } = params;

    // Extract idempotency key from request headers
    const idempotencyKey = reqHeaders['x-idempotency-key'];
    
    // If idempotency key provided, check for existing order with same key
    if (idempotencyKey) {
      const { data: existingOrder } = await supabaseAdmin
        .from('orders')
        .select('id, public_order_id, charge, status')
        .eq('user_id', user.id)
        .eq('idempotency_key', idempotencyKey)
        .single();

      if (existingOrder) {
        console.log(`[API v2][${reqId}] Duplicate request detected via idempotency key: user=${user.id}, key=${idempotencyKey}, public_order_id=${existingOrder.public_order_id}`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            order: existingOrder.public_order_id,
            charge: existingOrder.charge,
            status: existingOrder.status,
            message: 'Order already exists (duplicate request prevented)'
          })
        };
      }
    }

    // Validate required parameters
    if (!service || !link || !quantity) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Service, link, and quantity are required' })
      };
    }

    // Parse incoming service parameter as public_id (parallel IDs: external=public_id, internal=UUID)
    const servicePublicId = parseInt(service, 10);
    if (isNaN(servicePublicId) || servicePublicId <= 0) {
      console.error(`[API v2][${reqId}] Invalid service public_id: ${service}`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Invalid service ID' })
      };
    }

    console.log(`[API v2][${reqId}] Looking up service by public_id=${servicePublicId}`);

    // Lookup service by public_id, but retrieve UUID id for internal FK
    const { data: serviceData, error: serviceLookupError } = await supabaseAdmin
      .from('services')
      .select('id, public_id, name, rate, min_quantity, max_quantity, status, provider:providers(*)')
      .eq('public_id', servicePublicId)
      .eq('status', 'active')
      .single();

    if (serviceLookupError || !serviceData) {
      console.error(`[API v2][${reqId}] Service not found: public_id=${servicePublicId}`, serviceLookupError);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Service not found' })
      };
    }

    console.log(`[API v2][${reqId}] Found service: internal_id=${serviceData.id}, public_id=${serviceData.public_id}, name=${serviceData.name}`);

    // actualServiceId is now the UUID for internal FK relations
    const actualServiceId = serviceData.id;

    // Validate quantity is a positive integer
    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty <= 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Quantity must be a positive integer' })
      };
    }

    // Validate link (relaxed: accept URLs, usernames, or IDs)
    if (link.startsWith('http://') || link.startsWith('https://')) {
      try {
        const linkUrl = new URL(link);
        if (!/^https?:$/.test(linkUrl.protocol)) {
          throw new Error('Invalid protocol');
        }
      } catch (urlError) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ error: 'Invalid URL format for link' })
        };
      }
    }
    // Otherwise treat link as username/ID (no validation needed)

    // Optional: Validate runs and interval if provided
    if (runs !== undefined) {
      const runsNum = parseInt(runs, 10);
      if (isNaN(runsNum) || runsNum < 1) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ error: 'Runs must be a positive integer' })
        };
      }
    }

    if (interval !== undefined) {
      const intervalNum = parseInt(interval, 10);
      if (isNaN(intervalNum) || intervalNum < 1 || intervalNum > 1440) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ error: 'Interval must be between 1 and 1440 minutes' })
        };
      }
    }

    // Service already validated as active in the lookup above

    // Calculate cost
    const totalCost = (serviceData.rate * qty).toFixed(2);

    // Validate total cost is reasonable (prevent accidental massive orders)
    if (parseFloat(totalCost) > 10000) {
      console.warn(`[API v2][${reqId}] Suspicious large order attempt: user=${user.id}, service=${actualServiceId}, qty=${qty}, cost=${totalCost}`);
      await auditLog(user.id, 'suspicious_large_order', { service: actualServiceId, quantity: qty, cost: totalCost }, 'critical');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Order amount exceeds maximum limit' })
      };
    }

    // Check balance
    if (parseFloat(user.balance) < parseFloat(totalCost)) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Insufficient funds' })
      };
    }

    // Create order (service_id uses UUID for internal FK, public_order_id generated by trigger)
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: user.id,
        service_id: actualServiceId, // UUID FK to services.id
        service_name: serviceData.name,
        link: link,
        quantity: quantity,
        charge: totalCost,
        status: 'pending',
        customer_status: 'processing',
        provider_status: null,
        order_number: `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
        idempotency_key: idempotencyKey || null
      })
      .select('id, public_order_id, charge, status')
      .single();

    if (orderError) {
      console.error(`[API v2][${reqId}] Order creation failed: user=${user.id}, service_public_id=${servicePublicId}`, orderError);
      await auditLog(user.id, 'order_creation_failed', { reqId, service_public_id: servicePublicId, service_id: actualServiceId, error: orderError.message }, 'critical');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Failed to create order' })
      };
    }

    console.log(`[API v2][${reqId}] Order created: internal_id=${order.id}, public_order_id=${order.public_order_id}, charge=${order.charge}`);

    // Deduct balance
    await supabaseAdmin
      .from('users')
      .update({ 
        balance: (parseFloat(user.balance) - parseFloat(totalCost)).toFixed(2)
      })
      .eq('id', user.id);

    // Submit to provider if available
    if (serviceData.provider && serviceData.provider.api_url && serviceData.provider.api_key) {
      try {
        const axios = require('axios');
        const providerParams = new URLSearchParams();
        providerParams.append('key', serviceData.provider.api_key);
        providerParams.append('action', 'add');
        providerParams.append('service', serviceData.provider_service_id);
        providerParams.append('link', link);
        providerParams.append('quantity', quantity);

        const providerResponse = await axios.post(serviceData.provider.api_url, providerParams);
        
        if (providerResponse.data && providerResponse.data.order) {
          await supabaseAdmin
            .from('orders')
            .update({ 
              provider_order_id: providerResponse.data.order,
              status: 'processing',
              provider_status: 'processing'
            })
            .eq('id', order.id);
        }
      } catch (providerError) {
        console.error('Provider submission error:', providerError);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ order: order.public_order_id })
    };
  } catch (error) {
    console.error('Add order error:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'Service temporarily unavailable' })
    };
  }
}

// Get order status (supports single or multiple orders)
async function handleOrderStatus(user, params, headers, reqId) {
  try {
    const { order, orders } = params;

    // Support multi-status check (comma-separated order IDs)
    if (orders) {
      const orderIds = orders.split(',').map(id => id.trim());
      
      // Cap multi-status requests at 100 IDs to prevent abuse
      const MAX_MULTI_STATUS = 100;
      if (orderIds.length > MAX_MULTI_STATUS) {
        console.warn(`[API v2][${reqId}] Multi-status request exceeds limit: user=${user.id}, requested=${orderIds.length}, limit=${MAX_MULTI_STATUS}`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ error: `Maximum ${MAX_MULTI_STATUS} order IDs allowed per request` })
        };
      }
      const results = {};

      for (const orderId of orderIds) {
        const publicOrderId = parseInt(orderId, 10);
        if (isNaN(publicOrderId) || publicOrderId <= 0) {
          results[orderId] = { error: 'Invalid order ID' };
          continue;
        }

        console.log(`[API v2][${reqId}] Status lookup by public_order_id=${publicOrderId}`);

        const { data: orderData } = await supabaseAdmin
          .from('orders')
          .select('id, public_order_id, charge, start_count, remains, status')
          .eq('public_order_id', publicOrderId)
          .eq('user_id', user.id)
          .single();

        if (!orderData) {
          console.warn(`[API v2][${reqId}] Order not found: public_order_id=${publicOrderId}, user_id=${user.id}`);
          results[orderId] = { error: 'Order not found' };
          continue;
        }

        console.log(`[API v2][${reqId}] Order found: internal_id=${orderData.id}, public_order_id=${orderData.public_order_id}, status=${orderData.status}`);

        const charge = parseFloat(orderData.charge || 0).toFixed(2);
        const startCount = String(orderData.start_count || '0');
        const remains = String(orderData.remains || '0');
        const status = (orderData.status || 'unknown').toLowerCase();

        results[orderId] = {
          charge: charge,
          start_count: startCount,
          status: status.charAt(0).toUpperCase() + status.slice(1),
          remains: remains,
          currency: 'USD'
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(results)
      };
    }

    // Single order status check
    // Validate order ID is provided
    if (!order) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Order ID is required' })
      };
    }

    // Validate order ID is numeric (public_order_id)
    const publicOrderId = parseInt(order, 10);
    if (isNaN(publicOrderId) || publicOrderId <= 0) {
      await auditLog(user.id, 'invalid_order_id_status', { providedId: order }, 'warning');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Invalid order ID' })
      };
    }

    console.log(`[API v2][${reqId}] Status lookup by public_order_id=${publicOrderId}`);

    const { data: orderData, error } = await supabaseAdmin
      .from('orders')
      .select('id, public_order_id, charge, start_count, remains, status')
      .eq('public_order_id', publicOrderId)
      .eq('user_id', user.id)
      .single();

    if (error || !orderData) {
      console.warn(`[API v2][${reqId}] Status check on non-existent order: user=${user.id}, public_order_id=${publicOrderId}`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    console.log(`[API v2][${reqId}] Order found: internal_id=${orderData.id}, public_order_id=${orderData.public_order_id}, status=${orderData.status}`);

    // Validate required fields exist
    if (!orderData.status || orderData.charge === undefined || orderData.charge === null) {
      console.error(`[API v2] Order missing required fields: public_order_id=${orderData.public_order_id}`, { status: orderData.status, charge: orderData.charge });
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Order data incomplete' })
      };
    }

    // Normalize numeric fields to strings
    const charge = parseFloat(orderData.charge).toFixed(2);
    const startCount = String(orderData.start_count || '0');
    const remains = String(orderData.remains || '0');

    // Validate status is valid enum value
    const validStatuses = ['pending', 'processing', 'completed', 'partial', 'failed', 'refilling', 'refunded'];
    const status = (orderData.status || 'unknown').toLowerCase();
    if (!validStatuses.includes(status)) {
      console.warn(`[API v2] Invalid status value: order=${orderId}, status=${status}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        charge: charge,
        start_count: startCount,
        status: status.charAt(0).toUpperCase() + status.slice(1),
        remains: remains,
        currency: 'USD'
      })
    };
  } catch (error) {
    console.error('Order status error:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'Service temporarily unavailable' })
    };
  }
}

// Get user balance
async function handleBalance(user, headers, reqId) {
  try {
    console.log(`[API v2][${reqId}] Balance request: user=${user.id}, email=${user.email}, balance=${user.balance}`);
    
    // Audit successful balance check
    await auditLog(user.id, 'balance_check', {
      reqId, 
      balance: user.balance,
      success: true 
    }, 'info');
    
    const balance = user.balance !== null && user.balance !== undefined 
      ? parseFloat(user.balance).toFixed(2) 
      : '0.00';
    
    console.log(`[API v2][${reqId}] Returning balance: ${balance} USD`);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        balance: balance,
        currency: 'USD'
      })
    };
  } catch (error) {
    console.error('[API v2] Balance error:', error);
    
    // Audit balance check failure
    await auditLog(user ? user.id : null, 'balance_check_error', {
      reqId, 
      error: error.message,
      success: false 
    }, 'critical');
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'Service temporarily unavailable' })
    };
  }
}

// Request refill
async function handleRefill(user, params, headers, reqId) {
  try {
    const { order } = params;

    // Validate order ID is provided
    if (!order) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Order ID is required' })
      };
    }

    // Validate order ID is numeric (public_order_id)
    const publicOrderId = parseInt(order, 10);
    if (isNaN(publicOrderId) || publicOrderId <= 0) {
      await auditLog(user.id, 'invalid_order_id_refill', { providedId: order }, 'warning');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Invalid order ID' })
      };
    }

    console.log(`[API v2][${reqId}] Refill request for public_order_id=${publicOrderId}`);

    // Get order and verify ownership (query by public_order_id, retrieve UUID for internal joins)
    const { data: orderData, error } = await supabaseAdmin
      .from('orders')
      .select('id, public_order_id, provider_order_id, status, refill_id, service:services(id, name, refill, provider:providers(*))')
      .eq('public_order_id', publicOrderId)
      .eq('user_id', user.id)
      .single();

    if (error || !orderData) {
      console.warn(`[API v2][${reqId}] Refill attempt on non-existent order: user=${user.id}, public_order_id=${publicOrderId}`);
      await auditLog(user.id, 'refill_nonexistent_order', { reqId, public_order_id: publicOrderId }, 'warning');
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Order not found' })
      };
    }

    console.log(`[API v2][${reqId}] Order found for refill: internal_id=${orderData.id}, public_order_id=${orderData.public_order_id}, provider_order_id=${orderData.provider_order_id}`);

    // Verify order has provider order ID (was submitted to provider)
    if (!orderData.provider_order_id) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'This order cannot be refilled' })
      };
    }

    // Check if order is already in a refill process
    if (orderData.status === 'refilling') {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Order is already being refilled' })
      };
    }

    // Submit refill to provider if available
    if (orderData.service && orderData.service.provider && orderData.service.provider.api_url && orderData.service.provider.api_key) {
      try {
        const axios = require('axios');
        const providerParams = new URLSearchParams();
        providerParams.append('key', orderData.service.provider.api_key);
        providerParams.append('action', 'refill');
        providerParams.append('order', orderData.provider_order_id);

        const providerResponse = await axios.post(orderData.service.provider.api_url, providerParams, {
          timeout: 10000 // 10 second timeout
        });

        // Validate provider response format
        if (!providerResponse.data || !providerResponse.data.refill) {
          console.error(`[API v2][${reqId}] Invalid provider refill response: public_order_id=${orderData.public_order_id}`, providerResponse.data);
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ error: 'Provider returned invalid response' })
          };
        }

        // Update order with refill info (use internal UUID id for update)
        await supabaseAdmin
          .from('orders')
          .update({ 
            status: 'refilling',
            refill_id: providerResponse.data.refill
          })
          .eq('id', orderData.id);

        console.log(`[API v2][${reqId}] Refill submitted: public_order_id=${orderData.public_order_id}, provider_refill_id=${providerResponse.data.refill}`);

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ refill: providerResponse.data.refill })
        };
      } catch (providerError) {
        console.error(`[API v2] Provider refill error: order=${orderId}`, providerError.message);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ error: 'Provider request failed. Please try again later.' })
        };
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'Refill is not available for this order' })
    };
  } catch (error) {
    console.error('Refill error:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'Service temporarily unavailable' })
    };
  }
}

// Get refill status (supports single or multiple refills)
async function handleRefillStatus(user, params, headers, reqId) {
  try {
    const { refill, refills } = params;

    // Support multi-refill status check (comma-separated refill IDs)
    if (refills) {
      const refillIds = refills.split(',').map(id => id.trim());
      
      // Cap multi-refill requests at 100 IDs to prevent abuse
      const MAX_MULTI_REFILL = 100;
      if (refillIds.length > MAX_MULTI_REFILL) {
        console.warn(`[API v2][${reqId}] Multi-refill status request exceeds limit: user=${user.id}, requested=${refillIds.length}, limit=${MAX_MULTI_REFILL}`);
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ error: `Maximum ${MAX_MULTI_REFILL} refill IDs allowed per request` })
        };
      }
      const results = {};

      for (const refillId of refillIds) {
        const refillIdNum = parseInt(refillId, 10);
        if (isNaN(refillIdNum) || refillIdNum <= 0) {
          results[refillId] = { error: 'Invalid refill ID' };
          continue;
        }

        // Check if refill_id exists in orders table
        const { data: orderData } = await supabaseAdmin
          .from('orders')
          .select('id, status, charge')
          .eq('refill_id', refillIdNum)
          .eq('user_id', user.id)
          .single();

        if (!orderData) {
          results[refillId] = { error: 'Refill not found' };
          continue;
        }

        // Map order status to refill status
        let refillStatus = 'processing';
        if (orderData.status === 'completed') refillStatus = 'completed';
        if (orderData.status === 'failed') refillStatus = 'rejected';
        if (orderData.status === 'partial') refillStatus = 'partial';

        results[refillId] = {
          status: refillStatus.charAt(0).toUpperCase() + refillStatus.slice(1)
        };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(results)
      };
    }

    // Single refill status check
    if (!refill) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Refill ID is required' })
      };
    }

    const refillIdNum = parseInt(refill, 10);
    if (isNaN(refillIdNum) || refillIdNum <= 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Invalid refill ID' })
      };
    }

    const { data: orderData, error } = await supabaseAdmin
      .from('orders')
      .select('id, status, charge')
      .eq('refill_id', refillIdNum)
      .eq('user_id', user.id)
      .single();

    if (error || !orderData) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ error: 'Refill not found' })
      };
    }

    // Map order status to refill status
    let refillStatus = 'processing';
    if (orderData.status === 'completed') refillStatus = 'completed';
    if (orderData.status === 'failed') refillStatus = 'rejected';
    if (orderData.status === 'partial') refillStatus = 'partial';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        status: refillStatus.charAt(0).toUpperCase() + refillStatus.slice(1)
      })
    };
  } catch (error) {
    console.error('Refill status error:', error);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ error: 'Service temporarily unavailable' })
    };
  }
}
