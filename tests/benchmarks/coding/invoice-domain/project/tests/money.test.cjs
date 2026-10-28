const test = require('node:test');
const assert = require('node:assert/strict');
const { minorUnits, majorUnits } = require('../src/money.cjs');
const { lineTotal } = require('../src/line.cjs');
const { invoice } = require('../src/invoice.cjs');
test('existing conversion API remains stable', () => {
  assert.equal(minorUnits(1.25), 125);
  assert.equal(minorUnits(0.1), 10);
  assert.equal(majorUnits(125), 1.25);
  assert.equal(majorUnits(0), 0);
  assert.throws(() => minorUnits(NaN), TypeError);
});
test('line contract preserves cents and quantity behavior', () => {
  assert.equal(lineTotal({ priceMajor: 1.25, quantity: 3 }), 375);
  assert.equal(lineTotal({ priceMajor: 0.1, quantity: 3 }), 30);
  assert.equal(lineTotal({ priceMajor: 4.99, quantity: 0 }), 0);
  assert.equal(lineTotal({ priceMajor: 1.005, quantity: 1 }), 101);
  assert.throws(() => lineTotal({ priceMajor: 5, quantity: -1 }), RangeError);
  assert.throws(() => lineTotal({ priceMajor: 5, quantity: 1.5 }), RangeError);
});
test('invoice sums rounded lines and applies tax once', () => {
  assert.deepEqual(invoice([], 20), { subtotalMinor: 0, taxMinor: 0, totalMajor: 0 });
  assert.deepEqual(invoice([{ priceMajor: 1.25, quantity: 3 }]), { subtotalMinor: 375, taxMinor: 0, totalMajor: 3.75 });
  assert.deepEqual(invoice([{ priceMajor: 1.25, quantity: 3 }, { priceMajor: 2, quantity: 1 }], 20), { subtotalMinor: 575, taxMinor: 115, totalMajor: 6.9 });
});
