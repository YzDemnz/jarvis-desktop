const test = require('node:test');
const assert = require('node:assert/strict');
const { shippingPolicy } = require('../src/shipping-policy.cjs');
const { estimate } = require('../src/estimate.cjs');
const { checkout } = require('../src/checkout.cjs');
const order = (zone, priceMinor = 1250, quantity = 2) => ({ id: 'order-1', zone, items: [{ priceMinor, quantity }] });
test('shipping rules remain stable across migration', () => {
  assert.deepEqual(shippingPolicy('pickup', 0), { costMinor: 0, service: 'pickup' });
  assert.equal(shippingPolicy('local', 4999).costMinor, 500);
  assert.equal(shippingPolicy('local', 5000).costMinor, 0);
  assert.equal(shippingPolicy('local', 7000).costMinor, 0);
  assert.equal(shippingPolicy('remote', 7000).costMinor, 1200);
  assert.throws(() => shippingPolicy('mars', 10), /UNSUPPORTED_ZONE/);
});
test('quote exposes all monetary fields consistently', () => {
  assert.deepEqual(estimate(order('local')), { subtotalMinor: 2500, shippingMinor: 500, totalMinor: 3000 });
  assert.deepEqual(estimate(order('local', 2500)), { subtotalMinor: 5000, shippingMinor: 0, totalMinor: 5000 });
  assert.deepEqual(estimate(order('remote')), { subtotalMinor: 2500, shippingMinor: 1200, totalMinor: 3700 });
  assert.deepEqual(estimate({ id: 'empty', zone: 'pickup', items: [] }), { subtotalMinor: 0, shippingMinor: 0, totalMinor: 0 });
});
test('checkout charges scalar minor units and preserves public receipt', () => {
  for (const [zone, total] of [['local', 3000], ['remote', 3700], ['pickup', 2500]]) {
    const calls = [];
    const receipt = checkout(order(zone), { charge: value => { assert.equal(typeof value, 'number'); calls.push(value); } });
    assert.deepEqual(calls, [total]);
    assert.deepEqual(receipt, { orderId: 'order-1', amountMinor: total, status: 'paid' });
  }
});
