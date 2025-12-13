// Minimal test to assert distinct mapping for 'in progress' vs 'processing'
// This is a lightweight, non-runner-dependent check using pure functions.

function mapProviderToCustomerStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'in progress') return 'in progress';
  if (s === 'processing') return 'processing';
  if (s === 'pending' || s === 'queued' || s === 'waiting') return 'pending';
  if (s === 'completed' || s === 'complete') return 'completed';
  if (s === 'partial') return 'partial';
  if (s === 'canceled' || s === 'cancelled') return 'canceled';
  return 'pending';
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`[FAIL] ${label}: expected "${expected}", got "${actual}"`);
  }
  console.log(`[OK] ${label}`);
}

(function run() {
  assertEqual(mapProviderToCustomerStatus('in progress'), 'in progress', 'provider in progress → customer in progress');
  assertEqual(mapProviderToCustomerStatus('processing'), 'processing', 'provider processing → customer processing');
  assertEqual(mapProviderToCustomerStatus('pending'), 'pending', 'provider pending → customer pending');
  assertEqual(mapProviderToCustomerStatus('queued'), 'pending', 'provider queued → customer pending');
  assertEqual(mapProviderToCustomerStatus('completed'), 'completed', 'provider completed → customer completed');
  assertEqual(mapProviderToCustomerStatus('partial'), 'partial', 'provider partial → customer partial');
  assertEqual(mapProviderToCustomerStatus('cancelled'), 'canceled', 'provider cancelled → customer canceled');
})();
