function isRefillIdConflict(error) {
  const message = String(error?.message || '');
  return (
    error?.code === '23505'
    || message.includes('refill_requests_refill_id_key')
    || message.includes('duplicate key value')
  );
}

async function insertRefillRequestWithRetry(supabaseAdmin, payload, logger = console, options = {}) {
  const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 6;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const insertPayload = payload?.refill_id
      ? { ...payload, refill_id: String(payload.refill_id) }
      : { ...payload };

    const result = await supabaseAdmin
      .from('refill_requests')
      .insert(insertPayload)
      .select('refill_id')
      .single();

    if (!result.error) {
      if (attempt > 1 && logger?.warn) {
        logger.warn('[REFILL INSERT] Succeeded after retry', {
          attempt,
          order_number: payload?.order_number
        });
      }
      return result;
    }

    lastError = result.error;
    if (!isRefillIdConflict(result.error) || attempt === maxAttempts) {
      return result;
    }

    if (logger?.warn) {
      logger.warn('[REFILL INSERT] Duplicate refill_id detected, retrying', {
        attempt,
        order_number: payload?.order_number,
        error: result.error.message
      });
    }
  }

  return { data: null, error: lastError };
}

module.exports = {
  insertRefillRequestWithRetry,
  isRefillIdConflict
};
