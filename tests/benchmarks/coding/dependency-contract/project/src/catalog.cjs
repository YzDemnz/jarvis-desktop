const { canonicalSKU } = require('./ids.cjs');
function makeCatalog(items) {
  const bySKU = new Map(items.map(item => [canonicalSKU(item.sku), { ...item }]));
  return { get: sku => bySKU.get(canonicalSKU(sku)) ?? null, size: bySKU.size };
}
module.exports = { makeCatalog };
