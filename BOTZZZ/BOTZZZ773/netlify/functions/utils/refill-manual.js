function isRefillProviderUnsupportedResponse(payload) {
  const errorText = String(
    payload?.error
    ?? payload?.message
    ?? payload?.details
    ?? ''
  ).toLowerCase();

  if (!errorText) {
    return false;
  }

  return [
    'refill not supported',
    'refill unavailable',
    'refill disabled',
    'refill not allowed',
    'refill not available',
    'service does not support refill',
    'refill service not supported'
  ].some(token => errorText.includes(token));
}

function shouldHandleRefillManually(service) {
  return service?.refill_supported !== true && service?.refill_supported !== 1;
}

module.exports = {
  isRefillProviderUnsupportedResponse,
  shouldHandleRefillManually
};
