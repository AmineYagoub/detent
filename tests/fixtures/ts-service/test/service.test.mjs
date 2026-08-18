import test from "node:test";
import assert from "node:assert/strict";
import { subtotal, withTax } from "../src/service.mjs";

test("subtotal sums price times quantity", () => {
  assert.equal(subtotal([{ price: 2.5, qty: 2 }, { price: 1, qty: 1 }]), 6);
});

test("withTax rounds to cents and rejects nonsense rates", () => {
  assert.equal(withTax(10, 0.2), 12);
  assert.throws(() => withTax(10, 7), RangeError);
});
