const { normalizeSKU } = require('./ids.cjs');
// Public cart rows use catalog spelling for SKU and integer minor-unit totals.
// All operations return new arrays/objects so an existing checkout snapshot stays stable.
function addToCart(catalog, sku, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError('positive integer quantity required');
  const item = catalog.get(normalizeSKU(sku));
  if (!item) throw new Error('SKU_NOT_FOUND');
  return { sku: item.sku, quantity, totalMinor: item.priceMinor * quantity };
}
function mergeCart(lines) {
  const grouped = new Map();
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new RangeError('invalid cart quantity');
    if (!Number.isInteger(line.totalMinor) || line.totalMinor < 0) throw new RangeError('invalid cart total');
    const key = String(line.sku).trim().toLowerCase();
    const existing = grouped.get(key);
    grouped.set(key, existing
      ? { sku: existing.sku, quantity: existing.quantity + line.quantity, totalMinor: existing.totalMinor + line.totalMinor }
      : { sku: line.sku, quantity: line.quantity, totalMinor: line.totalMinor });
  }
  return [...grouped.values()];
}
function removeFromCart(lines, sku) {
  const key = String(sku).trim().toLowerCase();
  return lines.filter(line => String(line.sku).trim().toLowerCase() !== key).map(line => ({ ...line }));
}
function cartTotals(lines) {
  return lines.reduce((result, line) => ({ quantity: result.quantity + line.quantity, totalMinor: result.totalMinor + line.totalMinor }), { quantity: 0, totalMinor: 0 });
}
module.exports = { addToCart, mergeCart, removeFromCart, cartTotals };
