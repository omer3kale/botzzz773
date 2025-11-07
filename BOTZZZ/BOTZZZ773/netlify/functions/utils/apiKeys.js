const crypto = require('crypto');

const KEY_PREFIX_LENGTH = 12;
const KEY_LAST_FOUR_LENGTH = 4;

function generateApiKey() {
  return 'sk_' + crypto.randomBytes(32).toString('hex');
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function extractKeyPrefix(apiKey) {
  return apiKey.substring(0, KEY_PREFIX_LENGTH);
}

function extractKeyLastFour(apiKey) {
  return apiKey.slice(-KEY_LAST_FOUR_LENGTH);
}

function maskKey(prefix, lastFour) {
  const safePrefix = (prefix || '').padEnd(KEY_PREFIX_LENGTH, '*');
  const safeLastFour = (lastFour || '').padEnd(KEY_LAST_FOUR_LENGTH, '*');
  return `${safePrefix}********${safeLastFour}`;
}

function safeCompareHash(providedHash, storedHash) {
  if (!providedHash || !storedHash) {
    return false;
  }

  const providedBuffer = Buffer.from(providedHash, 'hex');
  const storedBuffer = Buffer.from(storedHash, 'hex');

  if (providedBuffer.length !== storedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, storedBuffer);
}

module.exports = {
  KEY_PREFIX_LENGTH,
  KEY_LAST_FOUR_LENGTH,
  generateApiKey,
  hashApiKey,
  extractKeyPrefix,
  extractKeyLastFour,
  maskKey,
  safeCompareHash
};
