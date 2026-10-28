const { minorUnits } = require('./money.cjs');
// Public contract: lineTotal returns integer minor units, rounded per line.
function lineTotal(item) {
  if (!Number.isInteger(item.quantity) || item.quantity < 0) throw new RangeError('nonnegative integer quantity required');
  return Math.round(item.priceMajor * item.quantity);
}
module.exports = { lineTotal };
