/** The fixture's product: a tiny pricing service. */
export function subtotal(items) {
  return items.reduce((sum, { price, qty }) => sum + price * qty, 0);
}

export function withTax(amount, rate) {
  if (rate < 0 || rate > 1) throw new RangeError(`tax rate out of range: ${rate}`);
  return Math.round(amount * (1 + rate) * 100) / 100;
}
