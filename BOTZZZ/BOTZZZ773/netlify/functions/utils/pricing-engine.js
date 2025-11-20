const { supabaseAdmin } = require('./supabase');

const DEFAULT_TARGET_MARKUP = Number(process.env.DEFAULT_TARGET_MARKUP_PERCENT || 22.5);
const DEFAULT_MIN_MARKUP = Number(process.env.DEFAULT_MIN_MARKUP_PERCENT || 12);
const PRICING_CACHE_MS = Number(process.env.PRICING_RULE_CACHE_MS || 60_000);

let cachedEngine = null;
let cacheExpiry = 0;

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeCategory(category) {
  if (category === undefined || category === null) {
    return null;
  }

  const trimmed = String(category).trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function specificityScore(rule) {
  let score = 0;
  if (rule.provider_id) score += 2;
  if (rule.category_slug) score += 1;
  return score;
}

function buildEngine(rules = []) {
  const normalizedRules = rules
    .map((rule) => ({
      id: rule.id,
      name: rule.name,
      priority: Number.isFinite(rule.priority) ? rule.priority : 100,
      provider_id: rule.provider_id || null,
      category_slug: normalizeCategory(rule.category_slug || rule.category),
      min_markup_percent: toNumber(rule.min_markup_percent),
      target_markup_percent: toNumber(rule.target_markup_percent),
      max_markup_percent: toNumber(rule.max_markup_percent),
      retail_floor: toNumber(rule.retail_floor),
      retail_ceiling: toNumber(rule.retail_ceiling)
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return specificityScore(b) - specificityScore(a);
    });

  function pickRule(providerId, categoryKey) {
    if (normalizedRules.length === 0) {
      return null;
    }

    return normalizedRules.find((rule) => {
      const providerMatch = !rule.provider_id || (providerId && rule.provider_id === providerId);
      const categoryMatch = !rule.category_slug || (categoryKey && rule.category_slug === categoryKey);
      return providerMatch && categoryMatch;
    });
  }

  function calculate({ providerId, category, providerRate, providerMarkup }) {
    const cost = toNumber(providerRate);
    if (cost === null || cost <= 0) {
      return null;
    }

    const categoryKey = normalizeCategory(category);
    const rule = pickRule(providerId || null, categoryKey);
    const fallbackMarkup = toNumber(providerMarkup) ?? DEFAULT_TARGET_MARKUP;
    let targetMarkup = toNumber(rule?.target_markup_percent) ?? fallbackMarkup;
    const minMarkup = toNumber(rule?.min_markup_percent) ?? DEFAULT_MIN_MARKUP;
    const maxMarkup = toNumber(rule?.max_markup_percent);

    if (targetMarkup < minMarkup) {
      targetMarkup = minMarkup;
    }

    if (maxMarkup !== null && targetMarkup > maxMarkup) {
      targetMarkup = maxMarkup;
    }

    let retail = cost * (1 + targetMarkup / 100);

    if (rule?.retail_floor !== null && retail < rule.retail_floor) {
      retail = rule.retail_floor;
      targetMarkup = ((retail - cost) / cost) * 100;
    }

    if (rule?.retail_ceiling !== null && retail > rule.retail_ceiling) {
      retail = rule.retail_ceiling;
      targetMarkup = ((retail - cost) / cost) * 100;
    }

    return {
      retailRate: Number(retail.toFixed(4)),
      markupPercentage: Number(targetMarkup.toFixed(2)),
      ruleId: rule?.id || null,
      ruleName: rule?.name || null
    };
  }

  return { calculate };
}

async function fetchPricingRules() {
  const { data, error } = await supabaseAdmin
    .from('pricing_rules')
    .select('*')
    .eq('status', 'active')
    .order('priority', { ascending: true });

  if (error) {
    console.error('[PRICING ENGINE] Failed to load pricing rules:', error);
    return [];
  }

  return data || [];
}

async function reloadEngine() {
  const rules = await fetchPricingRules();
  cachedEngine = buildEngine(rules);
  cacheExpiry = Date.now() + PRICING_CACHE_MS;
  return cachedEngine;
}

async function getPricingEngine() {
  const now = Date.now();
  if (cachedEngine && now < cacheExpiry) {
    return cachedEngine;
  }
  return reloadEngine();
}

function invalidatePricingEngineCache() {
  cachedEngine = null;
  cacheExpiry = 0;
}

module.exports = {
  getPricingEngine,
  invalidatePricingEngineCache,
  DEFAULT_MIN_MARKUP,
  DEFAULT_TARGET_MARKUP
};
