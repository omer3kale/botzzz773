let stripeInstance = null;

function getStripeClient() {
  if (stripeInstance) {
    return stripeInstance;
  }

  const secretKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) {
    return null;
  }

  try {
    const stripe = require('stripe');
    stripeInstance = stripe(secretKey);
    return stripeInstance;
  } catch (error) {
    console.error('Failed to initialize Stripe client:', error.message);
    return null;
  }
}

function isStripeConfigured() {
  return Boolean((process.env.STRIPE_SECRET_KEY || '').trim());
}

function getStripePublishableKey() {
  return (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
}

function resetStripeCache() {
  stripeInstance = null;
}

module.exports = {
  getStripeClient,
  isStripeConfigured,
  getStripePublishableKey,
  resetStripeCache
};
