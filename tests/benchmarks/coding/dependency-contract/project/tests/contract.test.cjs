const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalSKU } = require('../src/ids.cjs');
const { makeCatalog } = require('../src/catalog.cjs');
const { addToCart, mergeCart, removeFromCart, cartTotals } = require('../src/cart.cjs');
const catalog = () => makeCatalog([{ sku: 'Book-A', priceMinor: 1299 }, { sku: 'pen', priceMinor: 75 }]);
test('public identifier and catalog contracts survive', () => {
  assert.equal(canonicalSKU('  BOOK-A '), 'book-a');
  assert.equal(canonicalSKU(12), '12');
  assert.equal(canonicalSKU(''), '');
  assert.equal(catalog().size, 2);
  assert.equal(catalog().get(' BOOK-A ').priceMinor, 1299);
  assert.equal(catalog().get('missing'), null);
});
test('cart resolves shared identifiers without changing returned SKU', () => {
  assert.deepEqual(addToCart(catalog(), ' book-a ', 2), { sku: 'Book-A', quantity: 2, totalMinor: 2598 });
  assert.deepEqual(addToCart(catalog(), 'PEN', 3), { sku: 'pen', quantity: 3, totalMinor: 225 });
  assert.throws(() => addToCart(catalog(), 'missing', 1), /SKU_NOT_FOUND/);
});
test('invalid quantities remain rejected', () => {
  for (const qty of [0, -1, 1.5]) assert.throws(() => addToCart(catalog(), 'pen', qty), RangeError);
});
test('cart helpers preserve totals, identifiers and input snapshots', () => {
  const lines = [{ sku: 'Book-A', quantity: 2, totalMinor: 2598 }, { sku: 'BOOK-A', quantity: 1, totalMinor: 1299 }, { sku: 'pen', quantity: 1, totalMinor: 75 }];
  const saved = JSON.stringify(lines);
  assert.deepEqual(mergeCart(lines), [{ sku: 'Book-A', quantity: 3, totalMinor: 3897 }, { sku: 'pen', quantity: 1, totalMinor: 75 }]);
  assert.deepEqual(cartTotals(lines), { quantity: 4, totalMinor: 3972 });
  assert.deepEqual(removeFromCart(lines, ' book-a '), [{ sku: 'pen', quantity: 1, totalMinor: 75 }]);
  assert.equal(JSON.stringify(lines), saved);
  assert.notEqual(mergeCart(lines)[0], lines[0]);
  assert.notEqual(removeFromCart(lines, 'missing')[0], lines[0]);
  assert.deepEqual(cartTotals([]), { quantity: 0, totalMinor: 0 });
  assert.deepEqual(mergeCart([]), []);
  assert.throws(() => mergeCart([{ sku: 'bad', quantity: 0, totalMinor: 10 }]), RangeError);
  assert.throws(() => mergeCart([{ sku: 'bad', quantity: 1, totalMinor: -1 }]), RangeError);
});
