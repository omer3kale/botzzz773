#!/usr/bin/env node
// Staging smoke tests (no external spend)
// Uses mock refund scenarios to validate charge shaping and refund math.

const assert = require('assert');
const { simulateCanceled, simulatePartial } = require('./mock-refund-scenarios');

function approxEq(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

function run() {
  const failures = [];

  // Canceled: original 5 → reseller 0; site refund 5
  {
    const r = simulateCanceled({ original_charge: 5.0, charge: 0, quantity: 100, remains: 100 });
    try {
      assert.strictEqual(r.resellerCharge, 0);
      assert.strictEqual(r.siteRefund, 5.0);
    } catch (e) {
      failures.push({ name: 'Canceled $5 full refund', details: r });
    }
  }

  // Partial: 60/100 on $5 → reseller 3; site refund 2
  {
    const r = simulatePartial({ original_charge: 5.0, quantity: 100, remains: 40 });
    try {
      assert.ok(approxEq(r.resellerCharge, 3.0));
      assert.strictEqual(r.siteRefund, 2.0);
    } catch (e) {
      failures.push({ name: 'Partial 60/100 on $5', details: r });
    }
  }

  // Partial: 33/100 on $4.99 → reseller 1.6467; site refund 3.34
  {
    const r = simulatePartial({ original_charge: 4.99, quantity: 100, remains: 67 });
    try {
      assert.ok(approxEq(r.resellerCharge, 1.6467, 1e-6));
      assert.strictEqual(r.siteRefund, 3.34);
    } catch (e) {
      failures.push({ name: 'Partial 33/100 on $4.99', details: r });
    }
  }

  // Partial: 0 delivered on $7.5 → reseller 0; site refund 7.5
  {
    const r = simulatePartial({ original_charge: 7.5, quantity: 50, remains: 50 });
    try {
      assert.strictEqual(r.resellerCharge, 0.0);
      assert.strictEqual(r.siteRefund, 7.5);
    } catch (e) {
      failures.push({ name: 'Partial none on $7.5', details: r });
    }
  }

  if (failures.length) {
    console.error('\nSmoke tests FAILED:\n');
    for (const f of failures) {
      console.error(`- ${f.name}`);
      console.error(`  details: ${JSON.stringify(f.details)}`);
    }
    process.exit(1);
  } else {
    console.log('\nSmoke tests PASSED: refund shaping matches expectations.');
  }
}

if (require.main === module) {
  run();
}

module.exports = { run };
