const axios = require('axios');
const nodemailer = require('nodemailer');
const { supabaseAdmin } = require('./utils/supabase');
const { getPricingEngine } = require('./utils/pricing-engine');
const { convertToUSD } = require('./utils/currency-converter');
const fs = require('fs');
const path = require('path');

function normalizeServiceStatus(rawStatus) {
  if (rawStatus === undefined || rawStatus === null) {
    return 'active';
  }

  const status = String(rawStatus).trim().toLowerCase();
  if (!status) {
    return 'active';
  }

  const inactiveValues = new Set(['0', 'false', 'inactive', 'disabled', 'deactive', 'paused', 'off']);
  return inactiveValues.has(status) ? 'inactive' : 'active';
}

function toRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;

  // Round to 4 decimals (DB uses numeric(10,4) so max absolute value must be < 1e6)
  const rounded = Number(numeric.toFixed(4));
  const MAX_ABS = 999999.9999; // numeric(10,4) allows up to 999999.9999

  if (Math.abs(rounded) > MAX_ABS) {
    // Value cannot be stored in DB safely; treat as missing so we don't cause numeric overflow
    return null;
  }

  return rounded;
}

function toPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toQuantity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return Math.trunc(numeric);
}

function toBooleanFlag(value) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value > 0;
  }

  const str = String(value).trim().toLowerCase();
  if (!str) {
    return false;
  }

  return ['1', 'true', 'yes', 'y', 'on', 'available'].includes(str);
}

function normalizeAverageTime(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const str = String(value).trim();
  return str.length > 0 ? str.slice(0, 100) : null;
}

function normalizeCurrency(value, fallback = 'USD') {
  if (value === undefined || value === null) {
    return fallback;
  }

  const str = String(value).trim();
  
  // Empty string or just whitespace → return fallback
  if (!str) {
    return fallback;
  }

  // If value is obviously invalid/nonsensical, return fallback
  const upperStr = str.toUpperCase();
  const cleaned = upperStr.slice(0, 10);
  
  // Validate: should be 2-3 character currency code or similar
  // If it's too short or contains invalid chars, default to USD
  if (cleaned.length < 2 || /^[^A-Z0-9]/.test(cleaned)) {
    return fallback;
  }

  return cleaned;
}

function truncateString(value, maxLength) {
  if (value === undefined || value === null) return '';
  const s = String(value);
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}
 
// Deep sanitize provider metadata so PostgREST receives safe JSON.
function sanitizeMetadata(value, options = {}) {
  const maxDepth = options.maxDepth ?? 3;
  const maxString = options.maxString ?? 2000;
  const maxArray = options.maxArray ?? 100;

  function _sanitize(val, depth) {
    if (val === null) return null;
    if (val === undefined) return null;
    if (typeof val === 'number') {
      if (!Number.isFinite(val)) return null;
      // protect against absurdly large numbers
      if (Math.abs(val) > 1e12) return null;
      return val;
    }
    if (typeof val === 'string') {
      const s = val.trim();
      return s.length > maxString ? s.slice(0, maxString) : s;
    }
    if (typeof val === 'boolean') return val;
    if (Array.isArray(val)) {
      if (depth >= maxDepth) return [];
      const out = [];
      for (let i = 0; i < Math.min(val.length, maxArray); i++) {
        const item = _sanitize(val[i], depth + 1);
        if (item !== null) out.push(item);
      }
      return out;
    }
    if (typeof val === 'object') {
      if (depth >= maxDepth) return {};
      const out = {};
      for (const k of Object.keys(val)) {
        try {
          const v = _sanitize(val[k], depth + 1);
          if (v !== null) out[k] = v;
        } catch (e) {
          // skip problematic key
        }
      }
      return out;
    }
    // functions, symbols, etc. -> drop
    return null;
  }

  try {
    return _sanitize(value, 0) || {};
  } catch (e) {
    return {};
  }
}

function appendFailedPayload(providerId, serviceKey, payload, type = 'insert') {
  try {
    const logDir = path.resolve(__dirname, 'logs');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const file = path.join(logDir, 'failed-provider-payloads.log');
    const entry = {
      time: new Date().toISOString(),
      providerId,
      serviceKey,
      type,
      payload
    };
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[SERVICE SYNC] Failed to write payload log', e && e.message ? e.message : e);
  }
}
async function fetchProviderServices(provider) {
  const params = new URLSearchParams();
  params.append('key', provider.api_key);
  params.append('action', 'services');

  const start = Date.now();

  try {
    const response = await axios.post(provider.api_url, params, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      validateStatus: (status) => status < 500
    });
    const latencyMs = Date.now() - start;

    if (!Array.isArray(response.data)) {
      throw new Error('Provider returned invalid service list response');
    }

    return { services: response.data, latencyMs };
  } catch (error) {
    if (provider?.id) {
      const { error: providerUpdateError } = await supabaseAdmin
        .from('providers')
        .update({
          health_status: 'degraded',
          response_latency_ms: null
        })
        .eq('id', provider.id);

      if (providerUpdateError) {
        console.error('[SERVICE SYNC] Failed to mark provider degraded:', providerUpdateError);
      }
    }

    throw error;
  }
}

async function syncProviderServices(provider, options = {}) {
  if (!provider.api_url || !provider.api_key) {
    throw new Error('Provider is missing API credentials');
  }

  const pricingEngine = options.pricingEngine || await getPricingEngine();
  const { services, latencyMs } = await fetchProviderServices(provider);

  // Provider'ın currency ayarını al (çoğu provider TRY kullanıyor)
  const providerCurrency = provider.currency || 'USD';
  console.log(`[SERVICE SYNC] Provider ${provider.name} (ID: ${provider.id}) currency: ${providerCurrency} (from provider.currency: ${provider.currency})`);
  console.log(`[SERVICE SYNC] Starting sync of ${services.length} services from provider...`);

  const { data: existingServices, error: existingError } = await supabaseAdmin
    .from('services')
    .select('id, provider_service_id, status, markup_percentage, provider_rate, rate, name, category, description, min_quantity, max_quantity')
    .eq('provider_id', provider.id);

  if (existingError) {
    throw new Error(`Failed to load existing services: ${existingError.message}`);
  }

  const existingMap = new Map();
  (existingServices || []).forEach((row) => {
    if (row.provider_service_id) {
      existingMap.set(String(row.provider_service_id), row);
    }
  });

  const seenProviderIds = new Set();
  let added = 0;
  let updated = 0;
  const changeEvents = [];
  let loggedFailedPayloads = 0;
  const MAX_LOG_FAILED = 5;

  // PHASE 1: Prepare all payloads in parallel (currency conversions)
  console.log('[SERVICE SYNC] Phase 1: Processing service payloads with currency conversion...');
  const preparedServices = await Promise.all(
    services.map(async (payload) => {
      const providerServiceId = payload.service ?? payload.service_id ?? payload.id;
      if (!providerServiceId) {
        return null;
      }

      const serviceKey = String(providerServiceId);
      seenProviderIds.add(serviceKey);

      const name = truncateString(payload.name || `Service ${serviceKey}`, 255);
      const category = truncateString((payload.category || 'other').toLowerCase(), 50);
      const rate = toRate(payload.rate ?? payload.price ?? payload.cost);
      const minQuantity = toQuantity(payload.min ?? payload.minimum);
      const rawMax = payload.max ?? payload.maximum;
      const maxQuantity = rawMax === undefined || rawMax === null ? null : toQuantity(rawMax);
      const status = truncateString(normalizeServiceStatus(payload.status ?? payload.state ?? payload.available), 20);
      const description = payload.description || payload.desc || '';

      const averageTime = normalizeAverageTime(
        payload.average_time ?? payload.avg_time ?? payload.averageTime ?? payload.time ?? payload.expected_time
      );

      // Force USD if currency is missing or invalid - CRITICAL FIX
      // Priority: payload currency > provider currency > USD fallback
      const currencyRaw = payload.currency ?? payload.price_currency ?? payload.rate_currency ?? payload.cur ?? providerCurrency;
      const currency = normalizeCurrency(currencyRaw, 'USD');

      // AUTO-CONVERT provider cost if not USD
      let providerCostUSD = rate;
      let currencyConversion = null;
      
      if (rate !== null && currency !== 'USD') {
        const conversion = await convertToUSD(rate, currency);
        if (conversion.converted && conversion.usdAmount !== null) {
          providerCostUSD = conversion.usdAmount;
          currencyConversion = {
            originalAmount: conversion.originalAmount,
            originalCurrency: conversion.originalCurrency,
            usdAmount: conversion.usdAmount,
            exchangeRate: conversion.rate
          };
          console.log(`[SERVICE SYNC] Service ${serviceKey}: Auto-converted ${conversion.originalCurrency} ${conversion.originalAmount} → USD ${conversion.usdAmount} (rate: ${conversion.rate})`);
        } else if (conversion.warning) {
          console.warn(`[SERVICE SYNC] Service ${serviceKey}: ${conversion.warning} - using original rate as-is`);
        }
      }

      const basePayload = {
        name,
        category,
        status,
        description,
        provider_order_id: truncateString(serviceKey, 50),
        // NOTE: currency is NOT stored as a column; it's preserved in provider_metadata
        average_time: averageTime,
        refill_supported: toBooleanFlag(payload.refill ?? payload.refill_support ?? payload.needs_refill),
        cancel_supported: toBooleanFlag(payload.cancel ?? payload.cancel_support ?? payload.cancellable),
        dripfeed_supported: toBooleanFlag(payload.dripfeed ?? payload.drip_feed ?? payload.drip),
        subscription_supported: toBooleanFlag(payload.subscription ?? payload.subscriptions ?? payload.subscription_supported),
        // provider_metadata must be valid JSON for PostgREST/Supabase; sanitize to remove
        // undefined/non-serializable values and to cap sizes/depth.
        provider_metadata: sanitizeMetadata({
          ...payload,
          _currency_conversion: currencyConversion
        })
      };

      if (minQuantity !== null) {
        basePayload.min_quantity = minQuantity;
      }

      if (maxQuantity !== null) {
        basePayload.max_quantity = maxQuantity;
      } else {
        basePayload.max_quantity = null;
      }

      const providerCost = providerCostUSD !== null ? providerCostUSD : null;
      if (providerCost !== null) {
        basePayload.provider_rate = providerCost;
      }

      const existing = existingMap.get(serviceKey);
      
      // PRICE CHANGE DETECTION:
      // Compare in ORIGINAL currency if available, otherwise USD
      // This prevents false "price changed" logs due to exchange rate fluctuations
      let prevOriginalAmount = null;
      let newOriginalAmount = rate; // Default to raw rate
      let originalCurrency = currency;
      let providerPriceChanged = false;
      
      if (existing) {
        // Extract previous currency conversion info from metadata
        const prevMetadata = existing.provider_metadata || {};
        const prevConversion = prevMetadata._currency_conversion;
        
        if (prevConversion && prevConversion.originalAmount !== undefined) {
          // Previous had conversion - compare original amounts
          prevOriginalAmount = prevConversion.originalAmount;
          originalCurrency = prevConversion.originalCurrency || currency;
        } else {
          // No previous conversion - use USD rate
          prevOriginalAmount = toRate(existing.provider_rate);
          originalCurrency = 'USD';
        }
        
        if (currencyConversion) {
          // Current has conversion - use original amount
          newOriginalAmount = currencyConversion.originalAmount;
          originalCurrency = currencyConversion.originalCurrency;
        }
        
        // Detect actual provider price change (in original currency, ignore exchange rate changes)
        providerPriceChanged = prevOriginalAmount !== newOriginalAmount;
        
        if (providerPriceChanged) {
          console.log(`[PRICE CHANGE] Service ${serviceKey}: ${originalCurrency} ${prevOriginalAmount} → ${newOriginalAmount}`);
        }
      }
      
      // Get existing markup - if set, always use it for calculating retail rate
      const existingMarkup = existing ? toPercent(existing.markup_percentage) : null;

      let pricingResult = null;
      let retailRate = null;
      let markupUsed = null;

      // PRIORITY 1: Use existing markup if set by admin (Sabit Markup Strategy)
      if (existingMarkup !== null && providerCost !== null) {
        retailRate = Number((providerCost * (1 + existingMarkup / 100)).toFixed(4));
        markupUsed = existingMarkup;
        basePayload.markup_percentage = existingMarkup;
        basePayload.pricing_rule_id = null;
        basePayload.pricing_last_applied_at = null;
        basePayload.retail_rate = retailRate;
        console.log(`[SERVICE SYNC] Service ${serviceKey}: Priority 1 - Using existing markup ${existingMarkup}% → retail ${retailRate}`);
      } 
      // FALLBACK: Fixed 30% markup if no admin markup
      else if (providerCost !== null) {
        const fallbackMarkup = 30;
        retailRate = Number((providerCost * (1 + fallbackMarkup / 100)).toFixed(4));
        markupUsed = fallbackMarkup;
        basePayload.markup_percentage = fallbackMarkup;
        basePayload.pricing_rule_id = null;
        basePayload.pricing_last_applied_at = null;
        basePayload.retail_rate = retailRate;
        console.log(`[SERVICE SYNC] Service ${serviceKey}: Fallback - Using fixed ${fallbackMarkup}% markup → retail ${retailRate}`);
      }

      if (retailRate !== null) {
        basePayload.rate = retailRate;
        basePayload.retail_rate = retailRate;
      }

      if (existing) {
        // Preserve admin-customized service name
        const existingName = existing.name ? String(existing.name).trim() : '';
        if (existingName) {
          basePayload.name = existing.name;
        }

        // Preserve admin-customized service category
        const existingCategory = existing.category ? String(existing.category).trim() : '';
        if (existingCategory) {
          basePayload.category = existing.category;
        }

        // Preserve admin-customized service description
        // ALWAYS preserve existing description, even if admin left it blank
        // Never override with provider description during sync
        if (existing.description !== null && existing.description !== undefined) {
          basePayload.description = existing.description;
        }

        // Preserve admin-customized min_quantity if it was manually set
        if (existing.min_quantity !== null && existing.min_quantity !== undefined) {
          basePayload.min_quantity = existing.min_quantity;
        }

        // Preserve admin-customized max_quantity if it was manually set
        if (existing.max_quantity !== null && existing.max_quantity !== undefined) {
          basePayload.max_quantity = existing.max_quantity;
        }

        // Detect price changes before updating
        const prevProviderRate = toRate(existing.provider_rate);
        const prevRetailRate = toRate(existing.rate);
        const newProviderRate = toRate(basePayload.provider_rate);
        let newRetailRate = toRate(basePayload.rate);
        
        // Smart Markup Strategy: Handle provider rate changes INDEPENDENTLY of priority system
        // Use original currency comparison (providerPriceChanged) to avoid false positives from exchange rate fluctuations
        
        if (providerPriceChanged && markupUsed !== null && markupUsed > 0) {
          const rateIncreased = newProviderRate > prevProviderRate;
          
          if (rateIncreased) {
            // SCENARIO A: Provider rate INCREASED
            // Keep markup% same, adjust retail rate proportionally
            // Formula: New Retail = New Provider × (1 + Markup%)
            newRetailRate = Number((newProviderRate * (1 + markupUsed / 100)).toFixed(4));
            basePayload.rate = newRetailRate;
            basePayload.retail_rate = newRetailRate;
            basePayload.markup_percentage = markupUsed; // Keep same markup%
            console.log(`[MARKUP STRATEGY] Service ${serviceKey}: Provider ↑ (${prevProviderRate} → ${newProviderRate}), markup% ${markupUsed}% kept same, retail adjusted ${prevRetailRate} → ${newRetailRate}`);
          } else {
            // SCENARIO B: Provider rate DECREASED
            // Prefer to keep retail rate same and recalculate markup% higher.
            // If previous retail is missing (first sync), fallback to recomputing retail from markupUsed.
            if (prevRetailRate === null) {
              // First-time or missing retail: compute retail using current markupUsed
              newRetailRate = Number((newProviderRate * (1 + markupUsed / 100)).toFixed(4));
              basePayload.rate = newRetailRate;
              basePayload.retail_rate = newRetailRate;
              basePayload.markup_percentage = markupUsed;
              console.log(`[MARKUP STRATEGY] Service ${serviceKey}: Provider ↓ (${prevProviderRate} → ${newProviderRate}), prev retail missing → recomputed retail ${newRetailRate} with markup% ${markupUsed}%`);
            } else {
              // Keep retail rate same, recalculate markup% higher
              // Formula: New Markup% = ((Retail - Provider) / Provider) × 100
              newRetailRate = prevRetailRate; // Keep previous retail rate
              const newMarkup = Number((((prevRetailRate - newProviderRate) / newProviderRate) * 100).toFixed(5));
              basePayload.rate = newRetailRate;
              basePayload.retail_rate = newRetailRate;
              basePayload.markup_percentage = newMarkup;
              console.log(`[MARKUP STRATEGY] Service ${serviceKey}: Provider ↓ (${prevProviderRate} → ${newProviderRate}), retail ${newRetailRate} kept same, markup% ${markupUsed}% → ${newMarkup}%`);
            }
          }
        }

        return {
          serviceKey,
          existing,
          basePayload,
          prevProviderRate,
          prevRetailRate,
          newProviderRate,
          newRetailRate: toRate(basePayload.rate),
          currencyConversion,
          providerPriceChanged,  // Original currency comparison
          originalCurrency
        };
      } else {
        // Do NOT auto-insert missing services; we only update existing mapped services
        return null;
      }
    })
  );

  // PHASE 2: Filter out nulls and apply database updates
  console.log('[SERVICE SYNC] Phase 2: Applying database updates in parallel...');
  const updateResults = await Promise.allSettled(
    preparedServices
      .filter(Boolean)
      .map(async (item) => {
        const { serviceKey, existing, basePayload } = item;

        const { error: updateError } = await supabaseAdmin
          .from('services')
          .update(basePayload)
          .eq('id', existing.id);

        return { item, updateError };
      })
  );

  // PHASE 3: Process results and log price changes
  console.log('[SERVICE SYNC] Phase 3: Logging price changes...');
  const logInserts = [];

  for (const result of updateResults) {
    if (result.status === 'rejected') {
      console.error('[SERVICE SYNC] Update failed:', result.reason);
      continue;
    }

    const { item, updateError } = result.value;
    const { serviceKey, existing, basePayload, prevProviderRate, prevRetailRate, newProviderRate, newRetailRate, currencyConversion, providerPriceChanged } = item;

    if (updateError) {
      console.error('[SERVICE SYNC] Failed to update service', existing.id, updateError);
      if (updateError && updateError.code === 'PGRST102' && loggedFailedPayloads < MAX_LOG_FAILED) {
        try {
          console.error('[SERVICE SYNC] Failed payload (sanitized):', JSON.stringify(basePayload.provider_metadata));
        } catch (e) {
          console.error('[SERVICE SYNC] Failed payload (sanitized) cannot be stringified');
        }
        // persist the failing sanitized payload for offline inspection
        try { appendFailedPayload(provider.id, serviceKey, basePayload.provider_metadata, 'update'); } catch (_) {}
        loggedFailedPayloads += 1;
      }
    } else {
      updated += 1;

      // Log price changes - use original currency comparison to avoid false positives from exchange rates
      // Only log when ACTUAL provider price changed (not just exchange rate fluctuation)
      const retailChanged = prevRetailRate !== newRetailRate;
      
      if ((providerPriceChanged || retailChanged) && newProviderRate !== null && newRetailRate !== null) {
        // Determine which strategy was applied
        let strategyApplied = 'no_change';
        if (providerPriceChanged && basePayload.markup_percentage !== null) {
          strategyApplied = newProviderRate > prevProviderRate ? 'provider_increase_markup_fixed' : 'provider_decrease_retail_fixed';
        } else if (!providerPriceChanged && retailChanged) {
          strategyApplied = 'retail_manual_adjustment';
        } else if (providerPriceChanged && !retailChanged) {
          strategyApplied = 'provider_change_no_retail_adjustment';
        }
        
        logInserts.push({
          service_id: existing.id,
          provider_id: provider.id,
          provider_service_id: serviceKey,
          old_provider_rate: prevProviderRate,
          new_provider_rate: newProviderRate,
          old_retail_rate: prevRetailRate,
          new_retail_rate: newRetailRate,
          markup_used: basePayload.markup_percentage,
          strategy_applied: strategyApplied,
          detected_at: new Date().toISOString(),
          currency_conversion_info: currencyConversion
        });

        changeEvents.push({
          service_id: existing.id,
          provider_service_id: serviceKey,
          old_provider_rate: prevProviderRate,
          new_provider_rate: newProviderRate,
          old_retail_rate: prevRetailRate,
          new_retail_rate: newRetailRate,
          markup_used: basePayload.markup_percentage,
          strategy_applied: strategyApplied,
          currency_conversion: currencyConversion
        });
      }
    }
  }

  // Batch insert all price change logs
  if (logInserts.length > 0) {
    const { error: logError } = await supabaseAdmin
      .from('price_change_logs')
      .insert(logInserts);

    if (logError) {
      console.error('[SERVICE SYNC] Failed to log price changes:', logError);
    } else {
      console.log(`[SERVICE SYNC] Logged ${logInserts.length} price change events`);
    }
  }

  const missingIds = (existingServices || [])
    .filter((row) => row.provider_service_id && !seenProviderIds.has(String(row.provider_service_id)))
    .map((row) => row.id);

  let deactivated = 0;
  if (missingIds.length > 0) {
    const { error: deactivateError } = await supabaseAdmin
      .from('services')
      .update({ status: 'inactive' })
      .in('id', missingIds);

    if (deactivateError) {
      console.error('[SERVICE SYNC] Failed to deactivate missing services:', deactivateError);
    } else {
      deactivated = missingIds.length;
    }
  }

  const { error: providerUpdateError } = await supabaseAdmin
    .from('providers')
    .update({
      services_count: services.length,
      last_sync: new Date().toISOString(),
      response_latency_ms: latencyMs,
      health_status: 'online'
    })
    .eq('id', provider.id);

  if (providerUpdateError) {
    console.error('[SERVICE SYNC] Failed to update provider metadata', provider.id, providerUpdateError);
  }

  return {
    added,
    updated,
    deactivated,
    total: services.length,
    changes: changeEvents
  };
}

exports.syncProviderServices = syncProviderServices;

exports.handler = async (event = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const runAt = event.headers?.['x-netlify-schedule-run-at'] || new Date().toISOString();
  const targetProviderId = event.queryStringParameters?.providerId;
  const alertsEnabled = String(process.env.ALERT_EMAIL_ENABLED || '').toLowerCase() === 'true';
  const alertRecipientsRaw = process.env.ALERT_EMAIL_RECIPIENTS || '';
  const alertRecipients = alertRecipientsRaw.split(',').map(s => s.trim()).filter(Boolean);
  const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
  const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
  const SMTP_USER = process.env.SMTP_USER || '';
  const SMTP_PASS = process.env.SMTP_PASS || '';
  const SMTP_FROM = process.env.ALERT_EMAIL_FROM || (SMTP_USER ? `BOTZZZ773 Alerts <${SMTP_USER}>` : 'BOTZZZ773 Alerts <alerts@botzzz773.local>');

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
  });

  async function sendEmail(subject, html, text) {
    if (!alertsEnabled) return { sent: false, reason: 'alerts disabled' };
    const recipients = alertRecipients.length ? alertRecipients : (SMTP_USER ? [SMTP_USER] : []);
    if (!recipients.length) return { sent: false, reason: 'no recipients' };

    try {
      const info = await transporter.sendMail({
        from: SMTP_FROM,
        to: recipients,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, ' ')
      });
      return { sent: true, id: info.messageId };
    } catch (e) {
      console.warn('[ALERT EMAIL] send failed', e && e.message ? e.message : e);
      return { sent: false, error: e?.message };
    }
  }

  try {
    const pricingEngine = await getPricingEngine();
    let query = supabaseAdmin
      .from('providers')
      .select('id, name, api_url, api_key, status, markup')
      .eq('status', 'active');

    if (targetProviderId) {
      query = query.eq('id', targetProviderId);
    }

    const { data: providers, error } = await query;

    if (error) {
      throw new Error(`Failed to load providers: ${error.message}`);
    }

    if (!providers || providers.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ runAt, providersProcessed: 0, results: [] })
      };
    }

    const results = [];

    for (const provider of providers) {
      try {
        const summary = await syncProviderServices(provider, { pricingEngine });
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          success: true,
          ...summary
        });
        if (alertsEnabled && Array.isArray(summary.changes) && summary.changes.length > 0) {
          const rowsHtml = summary.changes.slice(0, 50).map((c) => `
            <tr>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.service_id}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.provider_service_id || ''}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.old_provider_rate}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.new_provider_rate}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.old_retail_rate}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.new_retail_rate}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.markup_used ?? ''}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${c.strategy_applied || ''}</td>
            </tr>
          `).join('');

          const html = `
            <div>
              <h3>Fiyat Değişiklikleri Tespit Edildi · ${provider.name}</h3>
              <p>Çalıştırma zamanı: ${runAt}</p>
              <p>Toplam değişiklik: <strong>${summary.changes.length}</strong></p>
              <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:900px;">
                <thead>
                  <tr style="text-align:left;background:#f6f7f9;">
                    <th style="padding:6px 8px;">Service ID</th>
                    <th style="padding:6px 8px;">Provider SID</th>
                    <th style="padding:6px 8px;">Old Prov</th>
                    <th style="padding:6px 8px;">New Prov</th>
                    <th style="padding:6px 8px;">Old Retail</th>
                    <th style="padding:6px 8px;">New Retail</th>
                    <th style="padding:6px 8px;">Markup%</th>
                    <th style="padding:6px 8px;">Strategy</th>
                  </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
              </table>
              ${summary.changes.length > 50 ? `<p>… ve ${summary.changes.length - 50} daha</p>` : ''}
            </div>`;
          const subject = `[BOTZZZ773] ${provider.name} – ${summary.changes.length} fiyat değişimi`;
          await sendEmail(subject, html);
        }
      } catch (syncError) {
        console.error('[SERVICE SYNC] Provider sync failed', provider.id, syncError);
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          success: false,
          error: syncError.message
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ runAt, providersProcessed: providers.length, results })
    };
  } catch (error) {
    console.error('[SERVICE SYNC] Scheduled sync failed:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Service sync failed', message: error.message })
    };
  }
};
