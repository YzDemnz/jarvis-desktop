// The migrated policy returns structured minor-unit values.
function shippingPolicy(zone, subtotalMinor) {
  if (zone === 'pickup') return { costMinor: 0, service: 'pickup' };
  if (zone === 'local') return { costMinor: subtotalMinor >= 5000 ? 0 : 500, service: 'ground' };
  if (zone === 'remote') return { costMinor: 1200, service: 'ground' };
  throw new Error('UNSUPPORTED_ZONE');
}
module.exports = { shippingPolicy };
