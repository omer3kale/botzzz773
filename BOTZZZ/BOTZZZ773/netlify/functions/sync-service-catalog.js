const axios = require('axios');
const nodemailer = require('nodemailer');
const { supabaseAdmin } = require('./utils/supabase');
const { getPricingEngine } = require('./utils/pricing-engine');
const { convertToUSD } = require('./utils/currency-converter');
const { createLogger, serializeError } = require('./utils/logger');
const { logPaymentNotification, logPriceChangeNotification } = require('./notification-logger');
const fs = require('fs');
const path = require('path');

const logger = createLogger('service-catalog-sync');

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

  // Check if this is smmzz.com provider - will be used throughout this function
  const isSmmzz = provider.name?.toLowerCase().includes('smmzz');

  const pricingEngine = options.pricingEngine || await getPricingEngine();
  const { services, latencyMs } = await fetchProviderServices(provider);

  // Provider'ın currency ayarını al (çoğu provider TRY kullanıyor)
  const providerCurrency = provider.currency || 'USD';
  console.log(`[SERVICE SYNC] Provider ${provider.name} (ID: ${provider.id}) currency: ${providerCurrency} (from provider.currency: ${provider.currency})`);
  console.log(`[SERVICE SYNC] Starting sync of ${services.length} services from provider...`);

  const { data: existingServices, error: existingError } = await supabaseAdmin
    .from('services')
    .select('id, provider_service_id, status, markup_percentage, provider_rate, provider_rate_raw, provider_currency, rate, name, category, description, min_quantity, max_quantity, provider_metadata')
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
        // NOTE: refill, cancel, dripfeed, subscription flags are NOT synced - they must be manually configured
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
      const existing = existingMap.get(serviceKey);
      
      // Smart provider_rate update strategy
      // Preserve existing provider_rate if user has manually set it via metadata
      let shouldPreserveProviderRate = false;
      if (existing && existing.provider_metadata && existing.provider_metadata._currency_conversion) {
        const existingConversion = existing.provider_metadata._currency_conversion;
        const existingRate = toRate(existing.provider_rate);
        const newRate = providerCost;
        
        if (serviceKey === '9086') {
          console.log(`[DEBUG 9086] existingRate: ${existingRate}, newRate: ${newRate}`);
        }
        
        // Check if existing rate differs significantly from what sync would set
        // If it does, user probably manually overrode it - preserve it!
        if (existingRate !== null && newRate !== null) {
          const rateDiff = Math.abs(existingRate - newRate);
          // If difference > 0.001, user likely manually set this rate
          if (rateDiff > 0.001) {
            shouldPreserveProviderRate = true;
            console.log(`[SERVICE SYNC] Service ${serviceKey}: Preserving manual provider_rate ${existingRate} (differs from sync ${newRate} by ${rateDiff})`);
          }
        } else if (existingRate !== null && newRate === null) {
          // New sync has no rate but existing has one - preserve it
          shouldPreserveProviderRate = true;
          console.log(`[SERVICE SYNC] Service ${serviceKey}: Preserving manual provider_rate ${existingRate} (sync returned null)`);
        }
      } else {
        if (serviceKey === '9086') {
          console.log(`[DEBUG 9086] No metadata or existing: existing=${!!existing}, metadata=${existing?.provider_metadata ? 'yes' : 'no'}, conversion=${existing?.provider_metadata?._currency_conversion ? 'yes' : 'no'}`);
        }
      }
      
      if (providerCost !== null && !shouldPreserveProviderRate) {
        basePayload.provider_rate = providerCost;
      } else if (existing && shouldPreserveProviderRate) {
        basePayload.provider_rate = existing.provider_rate;
      }

      // Always store raw rate (before USD conversion) and its currency
      // Used for accurate price change detection without FX fluctuation noise
      if (rate !== null) {
        basePayload.provider_rate_raw = rate;
        basePayload.provider_currency = currency;
      }
      
      // PRICE CHANGE DETECTION - SIMPLIFIED for smmzz.com
      // smmzz.com has conversion issues, so just compare raw rates
      // Other providers use standard comparison
      let prevOriginalAmount = null;
      let newOriginalAmount = rate;
      let originalCurrency = currency;
      let providerPriceChanged = false;
      
      if (existing) {
        if (isSmmzz) {
          // smmzz.com: Only compare raw provider_rate, ignore conversion complexity
          const prevRate = existing.provider_rate !== null ? Number(existing.provider_rate) : null;
          const newRate = providerCost !== null ? Number(providerCost) : null;
          
          console.log(`[SMMZZ DEBUG] Service: ${existing.name}`);
          console.log(`[SMMZZ DEBUG] existing.provider_rate (raw): "${existing.provider_rate}" (type: ${typeof existing.provider_rate})`);
          console.log(`[SMMZZ DEBUG] providerCost (raw): "${providerCost}" (type: ${typeof providerCost})`);
          console.log(`[SMMZZ DEBUG] After Number(): prevRate=${prevRate}, newRate=${newRate}`);
          
          if (prevRate !== null && newRate !== null) {
            const prev4dp = Math.round(prevRate * 10000) / 10000;
            const new4dp = Math.round(newRate * 10000) / 10000;
            providerPriceChanged = (prev4dp !== new4dp);
            console.log(`[SMMZZ DEBUG] 4dp: ${prev4dp} vs ${new4dp} = ${providerPriceChanged}`);
          } else if (prevRate === null && newRate === null) {
            providerPriceChanged = false;
            console.log(`[SMMZZ DEBUG] Both null`);
          } else {
            providerPriceChanged = true;
            console.log(`[SMMZZ DEBUG] Null mismatch`);
          }
          
          // FORCE: Always set to false for smmzz.com to prevent false positives
          // The comparison above is just for logging - the actual result is always false
          providerPriceChanged = false;
          console.log(`[SMMZZ DEBUG] FORCED RESULT: providerPriceChanged = false`);
        } else {
          // Other providers: Compare RAW rates (before USD conversion)
          // This avoids false positives from FX fluctuations for non-USD providers
          const hasRawRate = existing.provider_rate_raw !== null && existing.provider_rate_raw !== undefined;
          const sameCurrency = !existing.provider_currency || existing.provider_currency === currency;

          if (hasRawRate && sameCurrency) {
            // Compare raw provider rate (e.g. BRL price vs stored BRL price)
            const prevRaw = Number(existing.provider_rate_raw);
            const newRaw = rate !== null ? Number(rate) : null;
            if (newRaw !== null) {
              const prev6dp = Math.round(prevRaw * 1000000) / 1000000;
              const new6dp = Math.round(newRaw * 1000000) / 1000000;
              providerPriceChanged = (prev6dp !== new6dp);
            }
          } else {
            // Fallback: compare USD-converted rate (for rows without raw rate yet)
            const prevRate = existing.provider_rate !== null ? Number(existing.provider_rate) : null;
            const newRate = providerCost !== null ? Number(providerCost) : null;
            if (prevRate !== null && newRate !== null) {
              const prev4dp = Math.round(prevRate * 10000) / 10000;
              const new4dp = Math.round(newRate * 10000) / 10000;
              providerPriceChanged = (prev4dp !== new4dp);
            } else if (prevRate !== null || newRate !== null) {
              providerPriceChanged = true;
            }
          }

          if (providerPriceChanged) {
            console.log(`[PRICE DETECT] Service ${serviceKey}: Provider rate changed (raw: ${existing.provider_rate_raw} → ${rate}, currency: ${currency})`);
          }
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
        // Preserve existing rate if provider_rate is being preserved (fixed prices)
        if (shouldPreserveProviderRate && existing && existing.rate) {
          basePayload.rate = existing.rate;
          basePayload.retail_rate = existing.rate;
          console.log(`[SERVICE SYNC] Service ${serviceKey}: Preserved existing rate ${existing.rate} (shouldPreserveProviderRate=true)`);
        } else {
          basePayload.rate = retailRate;
          basePayload.retail_rate = retailRate;
        }
      }

      if (existing) {
        // Preserve currency conversion metadata if provider_rate was manually overridden
        if (shouldPreserveProviderRate && existing.provider_metadata && existing.provider_metadata._currency_conversion) {
          basePayload.provider_metadata = {
            ...basePayload.provider_metadata,
            _currency_conversion: existing.provider_metadata._currency_conversion
          };
          console.log(`[SERVICE SYNC] Service ${serviceKey}: Preserved metadata currency conversion`);
        }
        
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
            // Keep retail price AND markup% unchanged. Just alert.
            if (prevRetailRate !== null) {
              newRetailRate = prevRetailRate;
              basePayload.rate = prevRetailRate;
              basePayload.retail_rate = prevRetailRate;
            }
            if (existing && existing.markup_percentage !== null && existing.markup_percentage !== undefined) {
              basePayload.markup_percentage = Number(existing.markup_percentage);
            }
            console.log(`[MARKUP STRATEGY] Service ${serviceKey}: Provider ↓ (${prevProviderRate} → ${newProviderRate}), retail ${prevRetailRate} KEPT SAME, markup% ${basePayload.markup_percentage}% KEPT SAME`);
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
      // Use tolerance for floating point comparison to avoid false positives from precision errors
      const tolerance = 0.01; // 1 cent tolerance for floating point precision issues
      let retailChanged = prevRetailRate !== null && newRetailRate !== null && Math.abs(newRetailRate - prevRetailRate) > tolerance;
      
      console.log(`[ALERT LOGIC] Service: ${existing?.name}, isSmmzz=${isSmmzz}`);
      console.log(`[ALERT LOGIC] Before override: providerPriceChanged=${providerPriceChanged}, retailChanged=${retailChanged}`);
      console.log(`[ALERT LOGIC] Rates: newProviderRate=${newProviderRate}, newRetailRate=${newRetailRate}`);
      
      // For smmzz.com, ignore retailChanged too (currency conversion causes false positives)
      if (isSmmzz) {
        retailChanged = false;
        console.log(`[ALERT LOGIC] smmzz.com detected - setting retailChanged to false`);
      }
      
      console.log(`[ALERT LOGIC] Final: providerPriceChanged=${providerPriceChanged}, retailChanged=${retailChanged}`);
      console.log(`[ALERT LOGIC] Condition: (${providerPriceChanged} || ${retailChanged}) && ${newProviderRate !== null} && ${newRetailRate !== null} = ${(providerPriceChanged || retailChanged) && newProviderRate !== null && newRetailRate !== null}`);
      
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
          provider_id: provider.id,
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

  async function loadNotificationSettings() {
    try {
      const { data, error } = await supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', 'notification')
        .single();
      
      if (error || !data) {
        return { priceAlertEnabled: false };
      }
      
      const notification = typeof data.value === 'string' 
        ? JSON.parse(data.value) 
        : data.value;
      
      return {
        priceAlertEnabled: notification?.priceChangeAlertEnabled !== false,
        smtpHost: notification?.smtpHost || process.env.SMTP_HOST,
        smtpPort: Number(notification?.smtpPort || process.env.SMTP_PORT || 587),
        smtpUser: notification?.smtpUser || notification?.smtpUsername || process.env.SMTP_USER,
        smtpPass: notification?.smtpPass || notification?.smtpPassword || process.env.SMTP_PASS,
        smtpFromAddress: notification?.smtpFromAddress || notification?.smtpFrom || process.env.SMTP_FROM || 'noreply@botzzz773.com'
      };
    } catch (err) {
      console.warn('[PRICE ALERT] Failed to load notification settings', err);
      return { priceAlertEnabled: false };
    }
  }

  async function loadAdminEmail() {
    try {
      const { data, error } = await supabaseAdmin
        .from('settings')
        .select('value')
        .eq('key', 'general')
        .single();
      
      if (error || !data) {
        return process.env.ADMIN_EMAIL || 'admin@botzzz773.com';
      }
      
      const general = typeof data.value === 'string' 
        ? JSON.parse(data.value) 
        : data.value;
      
      return general?.adminEmail || process.env.ADMIN_EMAIL || 'admin@botzzz773.com';
    } catch (err) {
      return process.env.ADMIN_EMAIL || 'admin@botzzz773.com';
    }
  }

  async function sendPriceChangeAlert(allChanges, smtpSettings, adminEmail) {
    if (!allChanges || allChanges.length === 0 || !smtpSettings.priceAlertEnabled) {
      return { sent: false, reason: 'No changes or alerts disabled' };
    }

    try {
      const { smtpHost, smtpPort, smtpUser, smtpPass, smtpFromAddress } = smtpSettings;
      
      if (!smtpHost) {
        console.warn('[PRICE ALERT] SMTP host not configured');
        return { sent: false, reason: 'SMTP not configured' };
      }

      const isLocalhost = smtpHost.toLowerCase().includes('localhost') || smtpHost === '127.0.0.1';
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: isLocalhost ? false : (smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined),
        connectionTimeout: 5000,
        socketTimeout: 5000
      });

      // Build table rows for price changes
      const tableRows = allChanges
        .slice(0, 50)
        .map(change => `
          <tr style="background: ${change._index % 2 === 0 ? '#1a1a1a' : '#0a0a0a'}; border-bottom: 1px solid #2a2a2a;">
            <td style="padding: 12px 15px; color: #E0E0E0; font-size: 13px; border-right: 1px solid #2a2a2a;">${change.providerName || 'N/A'}</td>
            <td style="padding: 12px 15px; color: #E0E0E0; font-size: 13px; border-right: 1px solid #2a2a2a;">${change.serviceName || change.service_id}</td>
            <td style="padding: 12px 15px; color: #B0B0B0; font-size: 13px; border-right: 1px solid #2a2a2a;">$${parseFloat(change.old_provider_rate || 0).toFixed(4)}</td>
            <td style="padding: 12px 15px; color: #FF69B4; font-size: 13px; font-weight: 600; border-right: 1px solid #2a2a2a;">$${parseFloat(change.new_provider_rate || 0).toFixed(4)}</td>
            <td style="padding: 12px 15px; color: #B0B0B0; font-size: 13px; border-right: 1px solid #2a2a2a;">$${parseFloat(change.old_retail_rate || 0).toFixed(4)}</td>
            <td style="padding: 12px 15px; color: #FF69B4; font-size: 13px; font-weight: 600; border-right: 1px solid #2a2a2a;">$${parseFloat(change.new_retail_rate || 0).toFixed(4)}</td>
            <td style="padding: 12px 15px; color: #FFD700; font-size: 13px;">+${change.markup_used || 0}%</td>
          </tr>
        `)
        .map((row, idx) => row.replace('_index % 2', idx + ' % 2'))
        .join('');

      const emailSubject = `🔔 Price Changes Detected - ${allChanges.length} Service(s)`;

      const emailBody = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #0a0a0a; padding: 0; margin: 0;">
  <!-- Top Accent -->
  <div style="background: linear-gradient(90deg, #FF1494 0%, #FF69B4 50%, #FF1494 100%); height: 3px;"></div>
  
  <div style="background: #0a0a0a; padding: 30px 20px; color: #E0E0E0; max-width: 800px; margin: 0 auto;">
    
    <!-- Header with Gradient -->
    <div style="background: linear-gradient(135deg, #FF1494 0%, #FF69B4 100%); padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
      <h1 style="margin: 0; color: #FFFFFF; font-size: 24px; font-weight: 800;">💰 PRICE CHANGES DETECTED</h1>
      <p style="margin: 8px 0 0 0; color: #F0F0F0; font-size: 14px; font-weight: 500;">Service Catalog Sync Report</p>
    </div>
    
    <!-- Summary -->
    <div style="background: #1a1a1a; padding: 20px; border-bottom: 1px solid #333;">
      <p style="margin: 0 0 8px 0; color: #FF1494; font-size: 13px; font-weight: 700;">⚡ SUMMARY</p>
      <p style="margin: 0; color: #B0B0B0; font-size: 13px; line-height: 1.6;">
        <strong style="color: #E0E0E0;">${allChanges.length}</strong> service(s) have price changes. Review changes below and update your listings accordingly.
      </p>
    </div>
    
    <!-- Changes Table -->
    <table style="width: 100%; border-collapse: collapse; background: #0a0a0a; margin: 20px 0;">
      <thead>
        <tr style="background: #FF1494; color: #FFFFFF;">
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700; border-right: 1px solid #E0E0E0;">PROVIDER</th>
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700; border-right: 1px solid #E0E0E0;">SERVICE</th>
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700; border-right: 1px solid #E0E0E0;">OLD COST</th>
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700; border-right: 1px solid #E0E0E0;">NEW COST</th>
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700; border-right: 1px solid #E0E0E0;">OLD PRICE</th>
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700; border-right: 1px solid #E0E0E0;">NEW PRICE</th>
          <th style="padding: 12px 15px; text-align: left; font-size: 12px; font-weight: 700;">MARGIN</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    
    ${allChanges.length > 50 ? `<p style="color: #FF69B4; font-size: 13px; margin: 15px 0;">… and ${allChanges.length - 50} more changes</p>` : ''}
    
    <!-- Action Steps -->
    <div style="margin-top: 25px; padding: 20px; background: linear-gradient(135deg, rgba(255, 20, 148, 0.1) 0%, rgba(255, 105, 180, 0.05) 100%); border: 1px solid #FF1494; border-radius: 6px;">
      <h4 style="margin: 0 0 12px 0; color: #FF1494; font-size: 14px; font-weight: 700;">NEXT STEPS:</h4>
      <ul style="margin: 0; padding-left: 20px; color: #B0B0B0; font-size: 13px; line-height: 1.8;">
        <li style="margin-bottom: 8px;">Review all price changes in the table above</li>
        <li style="margin-bottom: 8px;">Update your service prices if needed</li>
        <li style="margin-bottom: 0;">Ensure profit margins are maintained</li>
      </ul>
    </div>
    
    <!-- Footer -->
    <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #333; text-align: center; font-size: 11px; color: #666;">
      <p style="margin: 0 0 8px 0;">
        <strong style="color: #FF1494;">BOTZZZ773</strong> | Automated Service Sync
      </p>
      <p style="margin: 0;">
        Generated: ${runAt}
      </p>
    </div>
  </div>
  
  <!-- Bottom Accent -->
  <div style="background: linear-gradient(90deg, #FF1494 0%, #FF69B4 50%, #FF1494 100%); height: 3px;"></div>
</div>
      `.trim();

      const result = await transporter.sendMail({
        from: smtpFromAddress,
        to: adminEmail,
        subject: emailSubject,
        html: emailBody
      });

      console.log('[PRICE ALERT] Email sent', { messageId: result.messageId, changeCount: allChanges.length });
      
      // SEND TELEGRAM ALERT
      const telegramChanges = allChanges
        .slice(0, 10)
        .map(c => `<b>${c.serviceName}</b> (${c.providerName})\n$${c.old_provider_rate?.toFixed(4)} → $${c.new_provider_rate?.toFixed(4)}`)
        .join('\n\n');
      
      const telegramText = `💰 <b>PRICE CHANGES DETECTED</b> (${allChanges.length})
      
${telegramChanges}
${allChanges.length > 10 ? `\n... and ${allChanges.length - 10} more changes` : ''}

<i>Check dashboard for full details</i>`;
      
      try {
        const axios = require('axios');
        const { data: integrationsData } = await supabaseAdmin
          .from('settings')
          .select('value')
          .eq('key', 'integrations')
          .single();
        
        if (integrationsData) {
          const integrations = typeof integrationsData.value === 'string' 
            ? JSON.parse(integrationsData.value) 
            : integrationsData.value;
          
          const token = integrations?.telegramToken || process.env.TELEGRAM_BOT_TOKEN;
          const chatId = integrations?.telegramChatId || process.env.TELEGRAM_CHAT_ID;
          
          if (token && chatId) {
            const url = `https://api.telegram.org/bot${token}/sendMessage`;
            await axios.post(url, {
              chat_id: chatId,
              text: telegramText,
              parse_mode: 'HTML'
            }, { timeout: 10000 });
            console.log('[PRICE ALERT] Telegram sent');
          }
        }
      } catch (telegramErr) {
        console.warn('[PRICE ALERT] Telegram send failed', telegramErr.message);
      }
      
      return { sent: true, messageId: result.messageId, changeCount: allChanges.length };
    } catch (err) {
      console.warn('[PRICE ALERT] Failed to send email', err?.message || err);
      return { sent: false, error: err?.message };
    }
  }

  try {
    const pricingEngine = await getPricingEngine();
    const smtpSettings = await loadNotificationSettings();
    
    let query = supabaseAdmin
      .from('providers')
      .select('id, name, api_url, api_key, status, markup, currency')
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
        body: JSON.stringify({ runAt, providersProcessed: 0, results: [], priceChangeAlert: { sent: false, reason: 'No providers' } })
      };
    }

    const results = [];
    const allChanges = [];

    console.log(`[PRICE ALERT] Starting sync of ${providers.length} providers`, providers.map(p => ({ id: p.id, name: p.name })));

    for (const provider of providers) {
      try {
        const summary = await syncProviderServices(provider, { pricingEngine });
        console.log(`[PRICE ALERT] Provider ${provider.name}: ${summary.changes?.length || 0} changes detected`);
        results.push({
          providerId: provider.id,
          providerName: provider.name,
          success: true,
          ...summary
        });
        
        // Enrich changes with provider and service names
        if (Array.isArray(summary.changes) && summary.changes.length > 0) {
          // Load service names for enrichment
          const serviceIds = [...new Set(summary.changes.map(c => c.service_id))];
          let servicesMap = new Map();
          
          if (serviceIds.length > 0) {
            const { data: services } = await supabaseAdmin
              .from('services')
              .select('id, name, public_id')
              .in('id', serviceIds);
            
            (services || []).forEach(s => servicesMap.set(s.id, s));
          }
          
          // Add enriched changes to global list
          summary.changes.forEach(change => {
            const service = servicesMap.get(change.service_id);
            allChanges.push({
              ...change,
              providerName: provider.name,
              serviceName: service?.name || change.service_id
            });
          });
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

    // Send bulk price change alert
    let priceChangeAlert = { sent: false, reason: 'No price changes' };
    if (allChanges.length > 0) {
      console.log(`[PRICE ALERT] Total changes collected: ${allChanges.length}`);
      console.log(`[PRICE ALERT] Changes by provider:`, allChanges.reduce((acc, c) => {
        const key = c.providerName;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}));
      
      // Deduplicate: keep only the latest change for each service
      const deduplicatedChanges = [];
      const seenServices = new Map();
      
      for (let i = allChanges.length - 1; i >= 0; i--) {
        const change = allChanges[i];
        const key = `${change.provider_id}-${change.service_id}`;
        
        if (!seenServices.has(key)) {
          seenServices.set(key, true);
          deduplicatedChanges.unshift(change);  // Add to beginning to maintain order
        }
      }
      
      console.log(`[PRICE ALERT] Deduplicated ${allChanges.length} changes → ${deduplicatedChanges.length} unique changes`);
      
      const adminEmail = await loadAdminEmail();
      priceChangeAlert = await sendPriceChangeAlert(deduplicatedChanges, smtpSettings, adminEmail);

      // Log to admin notification bell
      try {
        await logPriceChangeNotification(deduplicatedChanges);
      } catch (notifErr) {
        console.warn('[PRICE ALERT] Failed to log bell notification:', notifErr.message);
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        runAt, 
        providersProcessed: providers.length, 
        totalPriceChanges: allChanges.length,
        priceChangeAlert,
        results 
      })
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
