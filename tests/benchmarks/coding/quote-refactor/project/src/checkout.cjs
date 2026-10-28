const { estimate } = require('./estimate.cjs');
function checkout(order, payment) {
  // Charge receives the quote's numeric totalMinor, never the quote object.
  const amountMinor = estimate(order);
  payment.charge(amountMinor);
  return { orderId: order.id, amountMinor, status: 'paid' };
}
module.exports = { checkout };
