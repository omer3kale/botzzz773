// Mock refund scenarios (no provider calls, no DB)
// Verifies business rules:
// - canceled: reseller charge = 0; site refund = original_charge
// - partial: reseller charge = deliveredCharge; site refund = original_charge - deliveredCharge

function calculateDeliveredCharge({ original_charge, quantity, remains }) {
  const qty = Math.max(0, Number(quantity) || 0);
  const rem = Math.max(0, Number(remains) || 0);
  const full = Math.max(0, Number(original_charge) || 0);
  if (qty <= 0) return 0;
  const delivered = Math.max(0, qty - rem);
  const ratePerUnit = full / qty;
  const deliveredCharge = ratePerUnit * delivered;
  // Match server precision for charges (4 decimals)
  return Number(deliveredCharge.toFixed(4));
}

function simulateCanceled(order) {
  const original = Number(order.original_charge || order.charge || 0);
  const resellerCharge = 0;
  const siteRefund = original; // full refund from snapshot
  return {
    scenario: 'canceled',
    input: order,
    resellerCharge,
    siteRefund: Number(siteRefund.toFixed(2)),
  };
}

function simulatePartial(order) {
  const original = Number(order.original_charge || order.charge || 0);
  const deliveredCharge = calculateDeliveredCharge(order);
  const siteRefundRaw = original - deliveredCharge;
  const siteRefund = Number(siteRefundRaw.toFixed(2));
  return {
    scenario: 'partial',
    input: order,
    resellerCharge: deliveredCharge, // what v2/status returns for partial
    siteRefund,
  };
}

function run() {
  const cases = [];

  // Case A: Full cancel ($5.00 original)
  cases.push(simulateCanceled({ original_charge: 5.0, charge: 0, quantity: 100, remains: 100 }));

  // Case B: Partial delivery (60/100 delivered → $3.00 delivered, $2.00 refund)
  cases.push(simulatePartial({ original_charge: 5.0, quantity: 100, remains: 40 }));

  // Case C: Edge rounding (33 delivered of 100 on $4.99)
  cases.push(simulatePartial({ original_charge: 4.99, quantity: 100, remains: 67 }));

  // Case D: No remains provided (treat as no delivery)
  cases.push(simulatePartial({ original_charge: 7.5, quantity: 50, remains: 50 }));

  console.log('\n=== Mock Refund Scenarios (No Spend) ===');
  for (const r of cases) {
    const { scenario, input, resellerCharge, siteRefund } = r;
    const qty = input.quantity ?? '—';
    const rem = input.remains ?? '—';
    const orig = input.original_charge ?? input.charge ?? 0;
    console.log(`\nScenario: ${scenario.toUpperCase()}`);
    console.log(`  original_charge: $${orig}`);
    console.log(`  quantity/remains: ${qty}/${rem}`);
    console.log(`  → Reseller-visible charge: $${resellerCharge}`);
    console.log(`  → Site refund history:   $${siteRefund}`);
  }
}

if (require.main === module) {
  run();
}

module.exports = { calculateDeliveredCharge, simulateCanceled, simulatePartial };