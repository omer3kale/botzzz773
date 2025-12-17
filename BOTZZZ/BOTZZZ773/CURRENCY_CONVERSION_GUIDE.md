# Currency Conversion Feature - Implementation Guide

## Overview

Service sync işleminde provider'dan gelen fiyatlar farklı para birimlerinde olabilir (EUR, GBP, JPY vs.). Bu feature, bu fiyatları otomatik olarak USD'ye çevirip sisteme kaydeder.

## How It Works

### 1. Exchange Rate Fetching

**Currency Converter Utility** (`netlify/functions/utils/currency-converter.js`):
- Open Exchange Rates API'dan döviz kurları alır
- 24 saat cache'lenir (performans için)
- API başarısız olursa fallback oranlar kullanılır
- 30+ currency destekler

**Fallback Rates** (API key'siz de çalışır):
```
USD: 1.0
EUR: 0.92
GBP: 0.79
JPY: 148.50
AUD: 1.53
... ve 25+ daha
```

### 2. Service Sync Entegrasyonu

**sync-service-catalog.js**'de entegre edildi:

```javascript
// Provider'dan gelen currency
const currencyRaw = payload.currency ?? payload.price_currency ?? 'USD';
const currency = normalizeCurrency(currencyRaw, 'USD');

// AUTO-CONVERT eğer USD değilse
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
  }
}

// Database'ye her zaman USD olarak kaydedilir
basePayload.provider_rate = providerCostUSD;
basePayload.currency = 'USD';
```

### 3. Data Logging

**provider_metadata'ya kaydedilir:**
```json
{
  "_currency_conversion": {
    "originalAmount": 50,
    "originalCurrency": "EUR",
    "usdAmount": 54.35,
    "exchangeRate": 0.92
  }
}
```

**price_change_logs'a kaydedilir:**
```javascript
{
  service_id,
  provider_id,
  old_provider_rate,     // Önceki fiyat (USD)
  new_provider_rate,     // Yeni fiyat (USD) - dönüştürülmüş
  currency_conversion_info, // Dönüşüm detayları
  strategy_applied,
  detected_at
}
```

## Configuration

### Environment Variables

**OPEN_EXCHANGE_RATES_KEY** (opsiyonel):
```bash
# Netlify dashboard'da ayarla veya .env dosyasına ekle
OPEN_EXCHANGE_RATES_KEY=your_api_key_here
```

- Ücretsiz API key'i [openexchangerates.org](https://openexchangerates.org) adresinden al
- Ayarlanmadığında fallback oranlar otomatik kullanılır
- 1000+ API çağrısı/ay free plan'da mevcut

### Fallback Stratejisi

API key'siz bile sistem çalışır:
1. API başarısız → Fallback oranlar kullanılır
2. Bilinmeyen currency → USD olarak ele alınır (log'a kaydedilir)
3. Invalid amount → null değeri atlanır

## Use Cases

### Use Case 1: EUR Gelen Provider
```
Provider API'den gelen:
{
  service_id: "1001",
  price: 50,
  currency: "EUR"
}

Sistem tarafından işlenen:
{
  service_id: "1001",
  provider_rate: 54.35,      // EUR 50 → USD 54.35 (0.92 kuru ile)
  currency: "USD",
  provider_metadata: {
    _currency_conversion: {
      originalAmount: 50,
      originalCurrency: "EUR",
      usdAmount: 54.35,
      exchangeRate: 0.92
    }
  }
}
```

### Use Case 2: Fiyat Değişikliği ile Döviz Değişimi
```
Eski:  EUR 40 = USD 43.48
Yeni:  EUR 45 = USD 48.91

Log'da:
{
  old_provider_rate: 43.48,
  new_provider_rate: 48.91,
  currency_conversion_info: {
    originalAmount: 45,
    originalCurrency: "EUR",
    usdAmount: 48.91,
    exchangeRate: 0.92
  }
}

Döviz kuru değişirse otomatik hesaplanır.
```

### Use Case 3: Bilinmeyen Currency
```
Provider gönderirse: currency: "XYZ"

Sistem:
- Warning log'lar
- Original rate'i USD olarak ele alır
- Provider metadata'ya gerçek currency'sini kaydeder
```

## Testing

### Test Script Çalıştır:
```bash
cd c:\Users\meydo\Desktop\repo\botzzz773\BOTZZZ\BOTZZZ773
node test-currency-converter.js
```

### Test Sonuçları:
```
=== Currency Converter Test Suite ===

Test 1: Fetching exchange rates...
✓ Exchange rates loaded
  - USD: 1
  - EUR: 0.92
  - GBP: 0.79

Test 2: Convert EUR 100 to USD
✓ EUR 100 = USD 108.7
  - Exchange rate used: 0.92
  - Converted: true

Test 3: Convert GBP 50 to USD
✓ GBP 50 = USD 63.29
  - Converted: true

... ve daha fazlası
```

## Database Schema Uyumluluk

### services Tablosu
Yapılacak değişiklik yok! Zaten mevcut:
- `provider_rate` → numeric(10,4) - USD cinsinden
- `currency` → varchar(10) - Şimdi her zaman "USD"
- `provider_metadata` → jsonb - Dönüşüm bilgilerini tutar

### price_change_logs Tablosu
Yeni column eklenebilir (opsiyonel):
```sql
ALTER TABLE price_change_logs
ADD COLUMN currency_conversion_info jsonb;
```

Yoksa provider_metadata'da `_currency_conversion` nested olarak tutulur.

## Döviz Kuru Güncellemeleri

### Caching Strategy
- Döviz kurları 24 saat cache'lenir
- Her 24 saatinde otomatik refresh
- Scheduled sync'ler cache'i kullanır (hız için)

### Manual Cache Clear
```javascript
const { clearCache } = require('./utils/currency-converter');
clearCache();
```

## Performance Impact

### Before Optimization (Serial)
```
1000 services × (100ms convertToUSD + 50ms DB update) = ~150 seconds ❌
```

### After Optimization (Parallel)
```
Phase 1: 1000 services converted in parallel = ~100-500ms (depends on cache)
Phase 2: 1000 DB updates in parallel = ~500-1000ms
Phase 3: Batch insert logs = ~100-200ms
Total: ~1-2 seconds ✅

Speed improvement: 75-150x faster!
```

### Why It's Fast Now

**Phase 1: Parallel Currency Conversion**
```javascript
await Promise.all(
  services.map(async (payload) => {
    // All conversions happen simultaneously
    const conversion = await convertToUSD(rate, currency);
    // ... prepare payload
  })
)
```

**Phase 2: Parallel Database Updates**
```javascript
await Promise.allSettled(
  preparedServices.map(async (item) => {
    // All updates sent to database simultaneously
    await supabaseAdmin.from('services').update(basePayload)
  })
)
```

**Phase 3: Batch Price Change Logging**
```javascript
// Instead of individual inserts
await supabaseAdmin.from('price_change_logs').insert([
  { ... }, // 100 logs
  { ... },
  // ... all at once
])
```

## API Calls

### Per Provider Sync: 1000 services
- **Döviz Conversion:** 1 API call (cached 24h) OR 0 (fallback rates)
- **Database Operations:** 1 parallel batch
- **Total External API:** ~1 call (highly cached)

### Network Cost
- Before: Sequential waits → timeouts possible
- After: Parallel → much more reliable

## Error Handling

### Scenario 1: API Timeout
```javascript
// Fallback oranlar otomatik kullanılır
// Log: "[CURRENCY] Failed to fetch exchange rates..."
```

### Scenario 2: Invalid Amount
```javascript
const result = await convertToUSD('invalid', 'EUR');
// result.error: "Invalid amount"
// result.usdAmount: null
// Sync'e eklenmez
```

### Scenario 3: Unknown Currency
```javascript
const result = await convertToUSD(100, 'XYZ');
// result.warning: "No exchange rate for XYZ"
// result.converted: false
// amount 100 USD olarak ele alınır
```

## Production Deployment

### Önerilen Adımlar:

1. **API Key Alma**
   ```
   https://openexchangerates.org
   → Sign Up (Free plan)
   → Get API Key
   ```

2. **Netlify'da Environment Variable Ayarla**
   ```
   Netlify Dashboard → Site Settings → Build & Deploy → Environment
   → Add Environment Variable
   → Name: OPEN_EXCHANGE_RATES_KEY
   → Value: <your-api-key>
   ```

3. **Veya production.env'de Ayarla**
   ```bash
   OPEN_EXCHANGE_RATES_KEY=your_api_key_here
   
   # Sonra Netlify'a import et
   netlify env:import netlify/env/production.env
   ```

4. **Deploy & Test**
   ```bash
   # Service sync'i trigger et
   # Logs'ta "[SERVICE SYNC] Service 1001: Auto-converted EUR..."
   # ifadesini ara
   ```

## Troubleshooting

### "Exchange rates not found"
→ API key yanlış veya fallback oranlar kullanılıyor
→ Network/timeout sorunu varsa fallback otomatik aktif olur

### "Converting rate is null"
→ Currency code geçersiz
→ Original amount USD olarak tutulur, warning log'lanır

### "Conversion error"
→ Check API rate limit (1000/ay free plan)
→ Check network connection
→ Fallback oranlar devreye girer

## Future Enhancements

1. **Per-Provider Currency Setting**
   - Her provider için expected currency setleyebilmek
   - Auto-validate incoming currency

2. **Historical Exchange Rates**
   - Geçmiş döviz kurlarını loglamak
   - Trend analizi

3. **Manual Rate Override**
   - Admin'in özel kurlar setleyebilmesi
   - Belirli currencies için custom rates

4. **Webhook Integration**
   - Provider'ın currency değiştiğinde notify etmesi
   - Real-time sync triggers

## References

- [Open Exchange Rates API](https://openexchangerates.org)
- [Netlify Environment Variables](https://docs.netlify.com/functions/overview/#environment-variables)
- [Supabase JSON Support](https://supabase.com/docs/guides/database/json-column)
