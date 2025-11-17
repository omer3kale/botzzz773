# Monitoring & Observability Setup

This document explains how to configure the new Sentry, LogRocket, uptime, and analytics integrations that ship with the BOTZZZ773 panel.

## 1. Where settings live

All integration settings are stored in the `settings` table (key: `integrations`) and can be managed from **Admin → Settings → Integrations**. The public site never loads admin credentials; instead it fetches a sanitized snapshot via `/.netlify/functions/public-config`, which exposes only the fields required by the browser.

### Fields exposed to clients

| Category | Keys | Notes |
| --- | --- | --- |
| Sentry | `sentryEnabled`, `sentryDsn`, `sentryEnvironment`, `sentryTracesSampleRate`, `sentryReplaysSessionSampleRate`, `sentryReplaysOnErrorSampleRate` | DSNs are public-safe. Sample rates accept decimals (0–1). |
| LogRocket | `logRocketEnabled`, `logRocketAppId`, `logRocketRelease`, `logRocketConsoleLogging` | App ID uses the `team/app` format from LogRocket. |
| Analytics | `gaEnabled`, `analyticsProvider`, `gaMeasurementId`, `gaTrackingId`, `analyticsAutoPageview` | Supports GA4 (measurement ID) and legacy UA IDs. |
| Uptime | `uptimeEnabled`, `uptimeProvider`, `uptimeHeartbeatUrl`, `uptimePingInterval`, `uptimeTransport` | Defaults to the built-in Netlify heartbeat endpoint. |

## 2. Client runtime

The shared runtime lives in `js/monitoring.js`. It auto-loads on every public and admin page (bootstrapped inside `main.js` and `admin-auth.js`).

### Responsibilities

- Fetch and cache `/.netlify/functions/public-config` (5-minute client cache)
- Load Sentry from the public CDN and attach fetch-guard breadcrumbs
- Load LogRocket and automatically identify the current user if they are signed in
- Initialize Google Analytics (gtag) with GA4 and/or legacy IDs
- Fire heartbeat pings to `/.netlify/functions/heartbeat` using `fetch` or `navigator.sendBeacon`
- Provide basic `window.error` / `unhandledrejection` logging as a safety net

All modules are optional—if a toggle is off or a required key is missing, the runtime skips that integration.

## 3. Netlify functions

| Function | Purpose |
| --- | --- |
| `/.netlify/functions/public-config` | Returns sanitized integration settings for the browser. Responses are cached server-side for 60 seconds. |
| `/.netlify/functions/heartbeat` | Lightweight health check that pings Supabase (head request) and returns `200 OK` when everything is healthy. |

Configure your uptime provider to poll `/heartbeat` every 60–120 seconds. External monitors can look at the JSON payload for more detail: `{ success, timestamp, latencyMs, checks: { database: { healthy, latencyMs }}}`.

## 4. Enabling integrations

1. Sign in to the admin panel as an administrator.
2. Navigate to **Settings → Integrations**.
3. Fill out the new cards:
   - **Analytics Tracking** – toggle on, select provider, and supply GA4/UA IDs.
   - **Error Tracking (Sentry)** – toggle on, paste your DSN, and (optionally) adjust sample rates.
   - **Session Replay (LogRocket)** – toggle on and paste the `team/app` ID.
   - **Uptime Monitoring** – toggle on to expose the heartbeat endpoint and optionally override the interval/transport.
4. Click **Save Changes**. The frontend will start using the new settings within a minute (cached response TTL).

## 5. Testing checklist

- Visit `/admin/index.html` and open the browser console. You should see "Sentry initialized" / "LogRocket initialized" once valid credentials are present.
- Hit `/.netlify/functions/public-config` directly to confirm the public payload contains only non-sensitive keys.
- Hit `/.netlify/functions/heartbeat` to verify the Netlify function reports `success: true` and HTTP 200.
- Use your monitoring providers (Sentry, LogRocket, GA, uptime) to confirm new events flow in real time.

Happy monitoring! 🎯
