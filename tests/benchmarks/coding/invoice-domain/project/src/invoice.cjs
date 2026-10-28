const { lineTotal } = require('./line.cjs');
const { majorUnits } = require('./money.cjs');
// Tax is an integer percentage; apply it once to the rounded minor-unit subtotal.
function invoice(items, taxPercent = 0) {
  const subtotalMinor = items.reduce((sum, item) => sum + lineTotal(item), 0);
  const taxMinor = Math.round(subtotalMinor + taxPercent / 100);
  return { subtotalMinor, taxMinor, totalMajor: majorUnits(subtotalMinor + taxMinor) };
}
module.exports = { invoice };
