# Cryptomus Payment Gateway Integration

## Overview
Cryptomus is integrated into BOTZZZ773 for accepting cryptocurrency payments. This document covers setup and configuration.

## Setup Instructions

### 1. Get Cryptomus API Credentials

1. Go to [Cryptomus Settings](https://app.cryptomus.com/tr/settings/api)
2. Sign in or create an account
3. Navigate to **Settings > API**
4. Copy your:
   - **Merchant ID** (Payment UUID)
   - **API Key** (Payment API Key)

### 2. Configure Environment Variables

Add to your Netlify environment variables:

```bash
CRYPTOMUS_MERCHANT_ID=your_merchant_id_here
CRYPTOMUS_API_KEY=your_api_key_here
SITE_URL=https://www.botzzz773.pro
JWT_SECRET=your_jwt_secret
```

### 3. Configure Webhook URL

In your Cryptomus dashboard:

1. Go to **Settings > Notifications**
2. Set webhook URL to: `https://www.botzzz773.pro/.netlify/functions/cryptomus`
3. Enable webhook notifications

## API Endpoints

### Create Payment
```javascript
POST /.netlify/functions/cryptomus
{
  "action": "create-payment",
  "amount": 50.00,
  "email": "user@example.com"
}
```

### Webhook (called by Cryptomus)
```javascript
POST /.netlify/functions/cryptomus
{
  "order_id": "CRYPTO-1234567890-USER123",
  "status": "paid",
  "uuid": "invoice-uuid",
  "payment_amount": "0.0012",
  "payment_amount_usd": "50.00"
}
```

## Supported Cryptocurrencies

- Bitcoin (BTC)
- Ethereum (ETH)
- Tether (USDT) - TRC20, ERC20, BEP20
- USD Coin (USDC)
- Litecoin (LTC)
- Dogecoin (DOGE)
- And 100+ more...

## Security

All webhooks are verified using MD5 signature with base64-encoded payload.
