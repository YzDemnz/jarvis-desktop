const { shippingPolicy } = require('./shipping-policy.cjs');
// Public quote contract: { subtotalMinor, shippingMinor, totalMinor }.
function estimate(order) {
  const subtotalMinor = order.items.reduce((sum, item) => sum + item.priceMinor * item.quantity, 0);
  const shipping = shippingPolicy(order.zone, subtotalMinor);
  return subtotalMinor + shipping;
}
module.exports = { estimate };
