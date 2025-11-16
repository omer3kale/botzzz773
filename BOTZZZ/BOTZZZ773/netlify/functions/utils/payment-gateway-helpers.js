const crypto = require('crypto');

const DEFAULT_MIN_AMOUNT = Number(process.env.MIN_DEPOSIT_AMOUNT || 5);

function buildGatewayOrderId(prefix = 'PAY', userId = 'GUEST') {
  const safePrefix = String(prefix || 'PAY')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12) || 'PAY';

  const safeUser = String(userId || 'GUEST')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-6) || 'GUEST';

  return `${safePrefix}-${Date.now()}-${safeUser}`;
}

function formatUsd(amount) {
  const value = Number(amount || 0);
  const normalized = Number.isFinite(value) ? value : 0;
  return normalized.toFixed(2);
}

function sanitizeCurrencyCode(code, fallback = 'USD') {
  if (!code) return fallback.toUpperCase();
  const sanitized = String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return sanitized || fallback.toUpperCase();
}

function generatePayeerSignature(params, secretKey) {
  if (!secretKey) {
    throw new Error('PAYEER_SECRET_KEY is not configured');
  }

  const {
    shopId,
    orderId,
    amount,
    currency = 'USD',
    description = ''
  } = params;

  const payload = {
    m_shop: shopId,
    m_orderid: orderId,
    m_amount: formatUsd(amount),
    m_curr: sanitizeCurrencyCode(currency),
    m_desc: Buffer.from(description).toString('base64')
  };

  const signString = `${payload.m_shop}:${payload.m_orderid}:${payload.m_amount}:${payload.m_curr}:${payload.m_desc}:${secretKey}`;
  return crypto.createHash('sha256').update(signString).digest('hex').toUpperCase();
}

function verifyPayeerWebhookSignature(payload, secretKey) {
  if (!secretKey) {
    return false;
  }

  const signString = [
    payload.m_operation_id,
    payload.m_operation_ps,
    payload.m_operation_date,
    payload.m_operation_pay_date,
    payload.m_shop,
    payload.m_orderid,
    payload.m_amount,
    payload.m_curr,
    payload.m_desc,
    payload.m_status,
    secretKey
  ].join(':');

  const expectedSign = crypto.createHash('sha256').update(signString).digest('hex').toUpperCase();
  return expectedSign === payload.m_sign;
}

function normalizeCryptoStatus(status) {
  return (status || 'unknown').toString().trim().toLowerCase();
}

function isFinalCryptoStatus(status) {
  const finalStatuses = ['finished', 'confirmed', 'failed', 'expired', 'refunded', 'completed'];
  return finalStatuses.includes(normalizeCryptoStatus(status));
}

function calculateProcessingFee(amount, feePercent = 0) {
  const base = Number(amount || 0);
  const percent = Number(feePercent || 0);
  const fee = Number(((base * percent) / 100).toFixed(2));
  const total = Number((base + fee).toFixed(2));
  return { fee, total };
}

function deriveGooglePayRequestConfig({
  amount,
  currency = 'USD',
  merchantName = 'BOTZZZ773',
  merchantId = 'BCR2DN4T6AJX7GLP',
  countryCode = 'US',
  environment = process.env.GOOGLE_PAY_ENV || 'TEST'
} = {}) {
  const normalizedCurrency = sanitizeCurrencyCode(currency).toLowerCase();
  const normalizedCountry = sanitizeCurrencyCode(countryCode || 'US').slice(0, 2) || 'US';
  const totalAmount = Number(Math.round(Number(amount || 0) * 100));

  return {
    googlePayOptions: {
      environment,
      merchantInfo: {
        merchantId,
        merchantName
      },
      allowedPaymentMethods: [
        {
          type: 'CARD',
          parameters: {
            allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
            allowedCardNetworks: ['AMEX', 'DISCOVER', 'MASTERCARD', 'VISA']
          }
        }
      ]
    },
    countryCode: normalizedCountry,
    currencyCode: normalizedCurrency,
    totalLabel: merchantName,
    totalAmount
  };
}

function getMinimumDepositAmount() {
  return Number.isFinite(DEFAULT_MIN_AMOUNT) ? DEFAULT_MIN_AMOUNT : 5;
}

module.exports = {
  buildGatewayOrderId,
  formatUsd,
  sanitizeCurrencyCode,
  generatePayeerSignature,
  verifyPayeerWebhookSignature,
  normalizeCryptoStatus,
  isFinalCryptoStatus,
  calculateProcessingFee,
  deriveGooglePayRequestConfig,
  getMinimumDepositAmount
};
