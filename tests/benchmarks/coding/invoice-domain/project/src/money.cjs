function minorUnits(amount) {
  if (!Number.isFinite(amount)) throw new TypeError('finite money required');
  return Math.round((amount + Number.EPSILON) * 100);
}
function majorUnits(amount) { return amount / 100; }
module.exports = { minorUnits, majorUnits };
