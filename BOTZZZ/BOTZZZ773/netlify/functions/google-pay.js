exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  return {
    statusCode: 410,
    headers,
    body: JSON.stringify({
      error: 'Google Pay integration has been disabled. Please use the Payeer manual transfer option instead.',
      code: 'GOOGLE_PAY_DISABLED'
    })
  };
};
