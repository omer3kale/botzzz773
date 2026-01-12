const axios = require('axios');

// Cache for exchange rates (in-memory, expires after 24 hours)
const rateCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get exchange rates from Open Exchange Rates API
 * Fallback: Fixed rates if API fails
 */
async function getExchangeRates() {
  const cacheKey = 'exchange_rates';
  const cached = rateCache.get(cacheKey);
  
  // Return cached rates if still valid
  if (cached && Date.now() - cached.fetchedAt < CACHE_DURATION) {
    return cached.rates;
  }

  const apiKey = process.env.OPEN_EXCHANGE_RATES_KEY;
  
  // Fallback rates if no API key configured
  if (!apiKey) {
    const fallbackRates = {
      'USD': 1.0,
      'EUR': 0.92,
      'GBP': 0.79,
      'JPY': 148.50,
      'AUD': 1.53,
      'CAD': 1.36,
      'CHF': 0.88,
      'CNY': 7.24,
      'INR': 90.11,
      'MXN': 17.05,
      'BRL': 4.97,
      'ZAR': 18.65,
      'SGD': 1.35,
      'HKD': 7.84,
      'NZD': 1.69,
      'SEK': 10.35,
      'NOK': 10.50,
      'KRW': 1319.45,
      'RUB': 102.5,
      'AED': 3.67,
      'SAR': 3.75,
      'TRY': 32.45,
      'BDT': 117.50,
      'PKR': 278.50,
      'LKR': 334.50,
      'PHP': 56.75,
      'THB': 35.50,
      'MYR': 4.73,
      'IDR': 16250.00,
      'VND': 24500.00
    };
    
    console.log('[CURRENCY] Using fallback exchange rates (no OPEN_EXCHANGE_RATES_KEY configured)');
    return fallbackRates;
  }

  try {
    const response = await axios.get('https://openexchangerates.org/api/latest.json', {
      params: {
        app_id: apiKey,
        base: 'USD'
      },
      timeout: 10000
    });

    if (response.data && response.data.rates) {
      const rates = {
        'USD': 1.0,
        ...response.data.rates
      };
      
      // Cache the rates
      rateCache.set(cacheKey, {
        rates,
        fetchedAt: Date.now()
      });

      console.log('[CURRENCY] Exchange rates fetched successfully from Open Exchange Rates API');
      return rates;
    }
  } catch (error) {
    console.warn('[CURRENCY] Failed to fetch exchange rates from API, using fallback:', error.message);
  }

  // Return fallback rates if API fails
  const fallbackRates = {
    'USD': 1.0,
    'EUR': 0.92,
    'GBP': 0.79,
    'JPY': 148.50,
    'AUD': 1.53,
    'CAD': 1.36,
    'CHF': 0.88,
    'CNY': 7.24,
    'INR': 90.11,
    'MXN': 17.05,
    'BRL': 4.97,
    'ZAR': 18.65,
    'SGD': 1.35,
    'HKD': 7.84,
    'NZD': 1.69,
    'SEK': 10.35,
    'NOK': 10.50,
    'KRW': 1319.45,
    'RUB': 102.5,
    'AED': 3.67,
    'SAR': 3.75,
    'TRY': 32.45,
    'BDT': 117.50,
    'PKR': 278.50,
    'LKR': 334.50,
    'PHP': 56.75,
    'THB': 35.50,
    'MYR': 4.73,
    'IDR': 16250.00,
    'VND': 24500.00
  };

  console.log('[CURRENCY] Using fallback exchange rates');
  return fallbackRates;
}

/**
 * Convert amount from source currency to USD
 * @param {number} amount - The amount to convert
 * @param {string} fromCurrency - Source currency code (e.g., 'EUR')
 * @returns {Promise<{usdAmount: number, originalAmount: number, originalCurrency: string, rate: number, converted: boolean}>}
 */
async function convertToUSD(amount, fromCurrency) {
  // Validate inputs
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return {
      usdAmount: null,
      originalAmount: numAmount,
      originalCurrency: String(fromCurrency || 'USD').toUpperCase(),
      rate: null,
      converted: false,
      error: 'Invalid amount'
    };
  }

  const normalizedCurrency = String(fromCurrency || 'USD').toUpperCase().trim();

  // If already USD, no conversion needed
  if (normalizedCurrency === 'USD') {
    return {
      usdAmount: numAmount,
      originalAmount: numAmount,
      originalCurrency: 'USD',
      rate: 1.0,
      converted: false
    };
  }

  try {
    const rates = await getExchangeRates();
    const exchangeRate = rates[normalizedCurrency];

    if (!exchangeRate) {
      console.warn(`[CURRENCY] Exchange rate not found for ${normalizedCurrency}, treating as USD`);
      return {
        usdAmount: numAmount,
        originalAmount: numAmount,
        originalCurrency: normalizedCurrency,
        rate: null,
        converted: false,
        warning: `No exchange rate for ${normalizedCurrency}`
      };
    }

    // Convert: amount in foreign currency / exchange rate = amount in USD
    // (e.g., 100 EUR / 0.92 = 108.7 USD)
    const usdAmount = Number((numAmount / exchangeRate).toFixed(4));

    return {
      usdAmount,
      originalAmount: numAmount,
      originalCurrency: normalizedCurrency,
      rate: exchangeRate,
      converted: true
    };
  } catch (error) {
    console.error('[CURRENCY] Conversion error:', error.message);
    return {
      usdAmount: null,
      originalAmount: numAmount,
      originalCurrency: normalizedCurrency,
      rate: null,
      converted: false,
      error: error.message
    };
  }
}

/**
 * Clear the exchange rate cache (useful for testing or manual refresh)
 */
function clearCache() {
  rateCache.clear();
  console.log('[CURRENCY] Exchange rate cache cleared');
}

module.exports = {
  convertToUSD,
  getExchangeRates,
  clearCache
};
