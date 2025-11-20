const { performOrderStatusSync } = require('./orders');

exports.handler = async (event = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  const runAt = event.headers?.['x-netlify-schedule-run-at'] || new Date().toISOString();
  const qsLimit = event.queryStringParameters && event.queryStringParameters.limit;
  const limit = Number.isFinite(Number(qsLimit)) ? Number(qsLimit) : 150;
  const providerFilter = event.queryStringParameters && (event.queryStringParameters.providerId || event.queryStringParameters.provider_id);

  console.log(`[SCHEDULED] Order status sync invoked at ${runAt} with limit ${limit}`);

  try {
    const result = await performOrderStatusSync({ limit, providerId: providerFilter || null });
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ...result, runAt })
    };
  } catch (error) {
    console.error('[SCHEDULED] Order status sync failed:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Order status sync failed', message: error.message })
    };
  }
};
